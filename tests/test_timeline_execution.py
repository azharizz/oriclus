import asyncio
import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from server.timeline_execution import (
    Sandbox,
    TimelineRuns,
    _archive,
    _patch_allowed,
    _repair,
)


class ExecutionTests(unittest.TestCase):
    def test_patch_rejects_tests_and_metadata(self):
        self.assertTrue(_patch_allowed(["src/app.py"]))
        self.assertFalse(_patch_allowed(["src/app.py", "tests/test_app.py"]))
        self.assertFalse(_patch_allowed(["package.json"]))
        self.assertFalse(_patch_allowed(["../outside.py"]))
        self.assertFalse(_patch_allowed(["test.cjs"]))
        self.assertFalse(_patch_allowed(["src/app.test.mjs"]))

    def test_archive_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "source.py").write_text("ok")
            self.assertTrue(_archive(root))
            (root / "link").symlink_to(root / "source.py")
            with self.assertRaisesRegex(Exception, "symbolic links"):
                _archive(root)

    def test_interrupted_run_is_recovered_and_completed_history_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("server.timeline_execution.RUNS", root):
                runs = TimelineRuns()
                active = {"id": "a" * 32, "status": "running"}
                done = {"id": "b" * 32, "status": "completed"}
                runs._save(active)
                runs._save(done)
                runs.interrupt_unfinished()
                self.assertEqual(runs.get(active["id"])["status"], "interrupted")
                self.assertEqual(runs.get(done["id"])["status"], "completed")
                self.assertEqual({item["id"] for item in runs.recent()}, set())
                runs._save(
                    {
                        "id": "c" * 32,
                        "analysis_id": "d" * 32,
                        "package": "demo",
                        "versions": ["1"],
                        "status": "completed",
                    }
                )
                self.assertEqual(runs.recent()[0]["package"], "demo")
                with self.assertRaisesRegex(Exception, "Invalid timeline run ID"):
                    runs._save({"id": "../outside", "status": "running"})

    def test_offline_spawn_and_exit_status(self):
        async def check():
            requests = []

            def handler(request):
                requests.append(request)
                if request.method == "POST":
                    import json

                    body = json.loads(request.content)
                    self.assertEqual(body["networking"], {"enabled": False})
                    return httpx.Response(
                        201, json={"uuid": "test-op", "networking": {"enabled": False}}
                    )
                out = {
                    "value": base64.b64encode(b"failure output").decode(),
                    "encoding": "base64",
                }
                return httpx.Response(
                    200,
                    json={
                        "status": "SUCCESS",
                        "metadata": {
                            "result": {
                                "state": {"exit_code": 7, "timed_out": False},
                                "stdout": out,
                                "stderr": {},
                            }
                        },
                        "result": {"image": None},
                    },
                )

            real_client = httpx.AsyncClient

            def client(*args, **kwargs):
                return real_client(transport=httpx.MockTransport(handler), **kwargs)

            with (
                patch(
                    "server.timeline_execution.ENV",
                    {
                        "NEBIUS_SANDBOX_API_KEY": "example-key",
                        "NEBIUS_PROJECT_ID": "example-project",
                    },
                ),
                patch(
                    "server.timeline_execution.httpx.AsyncClient", side_effect=client
                ),
            ):
                result = await Sandbox().run("image-id", "pytest", network=False)
            self.assertEqual(result["exit_code"], 7)
            self.assertEqual(result["stdout"], "failure output")
            self.assertEqual(result["operation_id"], "test-op")
            self.assertEqual(len(requests), 2)

        asyncio.run(check())

    def test_snapshot_progress_tracks_actual_operations(self):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock

        async def check():
            with tempfile.TemporaryDirectory() as directory:
                box = Sandbox.__new__(Sandbox)
                box.upload = AsyncMock(return_value="upload-id")
                box.sdk = SimpleNamespace(
                    images=SimpleNamespace(
                        oci=AsyncMock(
                            return_value=SimpleNamespace(uuid="base", tag=None)
                        )
                    )
                )
                box.run = AsyncMock(
                    return_value={"exit_code": 0, "image_id": "snapshot"}
                )
                stages = []
                image = await box.project(Path(directory), "python", stages.append)
                self.assertEqual(image, "snapshot")
                self.assertEqual(stages, ["uploading", "image", "checkpoint"])
                self.assertFalse(box.run.call_args.kwargs["network"])

        asyncio.run(check())

    def test_repair_emits_model_plan_and_uses_it_for_agent(self):
        from unittest.mock import AsyncMock

        async def check():
            box = AsyncMock()
            box.run.return_value = {"exit_code": 0, "stdout": "", "image_id": None}
            plan = {
                "goal": "Investigate",
                "steps": ["Inspect source"],
                "limitations": ["Unverified"],
            }
            events = []
            with (
                patch("server.agent.reason", new=AsyncMock(return_value=plan)),
                patch(
                    "server.agent.repair", new=AsyncMock(return_value="No patch")
                ) as repair,
            ):
                result = await _repair(
                    box,
                    "candidate",
                    "python -m unittest",
                    "demo",
                    "2",
                    {"stdout": "failed", "stderr": ""},
                    decision=events.append,
                )
            self.assertEqual(events[0]["kind"], "plan")
            self.assertEqual(events[0]["steps"], ["Inspect source"])
            self.assertIn("Inspect source", repair.call_args.args[0])
            self.assertEqual(result["status"], "rejected")

        asyncio.run(check())

    def test_cancelled_run_keeps_interrupted_evidence(self):
        async def check():
            started = asyncio.Event()

            class WaitingSandbox:
                async def project(self, path, ecosystem, progress=None):
                    started.set()
                    await asyncio.sleep(60)

            analysis = {
                "ecosystem": "python",
                "packages": [
                    {"name": "demo", "direct": True, "releases": [{"version": "1"}]}
                ],
            }
            with tempfile.TemporaryDirectory() as directory:  # noqa: SIM117
                with (
                    patch("server.timeline_execution.RUNS", Path(directory)),
                    patch("server.timeline_execution.Sandbox", WaitingSandbox),
                    patch("server.time_machine.get_analysis", return_value=analysis),
                    patch(
                        "server.time_machine.snapshot_path",
                        return_value=Path(directory),
                    ),
                ):
                    runs = TimelineRuns()
                    run = await runs.start(
                        "a" * 32, "demo", ["1"], "python -m unittest"
                    )
                    await started.wait()
                    task = runs.tasks[run["id"]]
                    await runs.cancel(run["id"])
                    await task
                    self.assertEqual(runs.get(run["id"])["status"], "cancelled")
                    self.assertIn("not verified", runs.get(run["id"])["error"])

        asyncio.run(check())


if __name__ == "__main__":
    unittest.main()
