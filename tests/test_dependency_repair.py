import asyncio
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from server.dependency_repair import _requirements_edit, propose_dependency_repair


def result(exit_code=0, stdout="", image_id=None):
    return {
        "exit_code": exit_code,
        "stdout": stdout,
        "stderr": "",
        "image_id": image_id,
        "timed_out": False,
        "truncated": False,
    }


class DependencyRepairTests(unittest.TestCase):
    def setUp(self):
        self.tavily = patch("server.dependency_repair.TAVILY_KEY", "")
        self.tavily.start()
        self.addCleanup(self.tavily.stop)

    def test_requirements_edit_preserves_markers_and_other_requirements(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            p = root / "requirements.txt"
            p.write_text(
                'httpx==0.27.2\nstarlette[full]==0.36.3; python_version >= "3.9" # note\n'
            )
            command = _requirements_edit({"httpx": "0.28.0", "starlette": "0.37.2"})
            run = subprocess.run(
                command, shell=True, cwd=root, capture_output=True, text=True
            )
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn("httpx==0.28.0", p.read_text())
            self.assertIn(
                'starlette[full]==0.37.2; python_version >= "3.9" # note', p.read_text()
            )

    def test_goal_is_locked_and_unrecognized_versions_are_rejected(self):
        async def check():
            analysis = {
                "manager": "pip",
                "ecosystem": "python",
                "packages": [
                    {
                        "name": "httpx",
                        "direct": True,
                        "requirement": "==0.27.2",
                        "releases": [{"version": "0.28.0"}],
                    },
                    {
                        "name": "starlette",
                        "direct": True,
                        "requirement": "==0.36.3",
                        "releases": [{"version": "0.37.2", "date": "2024-01-01"}],
                    },
                ],
            }
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "requirements.txt").write_text(
                    "httpx==0.27.2\nstarlette==0.36.3\n"
                )
                box = AsyncMock()
                for change in (
                    {"package": "httpx", "version": "0.28.0"},
                    {"package": "starlette", "version": "999"},
                ):
                    with patch(
                        "server.agent.reason",
                        new=AsyncMock(
                            return_value={"explanation": "try", "changes": [change]}
                        ),
                    ):
                        answer = await propose_dependency_repair(
                            box,
                            "parent",
                            analysis,
                            root,
                            {"httpx": "0.28.0"},
                            "httpx",
                            {"package": "httpx", "version": "0.28.0"},
                            "test",
                            {"stdout": "", "stderr": "failed"},
                            lambda *_: None,
                            lambda *_: None,
                        )
                    self.assertNotEqual(answer["status"], "verified")
                    self.assertIsNotNone(answer["error"])
                box.run.assert_not_awaited()

        asyncio.run(check())

    def test_independent_install_rejects_untracked_test_tampering(self):
        async def check():
            analysis = {
                "manager": "pip",
                "ecosystem": "python",
                "packages": [
                    {
                        "name": "httpx",
                        "direct": True,
                        "requirement": "==0.27.2",
                        "releases": [{"version": "0.28.0"}],
                    },
                    {
                        "name": "starlette",
                        "direct": True,
                        "requirement": "==0.36.3",
                        "releases": [{"version": "0.37.2", "date": "2024-01-01"}],
                    },
                ],
            }
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "requirements.txt").write_text(
                    "httpx==0.27.2\nstarlette==0.36.3\n"
                )
                box = AsyncMock()
                box.run.side_effect = [
                    result(image_id="proposed"),
                    result(stdout="requirements.txt\n"),
                    result(stdout="diff --git a/requirements.txt b/requirements.txt\n"),
                    result(image_id="fresh"),
                    result(
                        stdout="requirements.txt\n__ORICLUS_UNTRACKED__\ntests/test_injected.py\n"
                    ),
                ]
                box.upload.return_value = "uploaded"
                with patch(
                    "server.agent.reason",
                    new=AsyncMock(
                        return_value={
                            "explanation": "upgrade",
                            "changes": [{"package": "starlette", "version": "0.37.2"}],
                        }
                    ),
                ):
                    answer = await propose_dependency_repair(
                        box,
                        "parent",
                        analysis,
                        root,
                        {"httpx": "0.28.0"},
                        "httpx",
                        None,
                        "python -m unittest",
                        {"stdout": "", "stderr": "failed"},
                        lambda *_: None,
                        lambda *_: None,
                    )
                self.assertEqual(answer["status"], "rejected")
                self.assertIn("untracked files", answer["error"])
                self.assertEqual(box.run.await_count, 5)

        asyncio.run(check())

    def test_verified_dependency_patch_is_installed_and_tested_from_fresh_parent(self):
        async def check():
            analysis = {
                "manager": "pip",
                "ecosystem": "python",
                "packages": [
                    {
                        "name": "httpx",
                        "direct": True,
                        "requirement": "==0.27.2",
                        "releases": [{"version": "0.28.0"}],
                    },
                    {
                        "name": "starlette",
                        "direct": True,
                        "requirement": "==0.36.3",
                        "releases": [{"version": "0.37.2", "date": "2024-01-01"}],
                    },
                ],
            }
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "requirements.txt").write_text(
                    "httpx==0.27.2\nstarlette==0.36.3\n"
                )
                box = AsyncMock()
                box.run.side_effect = [
                    result(image_id="proposed"),
                    result(stdout="requirements.txt\n"),
                    result(stdout="diff --git a/requirements.txt b/requirements.txt\n"),
                    result(image_id="fresh"),
                    result(stdout="requirements.txt\n\n__ORICLUS_UNTRACKED__\n"),
                    result(stdout="tests passed"),
                ]
                box.upload.return_value = "uploaded"
                with patch(
                    "server.agent.reason",
                    new=AsyncMock(
                        return_value={
                            "explanation": "upgrade Starlette",
                            "changes": [{"package": "starlette", "version": "0.37.2"}],
                        }
                    ),
                ):
                    answer = await propose_dependency_repair(
                        box,
                        "parent",
                        analysis,
                        root,
                        {"httpx": "0.28.0"},
                        "httpx",
                        {"package": "httpx", "version": "0.28.0"},
                        "python -m unittest",
                        {"stdout": "", "stderr": "failed"},
                        lambda *_: None,
                        lambda *_: None,
                    )
                self.assertEqual(answer["status"], "verified")
                calls = box.run.await_args_list
                self.assertEqual(calls[0].args[0], "parent")
                self.assertEqual(calls[3].args[0], "parent")
                self.assertTrue(calls[3].kwargs["network"])
                self.assertIn("__ORICLUS_VERIFIED_VERSIONS__", calls[3].args[1])
                self.assertEqual(calls[5].args[0], "fresh")
                self.assertFalse(calls[5].kwargs["network"])
                self.assertEqual(
                    (root / "requirements.txt").read_text(),
                    "httpx==0.27.2\nstarlette==0.36.3\n",
                )

        asyncio.run(check())
