"""Private per-browser S3 data and an atomic, shared lifetime quota."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import time
from pathlib import Path

from botocore.exceptions import ClientError


class Storage:
    def __init__(self, s3, bucket: str, session: str, root: Path):
        if not re.fullmatch(r"[a-f0-9]{64}", session):
            raise ValueError("Invalid session")
        self.s3, self.bucket, self.session, self.root = s3, bucket, session, root
        self.prefix = f"sessions/{session}/"
        self.initial: dict[str, str] = {}

    def restore(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir(parents=True, exist_ok=True)
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=self.bucket, Prefix=self.prefix + "data/"
        ):
            for item in page.get("Contents", []):
                key = item["Key"]
                relative = key.removeprefix(self.prefix + "data/")
                path = (self.root / relative).resolve()
                if not path.is_relative_to(self.root.resolve()):
                    raise ValueError("Invalid stored file path")
                path.parent.mkdir(parents=True, exist_ok=True)
                data = self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
                path.write_bytes(data)
                self.initial[relative] = hashlib.sha256(data).hexdigest()

    def commit(self) -> None:
        for path in self.root.rglob("*"):
            if (
                not path.is_file()
                or path.is_symlink()
                or path.name.startswith("runs.sqlite3")
            ):
                continue
            relative = path.relative_to(self.root).as_posix()
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if self.initial.get(relative) != digest:
                self.put("data/" + relative, data)
                self.initial[relative] = digest

    def put(self, key: str, data: bytes, **kwargs) -> None:
        self.s3.put_object(
            Bucket=self.bucket, Key=self.prefix + key, Body=data, **kwargs
        )

    def get(self, key: str) -> bytes | None:
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=self.prefix + key)[
                "Body"
            ].read()
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("NoSuchKey", "404", "NotFound"):
                return None
            raise

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=self.prefix + key)

    def put_json(self, key: str, value: dict, **kwargs) -> None:
        self.put(
            key, json.dumps(value).encode(), ContentType="application/json", **kwargs
        )

    def get_json(self, key: str) -> dict | None:
        data = self.get(key)
        return json.loads(data) if data is not None else None


class Quota:
    def __init__(self, dynamodb, table: str, limit: int = 250):
        self.dynamodb, self.table, self.limit = dynamodb, table, limit

    def used(self) -> int:
        item = self.dynamodb.get_item(
            TableName=self.table, Key={"id": {"S": "lifetime"}}, ConsistentRead=True
        ).get("Item", {})
        return int(item.get("used", {}).get("N", "0"))

    def consume(self) -> int | None:
        try:
            result = self.dynamodb.update_item(
                TableName=self.table,
                Key={"id": {"S": "lifetime"}},
                UpdateExpression="ADD #used :one",
                ConditionExpression="attribute_not_exists(#used) OR #used < :limit",
                ExpressionAttributeNames={"#used": "used"},
                ExpressionAttributeValues={
                    ":one": {"N": "1"},
                    ":limit": {"N": str(self.limit)},
                },
                ReturnValues="UPDATED_NEW",
            )
            return int(result["Attributes"]["used"]["N"])
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return None
            raise

    def acquire(self, token: str) -> str | None:
        now = int(time.time())
        for slot in ("api-slot-0", "api-slot-1"):
            try:
                self.dynamodb.put_item(
                    TableName=self.table,
                    Item={
                        "id": {"S": slot},
                        "owner": {"S": token},
                        "expires": {"N": str(now + 920)},
                    },
                    ConditionExpression="attribute_not_exists(#id) OR #expires < :now",
                    ExpressionAttributeNames={"#id": "id", "#expires": "expires"},
                    ExpressionAttributeValues={":now": {"N": str(now)}},
                )
                return slot
            except ClientError as exc:
                if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        return None

    def release(self, slot: str, token: str) -> None:
        try:
            self.dynamodb.delete_item(
                TableName=self.table,
                Key={"id": {"S": slot}},
                ConditionExpression="#owner = :owner",
                ExpressionAttributeNames={"#owner": "owner"},
                ExpressionAttributeValues={":owner": {"S": token}},
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
