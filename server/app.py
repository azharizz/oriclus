"""Loopback-only API and production frontend, owned by a single local process."""

import asyncio
import fcntl
import json
from contextlib import asynccontextmanager, suppress
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from server.config import (
    BASE_URL,
    DATA,
    ENV,
    IMAGE,
    KEY,
    MODEL,
    ROOT,
    TAVILY_KEY,
    BoundaryError,
    DiscoveryRequest,
    RunRequest,
)
from server.planning import Planner
from server.sandbox import cleanup, command
from server.store import Store
from server.time_machine import analyze as analyze_timeline
from server.time_machine import get_analysis
from server.time_machine import resolve as resolve_timeline
from server.timeline_execution import TimelineRuns
from server.workflow import Rehearsal

jobs: dict[str, asyncio.Task] = {}
submission_lock = asyncio.Lock()
store: Store
timeline_runs: TimelineRuns


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store, timeline_runs
    DATA.mkdir(exist_ok=True)
    with (DATA / "service.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError(
                "Oriclus is already running. Use one service process per workspace."
            ) from error
        store = Store()
        timeline_runs = TimelineRuns()
        timeline_runs.interrupt_unfinished()
        store.interrupt_unfinished()
        # Allow history/UI access without Docker. POST /runs checks readiness.
        with suppress(BoundaryError, OSError):
            await cleanup()
        yield
        for task in jobs.values():
            if not task.cancelling():
                task.cancel()
        await asyncio.gather(*jobs.values(), return_exceptions=True)
        timeline_tasks = list(timeline_runs.tasks.values())
        for task in timeline_tasks:
            task.cancel()
        await asyncio.gather(*timeline_tasks, return_exceptions=True)
        store.db.close()


app = FastAPI(title="Oriclus", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"]
)


@app.middleware("http")
async def local_boundary(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != "http" or parsed.netloc not in (
                "127.0.0.1:8787",
                "localhost:8787",
                "127.0.0.1:5173",
                "localhost:5173",
            ):
                return JSONResponse(
                    {"detail": "This local API rejects requests from other websites."},
                    status_code=403,
                )
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse(
                {"detail": "Cross-site requests are not allowed."}, status_code=403
            )
        if not request.headers.get("content-type", "").startswith("application/json"):
            return JSONResponse({"detail": "Use application/json."}, status_code=415)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


async def readiness() -> dict:
    try:
        daemon = await command("docker", "info", "--format", "{{.ServerVersion}}")
        image = (
            await command("docker", "image", "inspect", IMAGE, "--format", "{{.Id}}")
            if daemon.exit_code == 0
            else None
        )
        return {
            "docker": daemon.exit_code == 0,
            "image": bool(image and image.exit_code == 0),
            "model": MODEL,
            "inference_configured": bool(KEY and MODEL and BASE_URL),
            "tavily_configured": bool(TAVILY_KEY),
            "sandbox_configured": bool(
                ENV.get("NEBIUS_PROJECT_ID")
                and (ENV.get("NEBIUS_SANDBOX_API_KEY") or KEY)
            ),
            "sandbox": "Docker filesystem snapshots",
        }
    except FileNotFoundError:
        return {
            "docker": False,
            "image": False,
            "model": MODEL,
            "inference_configured": bool(KEY and MODEL and BASE_URL),
            "tavily_configured": bool(TAVILY_KEY),
            "sandbox_configured": bool(
                ENV.get("NEBIUS_PROJECT_ID")
                and (ENV.get("NEBIUS_SANDBOX_API_KEY") or KEY)
            ),
            "sandbox": "Docker filesystem snapshots",
        }


@app.get("/api/health")
async def health():
    return {**await readiness(), "active_run": store.active_run()}


@app.get("/api/example")
async def example():
    return json.loads((ROOT / "examples/httpx-starlette.json").read_text())


@app.post("/api/setup/validate")
async def validate_setup(spec: RunRequest):
    return spec.model_dump()


@app.get("/api/runs")
async def list_runs(
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str, Query(max_length=120)] = "",
    status: Annotated[str, Query(max_length=30)] = "",
):
    return store.run_page(limit, offset, q, status)


def require_run(run_id: str) -> dict:
    run = store.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found.")
    return run


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str, brief: bool = False):
    run = require_run(run_id)
    if brief:
        run["research_count"] = len(run.pop("research", []))
        if run.get("upstream"):
            run["upstream"].pop("diff", None)
        for consumer in run["consumers"]:
            for execution in (consumer.get("baseline"), consumer.get("candidate")):
                if execution:
                    execution.pop("output", None)
            for attempt in consumer["attempts"]:
                if attempt.get("verification"):
                    attempt["verification"].pop("output", None)
                attempt.pop("explanation", None)
        latest = store.event_page(run_id, 1, 0, "")["items"]
        run["activity"] = latest[0]["title"] if latest else None
    return run


@app.get("/api/runs/{run_id}/events")
async def get_events(
    run_id: str,
    limit: Annotated[int, Query(ge=1, le=50)] = 15,
    offset: Annotated[int, Query(ge=0)] = 0,
    kind: Annotated[str, Query(max_length=30)] = "",
):
    require_run(run_id)
    return store.event_page(run_id, limit, offset, kind)


@app.get("/api/runs/{run_id}/events/{event_id}")
async def get_event(run_id: str, event_id: int):
    require_run(run_id)
    event = store.event_data(run_id, event_id)
    if event is None:
        raise HTTPException(404, "Event not found.")
    return event


@app.get("/api/runs/{run_id}/research")
async def get_research(run_id: str, offset: Annotated[int, Query(ge=0)] = 0):
    sources = require_run(run_id).get("research", [])
    return {"items": sources[offset : offset + 5], "total": len(sources)}


@app.get("/api/runs/{run_id}/consumers/{index}")
async def get_consumer(run_id: str, index: int):
    consumers = require_run(run_id)["consumers"]
    if not 0 <= index < len(consumers):
        raise HTTPException(404, "Downstream result not found.")
    return consumers[index]


async def require_available(execution: bool = True):
    if any(not task.done() for task in jobs.values()):
        raise HTTPException(
            409, "Another check is active. Open it to follow progress or cancel it."
        )
    state = (
        await readiness()
        if execution
        else {"inference_configured": bool(KEY and MODEL and BASE_URL)}
    )
    if not state["inference_configured"]:
        raise HTTPException(
            503, "Configure NEBIUS_API_KEY, NEBIUS_MODEL and NEBIUS_BASE_URL in .env."
        )
    if execution and (not state["docker"] or not state["image"]):
        raise HTTPException(
            503,
            "Start Docker and build the sandbox image using the README setup command.",
        )
    jobs.clear()


@app.post("/api/runs/prepare", status_code=202)
async def prepare_run(spec: DiscoveryRequest):
    async with submission_lock:
        await require_available(execution=False)
        run = store.create(
            {
                "title": spec.upstream.rsplit("/", 1)[-1],
                "upstream": spec.upstream,
                "baseline_ref": spec.baseline_ref,
                "candidate_ref": spec.candidate_ref,
                "package": "",
                "repair_attempts": 1,
                "consumers": [],
            },
            status="planning",
        )
        run["discovery"] = spec.model_dump()
        store.save(run)
        jobs[run["id"]] = asyncio.create_task(Planner(store, run).execute())
        return run


@app.post("/api/runs/{run_id}/start", status_code=202)
async def start_prepared(run_id: str, spec: RunRequest):
    async with submission_lock:
        run = require_run(run_id)
        if run["status"] != "ready":
            raise HTTPException(409, "This setup is no longer waiting for review.")
        await require_available()
        run["prepared_request"] = run["request"]
        run.update(request=spec.model_dump(), status="queued", error=None)
        store.event(run_id, "planning", "Reviewed setup accepted", run["request"])
        store.save(run)
        jobs[run_id] = asyncio.create_task(Rehearsal(store, run).execute())
        return run


@app.post("/api/runs", status_code=202)
async def create_run(spec: RunRequest):
    async with submission_lock:
        await require_available()
        run = store.create(spec.model_dump())
        jobs[run["id"]] = asyncio.create_task(Rehearsal(store, run).execute())
        return run


@app.post("/api/runs/{run_id}/cancel", status_code=202)
async def cancel_run(run_id: str):
    require_run(run_id)
    task = jobs.get(run_id)
    if not task or task.done():
        raise HTTPException(409, "This run is no longer executing.")
    if not task.cancelling():
        task.cancel()
    return {"status": "cancelling"}


@app.get("/api/runs/{run_id}/artifacts/{name}")
async def artifact(run_id: str, name: str):
    run = require_run(run_id)
    known = [a.get("patch") for c in run["consumers"] for a in c["attempts"]]
    if name not in known:
        raise HTTPException(404, "Patch not found.")
    return FileResponse(
        DATA / "artifacts" / run_id / name,
        media_type="text/x-diff",
        filename=f"oriclus-{run_id[:8]}-{name}",
    )


@app.get("/api/runs/{run_id}/export")
async def export(run_id: str):
    run = require_run(run_id)
    return JSONResponse(
        {**run, "events": store.events(run_id)},
        headers={
            "Content-Disposition": f'attachment; filename="oriclus-{run["id"][:8]}.json"'
        },
    )


class TimelineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(pattern="^(local|github)$")
    location: str = Field(min_length=1, max_length=4096)


class TimelineSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern="^[0-9a-f]{32}$")
    package: str = Field(min_length=1, max_length=214)
    version: str = Field(min_length=1, max_length=128)


class TimelineRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    analysis_id: str = Field(pattern="^[0-9a-f]{32}$")
    package: str = Field(min_length=1, max_length=214)
    versions: list[str] = Field(min_length=1, max_length=5)
    test_command: str = Field(min_length=1, max_length=8000)


@app.post("/api/timeline/analyze")
async def timeline_analyze(spec: TimelineRequest):
    try:
        return await analyze_timeline(spec.source, spec.location)
    except (BoundaryError, ValueError, OSError) as error:
        raise HTTPException(400, str(error)) from error


@app.post("/api/timeline/resolve")
async def timeline_resolve(spec: TimelineSelection):
    try:
        return await resolve_timeline(spec.id, spec.package, spec.version)
    except (BoundaryError, ValueError) as error:
        raise HTTPException(400, str(error)) from error


@app.get("/api/timeline/analyses/{analysis_id}")
async def timeline_analysis(analysis_id: str):
    try:
        return get_analysis(analysis_id)
    except (BoundaryError, OSError, ValueError) as error:
        raise HTTPException(404, "Timeline analysis not found.") from error


@app.get("/api/timeline/runs")
async def timeline_recent(limit: Annotated[int, Query(ge=1, le=100)] = 10):
    return timeline_runs.recent(limit)


@app.post("/api/timeline/runs", status_code=202)
async def timeline_start(spec: TimelineRunRequest):
    try:
        return await timeline_runs.start(
            spec.analysis_id, spec.package, spec.versions, spec.test_command
        )
    except (BoundaryError, ValueError) as error:
        raise HTTPException(400, str(error)) from error


@app.get("/api/timeline/runs/{run_id}")
async def timeline_get(run_id: str):
    run = timeline_runs.get(run_id)
    if not run:
        raise HTTPException(404, "Timeline run not found.")
    return run


@app.post("/api/timeline/runs/{run_id}/cancel", status_code=202)
async def timeline_cancel(run_id: str):
    run = await timeline_runs.cancel(run_id)
    if not run:
        raise HTTPException(404, "Timeline run not found.")
    if run["status"] != "cancelling":
        raise HTTPException(409, "Timeline run is no longer executing.")
    return run


if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="web")
