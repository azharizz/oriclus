import asyncio
import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from server.config import BoundaryError
from server.timeline_execution import (
    Sandbox,
    TimelineRuns,
    _archive,
    _patch_allowed,
    _repair,
)


class ExecutionTests(unittest.TestCase):
    def test_matrix_resolves_all_requested_versions_together(self):
        from server.time_machine import candidate_script

        analysis = {
            "manager": "pip",
            "packages": [
                {
                    "name": name,
                    "direct": True,
                    "requirement": "==1",
                    "releases": [{"version": "2"}],
                }
                for name in ("alpha", "beta")
            ],
        }
        script, _ = candidate_script(
            analysis, "alpha", "2", {"alpha": "2", "beta": "2"}
        )
        self.assertIn("alpha==2", script)
        self.assertIn("beta==2", script)
        self.assertNotIn("beta==1", script)
        with self.assertRaisesRegex(Exception, "metadata"):
            candidate_script(analysis, "alpha", "2", {"alpha": "2", "beta": "3"})
        for manager in ("uv", "poetry", "npm", "yarn", "pnpm"):
            with self.subTest(manager=manager):
                script, _ = candidate_script(
                    {**analysis, "manager": manager},
                    "alpha",
                    "2",
                    {"alpha": "2", "beta": "2"},
                )
                self.assertIn("alpha", script)
                self.assertIn("beta", script)

    def test_matrix_runs_concurrently_with_separate_candidate_images(self):
        async def check():
            active = 0
            peak = 0
            parents = []

            class FakeSandbox:
                async def project(self, path, ecosystem, progress=None):
                    return "common"

                async def run(self, image, command, **options):
                    nonlocal active, peak
                    result = {
                        "exit_code": 0,
                        "image_id": None,
                        "timed_out": False,
                        "stdout": "",
                        "stderr": "",
                        "operation_id": "op",
                    }
                    if image == "common":
                        result["image_id"] = "parent"
                    elif command.startswith("resolve-"):
                        parents.append(image)
                        active += 1
                        peak = max(peak, active)
                        await asyncio.sleep(0.02)
                        active -= 1
                        result["image_id"] = command.split("\\n", 1)[0]
                    elif command.startswith("git add"):
                        result["image_id"] = image + "-checkpoint"
                    return result

            analysis = {
                "ecosystem": "python",
                "manager": "pip",
                "packages": [
                    {
                        "name": name,
                        "direct": True,
                        "releases": [{"version": v} for v in ("1", "2")],
                    }
                    for name in ("a", "b")
                ],
            }
            with (
                tempfile.TemporaryDirectory() as directory,
                patch("server.timeline_execution.RUNS", Path(directory)),
                patch("server.timeline_execution.Sandbox", FakeSandbox),
                patch("server.time_machine.get_analysis", return_value=analysis),
                patch(
                    "server.time_machine.snapshot_path",
                    return_value=Path(directory),
                ),
                patch(
                    "server.time_machine.candidate_script",
                    side_effect=lambda a, p, v, c: (
                        "resolve-" + c["a"] + c["b"],
                        "python",
                    ),
                ),
            ):
                runs = TimelineRuns()
                run = await runs.start(
                    "a" * 32,
                    "a",
                    ["1", "2"],
                    "test",
                    {"a": ["1", "2"], "b": ["1", "2"]},
                    {"package": "b", "version": "2"},
                )

                await runs.tasks[run["id"]]
                saved = runs.get(run["id"])
                self.assertEqual(saved["status"], "completed")
                self.assertEqual(saved["goal"], {"package": "b", "version": "2"})
                self.assertEqual(len(saved["results"]), 4)
                self.assertEqual(
                    {tuple(sorted(x["combination"].items())) for x in saved["results"]},
                    {(("a", a), ("b", b)) for a in ("1", "2") for b in ("1", "2")},
                )
                self.assertTrue(
                    all(item["status"] == "passed" for item in saved["results"])
                )
                self.assertEqual(parents, ["parent"] * 4)
                self.assertEqual(peak, 3)

        asyncio.run(check())

    def test_matrix_bounds_and_goal_are_validated(self):
        async def check():
            analysis = {
                "packages": [
                    {
                        "name": name,
                        "releases": [{"version": str(n)} for n in range(1, 6)],
                    }
                    for name in ("a", "b")
                ]
            }
            with (
                tempfile.TemporaryDirectory() as directory,
                patch("server.timeline_execution.RUNS", Path(directory)),
                patch("server.time_machine.get_analysis", return_value=analysis),
            ):
                runs = TimelineRuns()
                with self.assertRaisesRegex(Exception, "12 combinations"):
                    await runs.start(
                        "a" * 32,
                        "a",
                        ["1", "2", "3"],
                        "test",
                        {"a": ["1", "2", "3"], "b": ["1", "2", "3", "4", "5"]},
                    )
                with self.assertRaisesRegex(Exception, "upgrade goal"):
                    await runs.start(
                        "a" * 32,
                        "a",
                        ["1"],
                        "test",
                        {"a": ["1"]},
                        {"package": "a", "version": "2"},
                    )

        asyncio.run(check())

    def test_patch_rejects_tests_and_metadata(self):
        self.assertTrue(_patch_allowed(["src/app.py"]))
        self.assertFalse(_patch_allowed(["src/app.py", "tests/test_app.py"]))
        self.assertFalse(_patch_allowed(["package.json"]))
        self.assertFalse(_patch_allowed(["../outside.py"]))
        self.assertFalse(_patch_allowed(["test.cjs"]))
        self.assertFalse(_patch_allowed(["src/app.test.mjs"]))
        for path in (
            "go.mod",
            "go.sum",
            "main_test.go",
            "Cargo.toml",
            "Cargo.lock",
            "bun.lock",
            "bun.lockb",
        ):
            with self.subTest(path=path):
                self.assertFalse(_patch_allowed([path]))

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

    def test_github_project_fetches_recorded_revision_and_excludes_upload(self):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock

        async def check():
            box = Sandbox.__new__(Sandbox)
            box.upload = AsyncMock()
            box.sdk = SimpleNamespace(
                images=SimpleNamespace(
                    oci=AsyncMock(return_value=SimpleNamespace(uuid="base", tag=None))
                )
            )
            box.run = AsyncMock(return_value={"exit_code": 0, "image_id": "snapshot"})
            source = {
                "source_preparation": "github_commit",
                "source_url": "https://github.com/example/project",
                "source_revision": "a" * 40,
            }
            stages = []
            result = await box.project(Path("/tmp"), "python", stages.append, source)
            self.assertEqual(result, "snapshot")
            self.assertEqual(stages, ["image", "cloning"])
            self.assertTrue(box.run.call_args.kwargs["network"])
            self.assertTrue(box.run.call_args.kwargs["save"])
            self.assertIn(source["source_revision"], box.run.call_args.args[1])
            box.upload.assert_not_called()
            source["source_url"] = "https://example.com/private"
            with self.assertRaises(BoundaryError):
                await box.project(Path("/tmp"), "python", None, source)

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
                "manager": "pip",
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
                    await asyncio.wait_for(started.wait(), timeout=2)
                    task = runs.tasks[run["id"]]
                    await runs.cancel(run["id"])
                    await task
                    self.assertEqual(runs.get(run["id"])["status"], "cancelled")
                    self.assertIn("not verified", runs.get(run["id"])["error"])

        asyncio.run(check())


if __name__ == "__main__":
    unittest.main()
