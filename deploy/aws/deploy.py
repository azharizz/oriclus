"""Build and deploy Oriclus to the selected AWS account without printing secrets."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".oriclus" / "aws-deployment.json"
KEYS = (
    "NEBIUS_API_KEY",
    "NEBIUS_BASE_URL",
    "NEBIUS_MODEL",
    "NEBIUS_PROJECT_ID",
    "NEBIUS_SANDBOX_API_KEY",
    "TAVILY_API_KEY",
)


def build(destination: Path) -> None:
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix="oriclus-aws-build-") as temporary:
        work = Path(temporary)
        requirements = work / "requirements.txt"
        package = work / "package"
        package.mkdir()
        subprocess.run(
            [
                "uv",
                "export",
                "--frozen",
                "--no-dev",
                "--no-hashes",
                "--no-emit-project",
                "-o",
                str(requirements),
            ],
            cwd=ROOT,
            check=True,
            stdout=subprocess.DEVNULL,
        )
        subprocess.run(
            [
                "uv",
                "pip",
                "install",
                "--python-platform",
                "x86_64-manylinux_2_28",
                "--python-version",
                "3.12",
                "--target",
                str(package),
                "-r",
                str(requirements),
            ],
            cwd=ROOT,
            check=True,
        )
        ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".env", ".env.*")
        shutil.copytree(ROOT / "server", package / "server", ignore=ignore)
        shutil.copytree(ROOT / "deploy", package / "deploy", ignore=ignore)
        shutil.copytree(ROOT / "dist", package / "dist", ignore=ignore)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(
            destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as archive:
            for file in package.rglob("*"):
                if (
                    file.is_file()
                    and not file.is_symlink()
                    and "__pycache__" not in file.parts
                    and file.suffix != ".pyc"
                ):
                    archive.write(file, file.relative_to(package))
    if destination.stat().st_size > 200 * 1024 * 1024:
        raise RuntimeError("The deployment archive is unexpectedly large.")
    print(
        f"Built Lambda archive ({destination.stat().st_size / 1024 / 1024:.1f} MiB).",
        flush=True,
    )


def deploy(profile: str, region: str) -> None:
    session = boto3.Session(profile_name=profile, region_name=region)
    account = session.client("sts").get_caller_identity()["Account"]
    state = json.loads(STATE.read_text()) if STATE.exists() else None
    if state and (state["account"] != account or state["region"] != region):
        raise RuntimeError("Saved deployment belongs to another AWS account or region.")
    if not state:
        suffix = secrets.token_hex(4)
        state = {
            "account": account,
            "region": region,
            "id": suffix,
            "bucket": f"oriclus-{account}-{suffix}-{region}",
            "stack": f"oriclus-{suffix}",
            "secret": f"/oriclus/{suffix}/credentials",
        }
    values = dotenv_values(ROOT / ".env")
    missing = [
        key
        for key in (
            "NEBIUS_API_KEY",
            "NEBIUS_BASE_URL",
            "NEBIUS_MODEL",
            "NEBIUS_PROJECT_ID",
        )
        if not values.get(key)
    ]
    if missing:
        raise RuntimeError(
            "Missing required local configuration: " + ", ".join(missing)
        )
    archive = ROOT / ".oriclus" / "aws-lambda.zip"
    build(archive)
    s3 = session.client("s3")
    if not STATE.exists():
        kwargs = {"Bucket": state["bucket"]}
        if region != "us-east-1":
            kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        s3.create_bucket(**kwargs)
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(state, indent=2) + "\n")
        STATE.chmod(0o600)
    s3.put_public_access_block(
        Bucket=state["bucket"],
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )
    s3.put_bucket_encryption(
        Bucket=state["bucket"],
        ServerSideEncryptionConfiguration={
            "Rules": [
                {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
            ]
        },
    )
    s3.put_bucket_tagging(
        Bucket=state["bucket"],
        Tagging={"TagSet": [{"Key": "Project", "Value": "Oriclus"}]},
    )
    ssm = session.client("ssm")
    try:
        existing = json.loads(
            ssm.get_parameter(Name=state["secret"], WithDecryption=True)["Parameter"][
                "Value"
            ]
        )
        session_key = existing["ORICLUS_SESSION_KEY"]
    except ssm.exceptions.ParameterNotFound:
        session_key = secrets.token_hex(32)
    config = {name: values.get(name) or "" for name in KEYS}
    config["ORICLUS_SESSION_KEY"] = session_key
    ssm.put_parameter(
        Name=state["secret"],
        Type="SecureString",
        Value=json.dumps(config),
        Overwrite=True,
    )
    sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    key = f"artifacts/{sha}.zip"
    s3.upload_file(str(archive), state["bucket"], key)
    cf = session.client("cloudformation")
    params = [
        {"ParameterKey": name, "ParameterValue": value}
        for name, value in (
            ("DeploymentId", state["id"]),
            ("BucketName", state["bucket"]),
            ("CodeKey", key),
            ("SecretName", state["secret"]),
        )
    ]
    template = (ROOT / "deploy/aws/template.yaml").read_text()
    arguments = {
        "StackName": state["stack"],
        "TemplateBody": template,
        "Parameters": params,
        "Capabilities": ["CAPABILITY_IAM"],
    }
    try:
        cf.describe_stacks(StackName=state["stack"])
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ValidationError":
            raise
        cf.create_stack(**arguments)
    else:
        try:
            cf.update_stack(**arguments)
        except ClientError as exc:
            if "No updates are to be performed" not in str(exc):
                raise
    print(
        f"Deploying stack {state['stack']} in {region}; this can take several minutes.",
        flush=True,
    )
    last = None
    while True:
        stack = cf.describe_stacks(StackName=state["stack"])["Stacks"][0]
        status = stack["StackStatus"]
        if status != last:
            print(f"AWS stack: {status}", flush=True)
            last = status
        if status in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
            outputs = {
                item["OutputKey"]: item["OutputValue"]
                for item in stack.get("Outputs", [])
            }
            state.update(outputs)
            STATE.write_text(json.dumps(state, indent=2) + "\n")
            STATE.chmod(0o600)
            print(f"Website: {outputs['WebsiteUrl']}", flush=True)
            break
        if status.endswith(("FAILED", "ROLLBACK_COMPLETE", "ROLLBACK_FAILED")):
            events = cf.describe_stack_events(StackName=state["stack"])["StackEvents"]
            for event in events:
                if event.get("ResourceStatus", "").endswith("FAILED"):
                    print(
                        f"AWS resource failure: {event.get('LogicalResourceId')}: {event.get('ResourceStatusReason')}",
                        flush=True,
                    )
            raise RuntimeError(f"Deployment failed: {status}")
        time.sleep(8)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--region", default="us-east-1")
    args = parser.parse_args()
    os.chdir(ROOT)
    deploy(args.profile, args.region)
