"""AWS Lambda adapter for the single-operator Oriclus workspace."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from http.cookies import SimpleCookie
from pathlib import Path
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError
from mangum import Mangum
from starlette.middleware.gzip import GZipMiddleware

from deploy.aws.storage import Quota, Storage

os.environ["ORICLUS_AWS"] = "1"
os.environ["AGENT_MAX_TURNS"] = "6"
secret = json.loads(
    boto3.client("ssm").get_parameter(
        Name=os.environ["ORICLUS_SECRET_PARAMETER"], WithDecryption=True
    )["Parameter"]["Value"]
)
session_key = bytes.fromhex(secret.pop("ORICLUS_SESSION_KEY"))
for name in (
    "NEBIUS_API_KEY",
    "NEBIUS_BASE_URL",
    "NEBIUS_MODEL",
    "NEBIUS_PROJECT_ID",
    "NEBIUS_SANDBOX_API_KEY",
    "TAVILY_API_KEY",
):
    if secret.get(name):
        os.environ[name] = secret[name]

from server import app as web  # noqa: E402
from server import news, time_machine, timeline_execution  # noqa: E402
from server.config import BoundaryError, safe_error  # noqa: E402
from server.store import Store  # noqa: E402

s3 = boto3.client("s3")
sqs = boto3.client("sqs")
quota = Quota(boto3.client("dynamodb"), os.environ["ORICLUS_QUOTA_TABLE"])
BUCKET = os.environ["ORICLUS_BUCKET"]
QUEUE = os.environ["ORICLUS_QUEUE"]
DLQ_ARN = os.environ.get("ORICLUS_DLQ_ARN", "")
ROOT = Path("/tmp/oriclus-session")
web.app.add_middleware(GZipMiddleware, minimum_size=1000)
adapter = Mangum(web.app, lifespan="off")
COSTLY = {
    "/api/timeline/analyze",
    "/api/timeline/resolve",
    "/api/timeline/runs",
    "/api/timeline/research",
    "/api/news/refresh",
}
ALLOWED_API = ("/api/health", "/api/cloud-info", "/api/timeline/", "/api/news/")
COOKIE = "oriclus_session"


def sign_session(session: str) -> str:
    return hmac.new(session_key, session.encode(), hashlib.sha256).hexdigest()


def session_from(headers: dict) -> tuple[str, str | None]:
    cookie = SimpleCookie()
    try:
        cookie.load(headers.get("cookie", ""))
        token = cookie[COOKIE].value if COOKIE in cookie else ""
    except (ValueError, TypeError):
        token = ""
    match = re.fullmatch(r"([a-f0-9]{64})\.([a-f0-9]{64})", token)
    if match and hmac.compare_digest(sign_session(match[1]), match[2]):
        return match[1], None
    session = secrets.token_hex(32)
    return (
        session,
        f"{COOKIE}={session}.{sign_session(session)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000",
    )


def response(status: int, body: dict, cookie: str | None = None) -> dict:
    result = {
        "statusCode": status,
        "headers": {
            "content-type": "application/json",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
        "body": json.dumps(body),
        "isBase64Encoded": False,
    }
    if cookie:
        result["cookies"] = [cookie]
    return result


def serve(event, context):
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())
    return adapter(event, context)


class Progress:
    def __init__(self, store: Storage):
        self.store = store

    def __len__(self):
        return sum(
            len(page.get("Contents", []))
            for page in self.store.s3.get_paginator("list_objects_v2").paginate(
                Bucket=self.store.bucket, Prefix=self.store.prefix + "progress/"
            )
        )

    def __iter__(self):
        for page in self.store.s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.store.bucket, Prefix=self.store.prefix + "progress/"
        ):
            for item in page.get("Contents", []):
                yield item["Key"].rsplit("/", 1)[-1]

    def __getitem__(self, key):
        data = self.store.get_json("progress/" + key)
        if data is None:
            raise KeyError(key)
        return data

    def __setitem__(self, key, value):
        self.store.put_json("progress/" + key, value)

    def __delitem__(self, key):
        self.store.delete("progress/" + key)

    def get(self, key, default=None):
        return self.store.get_json("progress/" + key) or default


def invoke_worker(session: str, kind: str, identifier: str):
    sqs.send_message(
        QueueUrl=QUEUE,
        MessageBody=json.dumps({"kind": kind, "session": session, "id": identifier}),
    )


def configure_session(session: str) -> Storage:
    store = Storage(s3, BUCKET, session, ROOT)
    store.restore()
    time_machine.TIMELINES = ROOT / "timeline"
    timeline_execution.RUNS = ROOT / "timeline-runs"
    web.DATA = ROOT
    web.store = Store(ROOT / "runs.sqlite3")
    web.resolution_progress = Progress(store)
    web.timeline_runs = CloudRuns(store)
    return store


class CloudRuns(timeline_execution.TimelineRuns):
    def __init__(self, store: Storage):
        self.store = store
        super().__init__()

    def _save(self, run: dict) -> None:
        run["last_updated_at"] = time.time()
        super()._save(run)
        path = timeline_execution.RUNS / (run["id"] + ".json")
        self.store.put(
            "data/timeline-runs/" + path.name,
            path.read_bytes(),
            ContentType="application/json",
        )
        self.store.initial[f"timeline-runs/{path.name}"] = hashlib.sha256(
            path.read_bytes()
        ).hexdigest()

    async def start(self, *args, **kwargs):
        run = await super().start(*args, **kwargs)
        task = self.tasks.pop(run["id"])
        task.cancel()
        try:
            self.store.commit()
            self.store.put_json(
                "runtime/active-run.json", {"id": run["id"], "title": run["package"]}
            )
            await asyncio.to_thread(invoke_worker, self.store.session, "run", run["id"])
        except Exception:  # noqa: BLE001 - preserve failed dispatch
            run["status"] = "failed"
            run["error"] = "Could not start the background worker."
            self._save(run)
            raise BoundaryError(run["error"]) from None
        return run

    async def cancel(self, run_id: str):
        run = self.get(run_id)
        if run and run["status"] in ("queued", "running", "cancelling"):
            self.store.put("control/run-" + run_id, b"cancel")
            run["status"] = "cancelling"
            self._save(run)
        return run


def news_request(
    store: Storage, path: str, method: str, payload: dict
) -> tuple[int, dict] | None:
    state = store.get_json("runtime/news.json")
    if (
        state
        and state["status"] in ("running", "cancelling")
        and state.get("worker_started_at")
        and time.time() - state["worker_started_at"] > 960
    ):
        state["status"] = "failed"
        state["errors"].append(
            {
                "package": state.get("current"),
                "message": "The worker exceeded its time limit; partial research was retained.",
            }
        )
        store.put_json("runtime/news.json", state)
        store.delete("runtime/news-lock")
    if path == "/api/news/feed-status" and method == "GET":
        return 200, state
    match = re.fullmatch(r"/api/news/refresh/([a-f0-9]{32})(/cancel)?", path)
    if match:
        if not state or state.get("id") != match[1]:
            return 404, {"detail": "Feed refresh not found."}
        if (
            match[2]
            and method == "POST"
            and state["status"] in ("queued", "running", "cancelling")
        ):
            store.put("control/news-" + match[1], b"cancel")
            state["status"] = "cancelling"
            store.put_json("runtime/news.json", state)
        return 200, state
    if path != "/api/news/refresh" or method != "POST":
        return None
    if state and state["status"] in ("queued", "running", "cancelling"):
        return 409, {"detail": "A feed refresh is already running."}
    try:
        spec = web.FeedRefreshRequest.model_validate(payload)
    except ValueError:
        return 400, {"detail": "Invalid feed refresh request."}
    groups = [
        group
        for group in news.feed()["groups"]
        if spec.query.strip().lower() in group["name"].lower()
        and (
            not spec.analysis_id
            or any(p["analysis_id"] == spec.analysis_id for p in group["projects"])
        )
    ]
    if not web.TAVILY_KEY:
        return 400, {"detail": "Tavily is not configured."}
    if not groups:
        return 400, {"detail": "No libraries match the current filters."}
    if len(groups) > 5:
        return 400, {
            "detail": "Filter the hosted news feed to at most five libraries before refreshing."
        }
    identifier = uuid4().hex
    state = {
        "id": identifier,
        "status": "running",
        "started_at": time.time(),
        "total": len(groups),
        "completed": 0,
        "failed": 0,
        "current": None,
        "errors": [],
        "analysis_id": spec.analysis_id,
        "query": spec.query,
    }
    # Conditional creation prevents two simultaneous refreshes for one session.
    try:
        store.put("runtime/news-lock", identifier.encode(), IfNoneMatch="*")
    except ClientError as exc:
        if exc.response["Error"]["Code"] in (
            "PreconditionFailed",
            "412",
            "ConditionalRequestConflict",
        ):
            return 409, {"detail": "A feed refresh is already running."}
        raise
    store.put_json("runtime/news.json", state)
    try:
        invoke_worker(store.session, "news", identifier)
    except Exception:  # noqa: BLE001 - preserve failed dispatch
        store.delete("runtime/news-lock")
        state["status"] = "failed"
        state["errors"].append(
            {"package": None, "message": "Could not start the background worker."}
        )
        store.put_json("runtime/news.json", state)
        return 503, {"detail": "Could not start the background worker."}
    return 202, state


async def work_run(store: Storage, run_id: str, context):
    runs = CloudRuns(store)
    run = runs.get(run_id)
    if not run or run["status"] not in ("queued", "cancelling"):
        return
    if store.get("control/run-" + run_id):
        run.update(status="cancelled", error="Cancelled before the worker started.")
        runs._save(run)
        return
    analysis = time_machine.get_analysis(run["analysis_id"])
    task = asyncio.create_task(
        runs._work(run, analysis, time_machine.snapshot_path(run["analysis_id"]))
    )
    timed_out = False
    while not task.done():
        await asyncio.sleep(1)
        if store.get("control/run-" + run_id):
            task.cancel()
            break
        if context.get_remaining_time_in_millis() < 20000:
            timed_out = True
            task.cancel()
            break
    await asyncio.gather(task, return_exceptions=True)
    if timed_out:
        run.update(
            status="interrupted",
            error="The AWS worker reached its time limit; the partial evidence is saved.",
        )
        runs._save(run)
    store.delete("control/run-" + run_id)


async def work_news(store: Storage, refresh_id: str, context):
    state = store.get_json("runtime/news.json")
    if not state or state["id"] != refresh_id:
        return
    try:
        groups = [
            group
            for group in news.feed()["groups"]
            if state["query"].strip().lower() in group["name"].lower()
            and (
                not state["analysis_id"]
                or any(
                    p["analysis_id"] == state["analysis_id"] for p in group["projects"]
                )
            )
        ]
        state["status"] = "running"
        state["worker_started_at"] = time.time()
        store.put_json("runtime/news.json", state)
        for group in groups:
            if store.get("control/news-" + refresh_id):
                state["status"] = "cancelled"
                break
            if context.get_remaining_time_in_millis() < 80000:
                state["status"] = "failed"
                state["errors"].append(
                    {
                        "package": group["name"],
                        "message": "The AWS worker reached its time limit; partial research is saved.",
                    }
                )
                break
            state["current"] = group["name"]
            store.put_json("runtime/news.json", state)
            try:
                await news.refresh_group(group)
                store.commit()
            except (BoundaryError, OSError, ValueError) as exc:
                state["failed"] += 1
                state["errors"].append(
                    {"package": group["name"], "message": safe_error(exc)}
                )
            state["completed"] += 1
            store.put_json("runtime/news.json", state)
        else:
            state["status"] = "completed"
    except Exception:  # noqa: BLE001 - preserve partial research
        state["status"] = "failed"
        state["errors"].append(
            {
                "package": state.get("current"),
                "message": "The research worker failed; partial results are saved.",
            }
        )
    finally:
        state["current"] = None
        store.put_json("runtime/news.json", state)
        store.delete("control/news-" + refresh_id)
        store.delete("runtime/news-lock")


def handler(event, context):
    if event.get("Records"):
        for record in event["Records"]:
            if record.get("eventSource") != "aws:sqs":
                raise ValueError("Unexpected worker event")
            payload = json.loads(record["body"])
            if DLQ_ARN and record.get("eventSourceARN") == DLQ_ARN:
                handle_failed_job(payload)
            else:
                handle_event(payload, context)
        return {"status": "finished"}
    path = event.get("rawPath", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    if method == "POST" and path in ("/api/timeline/analyze", "/api/timeline/resolve"):
        token = secrets.token_hex(16)
        slot = quota.acquire(token)
        if not slot:
            return response(
                429,
                {"detail": "The hosted workspace is busy. Please try again shortly."},
            )
        try:
            return handle_event(event, context)
        finally:
            quota.release(slot, token)
    return handle_event(event, context)


def handle_failed_job(event):
    session, identifier = event.get("session", ""), event.get("id", "")
    if not re.fullmatch(r"[a-f0-9]{64}", session) or not re.fullmatch(
        r"[a-f0-9]{32}", identifier
    ):
        raise ValueError("Invalid failed worker event")
    store = configure_session(session)
    try:
        if event.get("kind") == "run":
            runs = CloudRuns(store)
            run = runs.get(identifier)
            if run and run.get("status") in ("queued", "running", "cancelling"):
                run.update(
                    status="interrupted",
                    error="The AWS worker failed or timed out; partial evidence was retained.",
                )
                runs._save(run)
            store.delete("control/run-" + identifier)
        elif event.get("kind") == "news":
            state = store.get_json("runtime/news.json")
            if (
                state
                and state.get("id") == identifier
                and state.get("status") in ("queued", "running", "cancelling")
            ):
                state["status"] = "failed"
                state["errors"].append(
                    {
                        "package": state.get("current"),
                        "message": "The AWS worker failed or timed out; partial research was retained.",
                    }
                )
                state["current"] = None
                store.put_json("runtime/news.json", state)
            store.delete("control/news-" + identifier)
            store.delete("runtime/news-lock")
    finally:
        web.store.db.close()


def handle_event(event, context):
    if event.get("kind") in ("run", "news"):
        session, identifier = event.get("session", ""), event.get("id", "")
        if not re.fullmatch(r"[a-f0-9]{64}", session) or not re.fullmatch(
            r"[a-f0-9]{32}", identifier
        ):
            raise ValueError("Invalid worker event")
        store = configure_session(session)
        try:
            asyncio.run(
                work_run(store, identifier, context)
                if event["kind"] == "run"
                else work_news(store, identifier, context)
            )
            store.commit()
        finally:
            web.store.db.close()
        return {"status": "finished"}

    headers = {k.lower(): v for k, v in event.get("headers", {}).items()}
    if event.get("cookies"):
        headers["cookie"] = "; ".join(event["cookies"])
    session, cookie = session_from(headers)
    path = event.get("rawPath", "/")
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    host = event.get("requestContext", {}).get("domainName", "")
    if method not in ("GET", "HEAD", "OPTIONS"):
        origin = headers.get("origin")
        if (origin and origin != "https://" + host) or headers.get(
            "sec-fetch-site"
        ) == "cross-site":
            return response(
                403, {"detail": "Cross-site requests are not allowed."}, cookie
            )
        if not headers.get("content-type", "").startswith("application/json"):
            return response(415, {"detail": "Use application/json."}, cookie)
    if path.startswith("/api/") and not any(
        path == prefix or (prefix.endswith("/") and path.startswith(prefix))
        for prefix in ALLOWED_API
    ):
        return response(
            404, {"detail": "Not available in the hosted workspace."}, cookie
        )
    try:
        body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode()
        payload = json.loads(body) if method == "POST" else {}
        if not isinstance(payload, dict):
            raise ValueError("Invalid request body")
    except (ValueError, UnicodeDecodeError):
        return response(400, {"detail": "Invalid request body."}, cookie)
    if path == "/api/timeline/analyze" and payload.get("source") != "github":
        return response(
            400,
            {
                "detail": "The hosted app supports public GitHub projects. Local directories remain available in the local app."
            },
            cookie,
        )
    if method == "POST" and path == "/api/timeline/runs":
        selections = payload.get("selections") or {
            payload.get("package"): payload.get("versions", [])
        }
        if isinstance(selections, dict) and all(
            isinstance(versions, list) for versions in selections.values()
        ):
            count = 1
            for versions in selections.values():
                count *= len(versions)
            if count > 4:
                return response(
                    400,
                    {
                        "detail": "The hosted demo supports at most four combinations per experiment."
                    },
                    cookie,
                )
    if method == "POST" and path in COSTLY and quota.consume() is None:
        return response(
            429,
            {"detail": "The shared lifetime limit of 250 operations has been reached."},
            cookie,
        )
    if path == "/api/cloud-info":
        used = quota.used()
        return response(
            200,
            {
                "enabled": True,
                "limit": quota.limit,
                "used": used,
                "remaining": max(0, quota.limit - used),
            },
            cookie,
        )
    if not path.startswith("/api/"):
        event["headers"] = {**headers, "host": "127.0.0.1:8787"}
        result = serve(event, context)
        if cookie:
            result.setdefault("cookies", []).append(cookie)
        return result

    fast_store = Storage(s3, BUCKET, session, ROOT)
    if path == "/api/health":
        active = fast_store.get_json("runtime/active-run.json")
        if active:
            saved = fast_store.get_json("data/timeline-runs/" + active["id"] + ".json")
            if not saved or saved.get("status") not in (
                "queued",
                "running",
                "cancelling",
            ):
                active = None
        return response(
            200,
            {
                "docker": False,
                "image": False,
                "model": web.MODEL,
                "inference_configured": bool(web.KEY and web.MODEL and web.BASE_URL),
                "tavily_configured": bool(web.TAVILY_KEY),
                "sandbox_configured": bool(
                    web.ENV.get("NEBIUS_PROJECT_ID")
                    and (web.ENV.get("NEBIUS_SANDBOX_API_KEY") or web.KEY)
                ),
                "sandbox": "Nebius Sandboxes",
                "active_run": active,
            },
            cookie,
        )
    progress_match = re.fullmatch(
        r"/api/timeline/resolution-progress/([a-f0-9]{32})", path
    )
    if progress_match and method == "GET":
        return response(
            200,
            fast_store.get_json("progress/" + progress_match[1])
            or {"stage": "queued", "status": "running"},
            cookie,
        )
    run_match = re.fullmatch(r"/api/timeline/runs/([a-f0-9]{32})(/cancel)?", path)
    if run_match:
        saved = fast_store.get_json("data/timeline-runs/" + run_match[1] + ".json")
        if not saved:
            return response(404, {"detail": "Timeline run not found."}, cookie)
        if (
            saved.get("status") in ("running", "cancelling")
            and time.time() - saved.get("last_updated_at", time.time()) > 960
        ):
            saved["status"] = "interrupted"
            saved["error"] = (
                "The AWS worker stopped responding; partial evidence was retained."
            )
            fast_store.put_json("data/timeline-runs/" + run_match[1] + ".json", saved)
        if method == "GET" and not run_match[2]:
            return response(200, saved, cookie)
        if method == "POST" and run_match[2]:
            if saved.get("status") not in ("queued", "running", "cancelling"):
                return response(
                    409, {"detail": "Timeline run is no longer executing."}, cookie
                )
            fast_store.put("control/run-" + run_match[1], b"cancel")
            saved["status"] = "cancelling"
            fast_store.put_json("data/timeline-runs/" + run_match[1] + ".json", saved)
            return response(202, saved, cookie)
    if (
        path == "/api/news/feed-status"
        or re.fullmatch(r"/api/news/refresh/[a-f0-9]{32}(/cancel)?", path)
    ) and (special := news_request(fast_store, path, method, payload)) is not None:
        return response(special[0], special[1], cookie)
    store = configure_session(session)
    try:
        if (
            path == "/api/news/refresh"
            and (special := news_request(store, path, method, payload)) is not None
        ):
            return response(special[0], special[1], cookie)
        event["headers"] = {**headers, "host": "127.0.0.1:8787"}
        if "origin" in event["headers"]:
            event["headers"]["origin"] = "http://127.0.0.1:8787"
        result = serve(event, context)
        store.commit()
        if cookie:
            result.setdefault("cookies", []).append(cookie)
        return result
    finally:
        web.store.db.close()
