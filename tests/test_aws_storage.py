import io
import tempfile
import unittest
from pathlib import Path
from threading import Lock, Thread

from botocore.exceptions import ClientError

from deploy.aws.storage import Quota, Storage


class MemoryS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, **kwargs):
        if kwargs.get("IfNoneMatch") == "*" and Key in self.objects:
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        self.objects[Key] = bytes(Body)

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[Key])}

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return self

    def paginate(self, Bucket, Prefix):
        yield {
            "Contents": [{"Key": key} for key in self.objects if key.startswith(Prefix)]
        }


class AtomicDynamo:
    def __init__(self):
        self.value = 0
        self.lock = Lock()
        self.slots = {}

    def put_item(self, **kwargs):
        item = kwargs["Item"]
        key = item["id"]["S"]
        with self.lock:
            if key in self.slots:
                raise ClientError(
                    {"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem"
                )
            self.slots[key] = item["owner"]["S"]

    def delete_item(self, **kwargs):
        key = kwargs["Key"]["id"]["S"]
        with self.lock:
            if (
                self.slots.get(key)
                != kwargs["ExpressionAttributeValues"][":owner"]["S"]
            ):
                raise ClientError(
                    {"Error": {"Code": "ConditionalCheckFailedException"}}, "DeleteItem"
                )
            del self.slots[key]

    def get_item(self, **kwargs):
        assert kwargs["ConsistentRead"]
        return {"Item": {"used": {"N": str(self.value)}}}

    def update_item(self, **kwargs):
        assert "attribute_not_exists" in kwargs["ConditionExpression"]
        limit = int(kwargs["ExpressionAttributeValues"][":limit"]["N"])
        with self.lock:
            if self.value >= limit:
                raise ClientError(
                    {"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem"
                )
            self.value += 1
            return {"Attributes": {"used": {"N": str(self.value)}}}


class StorageTests(unittest.TestCase):
    def test_session_data_isolated_and_durable_across_invocations(self):
        client = MemoryS3()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "data"
            first = Storage(client, "bucket", "a" * 64, root)
            first.restore()
            (root / "timeline").mkdir()
            (root / "timeline" / "analysis.json").write_text('{"version": 1}')
            (root / "runs.sqlite3").write_text("local only")
            first.commit()
            other = Storage(client, "bucket", "b" * 64, root)
            other.restore()
            self.assertFalse((root / "timeline" / "analysis.json").exists())
            again = Storage(client, "bucket", "a" * 64, root)
            again.restore()
            self.assertEqual(
                (root / "timeline" / "analysis.json").read_text(), '{"version": 1}'
            )
            self.assertFalse((root / "runs.sqlite3").exists())

    def test_restore_rejects_path_traversal_and_bad_session(self):
        client = MemoryS3()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                Storage(client, "bucket", "../outside", Path(tmp))
            store = Storage(client, "bucket", "c" * 64, Path(tmp) / "root")
            client.objects[store.prefix + "data/../../secret"] = b"bad"
            with self.assertRaises(ValueError):
                store.restore()

    def test_quota_is_atomic_and_never_exceeds_limit(self):
        client = AtomicDynamo()
        quota = Quota(client, "table", limit=250)
        outcomes = []
        threads = [
            Thread(target=lambda: outcomes.append(quota.consume())) for _ in range(280)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(quota.used(), 250)
        self.assertEqual(sum(result is not None for result in outcomes), 250)
        self.assertIsNone(quota.consume())

    def test_expensive_api_calls_have_two_owner_protected_slots(self):
        quota = Quota(AtomicDynamo(), "table")
        first = quota.acquire("first")
        second = quota.acquire("second")
        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertIsNone(quota.acquire("third"))
        quota.release(first, "wrong-owner")
        self.assertIsNone(quota.acquire("third"))
        quota.release(first, "first")
        self.assertEqual(quota.acquire("third"), first)


if __name__ == "__main__":
    unittest.main()
