"""Exercise Lambda HTTP, storage and worker flow with in-memory AWS clients."""

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_aws_storage import AtomicDynamo, MemoryS3


class SSM:
    def get_parameter(self, **kwargs):
        return {"Parameter": {"Value": json.dumps({"ORICLUS_SESSION_KEY": "ab" * 32})}}


class Queue:
    def __init__(self):
        self.events = []

    def send_message(self, **kwargs):
        self.events.append(
            {"Records": [{"eventSource": "aws:sqs", "body": kwargs["MessageBody"]}]}
        )
        return {"MessageId": "test"}


s3, db, function = MemoryS3(), AtomicDynamo(), Queue()
clients = {"s3": s3, "dynamodb": db, "sqs": function, "ssm": SSM()}
settings = {
    "ORICLUS_SECRET_PARAMETER": "test",
    "ORICLUS_QUOTA_TABLE": "test",
    "ORICLUS_BUCKET": "test",
    "ORICLUS_QUEUE": "test",
    "ORICLUS_DLQ_ARN": "test-dlq",
}
with (
    patch.dict(os.environ, settings),
    patch("boto3.client", side_effect=lambda service: clients[service]),
    patch("dotenv.dotenv_values", return_value={}),
):
    from deploy.aws import runtime

    def event(path, method="GET", payload=None, cookie=None):
        headers = {"host": "example.lambda-url.us-east-1.on.aws"}
        if cookie:
            headers["cookie"] = cookie
        if method == "POST":
            headers["content-type"] = "application/json"
            headers["origin"] = "https://example.lambda-url.us-east-1.on.aws"
        return {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": path,
            "rawQueryString": "",
            "headers": headers,
            "requestContext": {
                "domainName": "example.lambda-url.us-east-1.on.aws",
                "requestId": "test",
                "http": {
                    "method": method,
                    "path": path,
                    "sourceIp": "127.0.0.1",
                    "protocol": "HTTP/1.1",
                },
            },
            "body": json.dumps(payload) if payload is not None else None,
            "isBase64Encoded": False,
        }

    ctx = SimpleNamespace(get_remaining_time_in_millis=lambda: 900000)
    info = runtime.handler(event("/api/cloud-info"), ctx)
    assert info["statusCode"] == 200
    cookie = info["cookies"][0].split(";")[0]
    session, _ = runtime.session_from({"cookie": cookie})
    assert runtime.session_from({"cookie": cookie})[0] == session
    assert (
        runtime.session_from(
            {"cookie": cookie[:-1] + ("0" if cookie[-1] != "0" else "1")}
        )[0]
        != session
    )
    denied = runtime.handler(
        event(
            "/api/timeline/analyze",
            "POST",
            {"source": "local", "location": "/tmp"},
            cookie,
        ),
        ctx,
    )
    assert denied["statusCode"] == 400 and db.value == 0
    csrf = event(
        "/api/timeline/analyze",
        "POST",
        {"source": "github", "location": "https://github.com/a/b"},
        cookie,
    )
    csrf["headers"]["origin"] = "https://other.example"
    assert runtime.handler(csrf, ctx)["statusCode"] == 403 and db.value == 0

    async def fake_analysis(source, location, directory):
        identifier = "d" * 32
        root = runtime.time_machine.TIMELINES / identifier
        (root / "source").mkdir(parents=True)
        (root / "source" / "package.json").write_text("{}")
        analysis = {
            "id": identifier,
            "manager": "npm",
            "ecosystem": "node",
            "packages": [
                {"name": "example", "direct": True, "releases": [{"version": "1.0.0"}]}
            ],
        }
        (root / "analysis.json").write_text(json.dumps(analysis))
        return analysis

    with patch.object(runtime.web, "analyze_timeline", fake_analysis):
        created = runtime.handler(
            event(
                "/api/timeline/analyze",
                "POST",
                {"source": "github", "location": "https://github.com/a/b"},
                cookie,
            ),
            ctx,
        )
    assert created["statusCode"] == 200 and db.value == 1, created
    identifier = json.loads(created["body"])["id"]
    saved = runtime.handler(
        event("/api/timeline/analyses/" + identifier, cookie=cookie), ctx
    )
    assert saved["statusCode"] == 200, saved
    other = runtime.handler(event("/api/timeline/analyses/" + identifier), ctx)
    assert other["statusCode"] == 404, other
    started = runtime.handler(
        event(
            "/api/timeline/runs",
            "POST",
            {
                "analysis_id": identifier,
                "package": "example",
                "versions": ["1.0.0"],
                "test_command": "npm test",
            },
            cookie,
        ),
        ctx,
    )
    assert started["statusCode"] == 202, started
    assert db.value == 2 and len(function.events) == 1
    run_id = json.loads(started["body"])["id"]
    assert (
        runtime.handler(event("/api/timeline/runs/" + run_id, cookie=cookie), ctx)[
            "statusCode"
        ]
        == 200
    )
    assert (
        runtime.handler(event("/api/timeline/runs/" + run_id), ctx)["statusCode"] == 404
    )
    assert (
        runtime.handler(
            event("/api/timeline/runs/" + run_id + "/cancel", "POST", {}, cookie), ctx
        )["statusCode"]
        == 202
    )
    assert db.value == 2
    assert runtime.handler(function.events[0], ctx)["status"] == "finished"
    cancelled = runtime.handler(
        event("/api/timeline/runs/" + run_id, cookie=cookie), ctx
    )
    assert json.loads(cancelled["body"])["status"] == "cancelled"
    excessive = runtime.handler(
        event(
            "/api/timeline/runs",
            "POST",
            {
                "analysis_id": identifier,
                "package": "example",
                "versions": ["1", "2", "3", "4", "5"],
                "test_command": "npm test",
            },
            cookie,
        ),
        ctx,
    )
    assert excessive["statusCode"] == 400 and db.value == 2
    started = runtime.handler(
        event(
            "/api/timeline/runs",
            "POST",
            {
                "analysis_id": identifier,
                "package": "example",
                "versions": ["1.0.0"],
                "test_command": "npm test",
            },
            cookie,
        ),
        ctx,
    )
    completed_id = json.loads(started["body"])["id"]

    async def fake_work(self, run, analysis, path):
        run["status"] = "running"
        self._save(run)
        run["results"].append({"version": "1.0.0", "status": "passed"})
        run["status"] = "completed"
        self._save(run)

    with patch.object(runtime.CloudRuns, "_work", fake_work):
        assert runtime.handler(function.events[-1], ctx)["status"] == "finished"
    done = runtime.handler(
        event("/api/timeline/runs/" + completed_id, cookie=cookie), ctx
    )
    assert json.loads(done["body"])["status"] == "completed"
    failed_start = runtime.handler(
        event(
            "/api/timeline/runs",
            "POST",
            {
                "analysis_id": identifier,
                "package": "example",
                "versions": ["1.0.0"],
                "test_command": "npm test",
            },
            cookie,
        ),
        ctx,
    )
    failed_id = json.loads(failed_start["body"])["id"]
    failure = function.events[-1]
    failure["Records"][0]["eventSourceARN"] = "test-dlq"
    assert runtime.handler(failure, ctx)["status"] == "finished"
    failed_status = runtime.handler(
        event("/api/timeline/runs/" + failed_id, cookie=cookie), ctx
    )
    assert json.loads(failed_status["body"])["status"] == "interrupted"
    group = {
        "name": "example",
        "projects": [{"analysis_id": identifier, "name_in_project": "example"}],
    }

    async def fake_refresh(_group):
        path = runtime.time_machine.TIMELINES / identifier / "research.json"
        path.write_text('[{"title":"example"}]')

    with (
        patch.object(runtime.web, "TAVILY_KEY", "fake"),
        patch.object(runtime.news, "feed", return_value={"groups": [group]}),
        patch.object(runtime.news, "refresh_group", fake_refresh),
    ):
        started_news = runtime.handler(
            event("/api/news/refresh", "POST", {}, cookie), ctx
        )
        assert started_news["statusCode"] == 202
        assert runtime.handler(function.events[-1], ctx)["status"] == "finished"
        status = runtime.handler(event("/api/news/feed-status", cookie=cookie), ctx)
        assert json.loads(status["body"])["status"] == "completed"
        assert any(key.endswith("/research.json") for key in s3.objects)
    assert db.value == 5
    db.value = 250
    assert (
        runtime.handler(event("/api/timeline/runs", "POST", {}, cookie), ctx)[
            "statusCode"
        ]
        == 429
    )
    assert (
        runtime.handler(event("/api/cloud-info", cookie=cookie), ctx)["statusCode"]
        == 200
    )
print("Cloud sessions, persistence, quota, queued worker and cancellation passed.")
