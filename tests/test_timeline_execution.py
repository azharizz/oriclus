import asyncio
import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from server.timeline_execution import Sandbox, TimelineRuns, _archive, _patch_allowed


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


if __name__ == "__main__":
    unittest.main()
