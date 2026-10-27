"""Fast regression checks for real trust, data and lifecycle boundaries."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from pydantic import ValidationError

from server import agent
from server import app as api_module
from server.config import BoundaryError, RunRequest
from server.sandbox import command
from server.store import Store, stop_incomplete
from server.workflow import validate_patch_paths

EXAMPLE = json.loads(
    (Path(__file__).parent.parent / "examples/httpx-starlette.json").read_text()
)


class Contracts(unittest.TestCase):
    def test_input_contract(self):
        spec = RunRequest.model_validate(EXAMPLE)
        self.assertEqual(spec.package, "httpx")
        for url in [
            "file:///etc/passwd",
            "https://github.com@localhost/x/y",
            "https://github.com/a/b?token=secret",
            "http://github.com/a/b",
        ]:
            with self.assertRaises(ValidationError):
                RunRequest.model_validate({**EXAMPLE, "upstream": url})
        for ref in ["--upload-pack=evil", "main;whoami", "../secret"]:
            with self.assertRaises(ValidationError):
                RunRequest.model_validate({**EXAMPLE, "candidate_ref": ref})
        with self.assertRaises(ValidationError):
            RunRequest.model_validate({**EXAMPLE, "consumers": []})

    def test_verification_scope(self):
        validate_patch_paths(["src/client.py"], ["src/"])
        for paths in [
            [],
            ["tests/test_client.py"],
            ["src/../tests/a.py"],
            ["src/tests/a.py"],
            ["src/conftest.py"],
            ["/src/client.py"],
            ["src_fake/a.py"],
        ]:
            with self.assertRaises(BoundaryError):
                validate_patch_paths(paths, ["src/"])

    def test_cancelled_children_do_not_stay_running(self):
        run = {
            "consumers": [
                {
                    "status": "repairing",
                    "attempts": [{"status": "working"}, {"status": "verified"}],
                }
            ]
        }
        stop_incomplete(run, "cancelled")
        self.assertEqual(run["consumers"][0]["status"], "cancelled")
        self.assertEqual(
            [a["status"] for a in run["consumers"][0]["attempts"]],
            ["cancelled", "verified"],
        )

    def test_durable_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "history.sqlite3"
            store = Store(db)
            run = store.create(EXAMPLE)
            run["status"] = "running"
            store.save(run)
            store.event(run["id"], "execution", "Real observation", {"exit_code": 1})
            store.db.close()
            reopened = Store(db)
            reopened.interrupt_unfinished()
            self.assertEqual(reopened.get(run["id"])["status"], "interrupted")
            self.assertEqual(reopened.events(run["id"])[0]["data"]["exit_code"], 1)
            reopened.db.close()


class Boundaries(unittest.IsolatedAsyncioTestCase):
    async def test_budget_keeps_edits_for_independent_verification(self):
        tool_message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "test-call",
                    "type": "function",
                    "function": {
                        "name": "shell",
                        "arguments": '{"command":"edit-source"}',
                    },
                }
            ],
        }
        shell = AsyncMock(return_value={"exit_code": 0, "output": "source edited"})
        events = []
        with (
            patch.object(agent, "MAX_TURNS", 1),
            patch.object(
                agent, "completion", AsyncMock(return_value=(tool_message, {}))
            ),
        ):
            note = await agent.repair(
                "Test the protocol boundary", shell, lambda *event: events.append(event)
            )
        shell.assert_awaited_once_with("edit-source")
        self.assertIn("independent verification", note)
        self.assertEqual(events[-1][1], "Repair turn budget reached")

    async def test_subprocess_io_and_output_limit(self):
        result = await command(
            "python3",
            "-c",
            "import sys; print(sys.stdin.read()); sys.exit(7)",
            stdin="actual stdin",
        )
        self.assertEqual(result.exit_code, 7)
        self.assertIn("actual stdin", result.output)
        limited = await command("python3", "-c", 'print("x" * 200)', limit=30)
        self.assertTrue(limited.truncated)
        self.assertIn("omitted", limited.output)

    async def test_history_thread_and_http_security(self):
        with tempfile.TemporaryDirectory() as directory:
            local_store = Store(Path(directory) / "api.sqlite3")
            with patch.object(api_module, "store", local_store, create=True):
                run = local_store.create(EXAMPLE)
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=api_module.app),
                    base_url="http://127.0.0.1:8787",
                ) as client:
                    for path in [
                        "/api/runs",
                        f"/api/runs/{run['id']}",
                        f"/api/runs/{run['id']}/events",
                        f"/api/runs/{run['id']}/export",
                    ]:
                        self.assertEqual(
                            (await client.get(path)).status_code, 200, path
                        )
                    self.assertEqual(
                        (
                            await client.post(
                                "/api/runs",
                                json=EXAMPLE,
                                headers={"Origin": "https://evil.example"},
                            )
                        ).status_code,
                        403,
                    )
                    self.assertEqual(
                        (await client.post("/api/runs", content="x")).status_code, 415
                    )
                    self.assertEqual(
                        (
                            await client.get(
                                "/api/runs", headers={"Host": "evil.example"}
                            )
                        ).status_code,
                        400,
                    )
                    self.assertEqual(
                        (
                            await client.get(
                                f"/api/runs/{run['id']}/artifacts/unknown.patch"
                            )
                        ).status_code,
                        404,
                    )
                    with patch.object(
                        api_module,
                        "readiness",
                        AsyncMock(
                            return_value={
                                "docker": True,
                                "image": True,
                                "inference_configured": False,
                            }
                        ),
                    ):
                        self.assertEqual(
                            (await client.post("/api/runs", json=EXAMPLE)).status_code,
                            503,
                        )
                    self.assertEqual(len(local_store.list()), 1)
            local_store.db.close()

    async def test_concurrent_submission_is_serialized(self):
        async def ready():
            await asyncio.sleep(0)
            return {"docker": True, "image": True, "inference_configured": True}

        async def pending(_self):
            await asyncio.Event().wait()

        with tempfile.TemporaryDirectory() as directory:
            local_store = Store(Path(directory) / "race.sqlite3")
            with (
                patch.object(api_module, "store", local_store, create=True),
                patch.object(api_module, "jobs", {}),
                patch.object(api_module, "submission_lock", asyncio.Lock()),
                patch.object(api_module, "readiness", ready),
                patch.object(api_module.Rehearsal, "execute", pending),
            ):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=api_module.app),
                    base_url="http://127.0.0.1:8787",
                ) as client:
                    responses = await asyncio.gather(
                        client.post("/api/runs", json=EXAMPLE),
                        client.post("/api/runs", json=EXAMPLE),
                    )
                    self.assertEqual(
                        sorted(r.status_code for r in responses), [202, 409]
                    )
                    for task in api_module.jobs.values():
                        task.cancel()
                    await asyncio.gather(
                        *api_module.jobs.values(), return_exceptions=True
                    )
            local_store.db.close()


if __name__ == "__main__":
    unittest.main()
