import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import time_machine
from server.config import BoundaryError


class SnapshotTests(unittest.TestCase):
    def test_snapshot_excludes_credentials_and_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "project"
            target = root / "snapshot"
            source.mkdir()
            (source / "package.json").write_text('{"dependencies":{"a":"^1"}}')
            (source / ".env.local").write_text("secret")
            (source / ".npmrc").write_text("token")
            (source / "id_rsa").write_text("secret")
            (source / "node_modules").mkdir()
            (source / "node_modules" / "data").write_text("ignored")
            (source / "link").symlink_to(source / ".env.local")
            time_machine._snapshot(source, target)
            self.assertEqual([p.name for p in target.iterdir()], ["package.json"])

    def test_python_parses_direct_and_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "pyproject.toml").write_text(
                '[project]\nname="demo"\ndependencies=["requests>=2,<3; python_version >= \\"3.10\\""]\n'
            )
            (path / "uv.lock").write_text(
                '[[package]]\nname="requests"\nversion="2.31.0"\n[[package]]\nname="urllib3"\nversion="2.0.0"\n'
            )
            manager, packages, warnings = time_machine._python_dependencies(path)
            self.assertEqual(manager, "uv")
            self.assertEqual(packages[0]["name"], "requests")
            self.assertEqual(packages[0]["current"], "2.31.0")
            self.assertIn("python_version", packages[0]["marker"])
            self.assertEqual(packages[1]["name"], "urllib3")
            self.assertFalse(packages[1]["direct"])
            self.assertFalse(warnings)

    def test_python_preserves_extras_exclusions_and_environment_markers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "requirements.txt").write_text(
                'requests[security]>=2,!=2.20; python_version >= "3.10"\n'
            )
            _, packages, _ = time_machine._python_dependencies(path)
            self.assertIn("!=2.20", packages[0]["requirement"])
            self.assertEqual(packages[0]["extras"], ["security"])
            self.assertIn("python_version", packages[0]["marker"])

    def test_node_parses_scoped_and_transitive_packages(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "package.json").write_text(
                json.dumps({"dependencies": {"@scope/pkg": "^1"}})
            )
            (path / "package-lock.json").write_text(
                json.dumps(
                    {
                        "packages": {
                            "node_modules/@scope/pkg": {"version": "1.2.0"},
                            "node_modules/foo": {"version": "2.0.0"},
                        }
                    }
                )
            )
            manager, packages, _ = time_machine._node_dependencies(path)
            self.assertEqual(manager, "npm")
            self.assertEqual(packages[0]["current"], "1.2.0")
            self.assertEqual(packages[1]["name"], "foo")
            self.assertFalse(packages[1]["direct"])

    def test_invalid_id_cannot_escape_history(self):
        with self.assertRaises(BoundaryError):
            time_machine.snapshot_path("../../secret")


class AnalyzeTests(unittest.IsolatedAsyncioTestCase):
    async def test_pinned_registry_relationships_are_not_claimed_as_installed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            project.mkdir()
            (project / "requirements.txt").write_text("Flask==2.2.5\n")

            async def declarations(_ecosystem, _name, _version):
                return {"Jinja2": ">=3.0", "optional": ">=1; extra == 'dev'"}, True

            async def releases(_client, _package, _ecosystem, _limiter):
                pass

            with (
                patch.object(time_machine, "TIMELINES", root / "history"),
                patch.object(time_machine, "version_requirements", declarations),
                patch.object(time_machine, "_releases", releases),
            ):
                result = await time_machine.analyze("local", str(project))
            related = {p["name"]: p for p in result["packages"] if not p["direct"]}
            self.assertEqual(set(related), {"Jinja2", "optional"})
            self.assertIsNone(related["Jinja2"]["current"])
            self.assertIn("Flask 2.2.5", related["Jinja2"]["source"])
            self.assertIn("extra", related["optional"]["requirement"])

    async def test_github_analysis_records_the_cloned_revision(self):
        import subprocess

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "repo"
            project.mkdir()
            (project / "package.json").write_text('{"dependencies":{"demo":"^1"}}')
            subprocess.run(["git", "init", "-q", str(project)], check=True)
            subprocess.run(
                ["git", "-C", str(project), "add", "package.json"], check=True
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(project),
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.org",
                    "commit",
                    "-qm",
                    "fixture",
                ],
                check=True,
            )
            revision = subprocess.check_output(
                ["git", "-C", str(project), "rev-parse", "HEAD"], text=True
            ).strip()

            async def releases(_client, _package, _ecosystem, _limiter):
                pass

            with (
                patch.object(time_machine, "TIMELINES", root / "history"),
                patch.object(time_machine, "repository_url", return_value=str(project)),
                patch.object(time_machine, "_releases", releases),
            ):
                result = await time_machine.analyze(
                    "github", "https://github.com/example/demo"
                )
                self.assertEqual(result["source_revision"], revision)
                self.assertEqual(
                    time_machine.get_analysis(result["id"])["source_revision"], revision
                )

    async def test_analysis_saves_local_project_without_changing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            project.mkdir()
            (project / "package.json").write_text('{"dependencies":{"example":"^1"}}')
            (project / ".env").write_text("credential")
            original = (project / "package.json").read_text()

            async def releases(_client, package, _ecosystem, _limiter):
                package["releases"] = [
                    {"version": "1.0", "date": "2024-01-01T00:00:00Z"}
                ]

            with (
                patch.object(time_machine, "TIMELINES", root / "history"),
                patch.object(time_machine, "_releases", releases),
            ):
                result = await time_machine.analyze("local", str(project))
                self.assertEqual(result["packages"][0]["releases"][0]["version"], "1.0")
                self.assertEqual(
                    time_machine.get_analysis(result["id"])["manager"], "npm"
                )
                self.assertFalse(
                    (time_machine.snapshot_path(result["id"]) / ".env").exists()
                )
                self.assertEqual((project / "package.json").read_text(), original)


class ResolverTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.analysis = {
            "id": "a" * 32,
            "ecosystem": "python",
            "manager": "pip",
            "packages": [
                {
                    "name": "MarkupSafe",
                    "requirement": "==2.0.1",
                    "direct": True,
                    "releases": [{"version": "2.1.5", "date": None}],
                },
                {"name": "other", "requirement": ">=1", "direct": True, "releases": []},
            ],
        }

    def test_native_scripts_have_valid_shell_syntax(self):
        import subprocess

        for manager in ("pip", "uv", "poetry", "npm", "yarn", "pnpm", "go", "cargo"):
            with self.subTest(manager=manager):
                analysis = {**self.analysis, "manager": manager}
                script, _ = time_machine.candidate_script(
                    analysis, "MarkupSafe", "2.1.5"
                )
                result = subprocess.run(
                    ["sh", "-n"], input=script, text=True, capture_output=True
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_unknown_version_or_shell_injection(self):
        with self.assertRaises(BoundaryError):
            time_machine.candidate_script(
                self.analysis, "MarkupSafe", "2.1.5;touch-pwned"
            )
        with self.assertRaises(BoundaryError):
            time_machine.candidate_script(self.analysis, "MarkupSafe", "3.0")

    def test_partial_pip_manifest_is_not_reported_as_a_complete_resolution(self):
        analysis = {
            **self.analysis,
            "warnings": [
                "Requirements file options and nested requirement files need review."
            ],
        }
        with self.assertRaisesRegex(BoundaryError, "could not be analyzed fully"):
            time_machine.candidate_script(analysis, "MarkupSafe", "2.1.5")

    async def test_resolution_is_not_presented_as_tested_and_conflict_is_distinct(self):
        from unittest.mock import AsyncMock

        with (
            patch.object(time_machine, "get_analysis", return_value=self.analysis),
            patch.object(
                time_machine, "snapshot_path", return_value=Path("/tmp/project")
            ),
            patch.object(
                time_machine,
                "version_requirements",
                new=AsyncMock(return_value=({"other": ">=2"}, True)),
            ),
            patch(
                "server.timeline_execution.execute_snapshot",
                new=AsyncMock(
                    return_value={
                        "exit_code": 0,
                        "stdout": '__ORICLUS_RESULT__={"MarkupSafe":"2.1.5","other":"2.0"}',
                    }
                ),
            ),
        ):
            result = await time_machine.resolve("a" * 32, "MarkupSafe", "2.1.5")
            self.assertEqual(result["status"], "resolved")
            self.assertEqual(result["selected"]["other"], "2.0")
            self.assertIn("required by MarkupSafe", result["requirements"]["other"])
            self.assertIn("not been tested", result["message"])

    async def test_network_error_is_not_claimed_as_a_constraint_conflict(self):
        from unittest.mock import AsyncMock

        with (
            patch.object(time_machine, "get_analysis", return_value=self.analysis),
            patch.object(
                time_machine, "snapshot_path", return_value=Path("/tmp/project")
            ),
            patch.object(
                time_machine,
                "version_requirements",
                new=AsyncMock(return_value=({}, False)),
            ),
            patch(
                "server.timeline_execution.execute_snapshot",
                new=AsyncMock(
                    return_value={
                        "exit_code": 1,
                        "stdout": "Temporary failure in name resolution",
                        "stderr": "",
                    }
                ),
            ),
        ):
            result = await time_machine.resolve("a" * 32, "MarkupSafe", "2.1.5")
            self.assertEqual(result["status"], "error")

    async def test_conflict_keeps_real_resolver_output_and_advisory_explanation(self):
        from unittest.mock import AsyncMock

        explanation = {
            "summary": "Constraints conflict",
            "suggestions": [],
            "limitations": [],
        }
        with (
            patch.object(time_machine, "get_analysis", return_value=self.analysis),
            patch.object(
                time_machine, "snapshot_path", return_value=Path("/tmp/project")
            ),
            patch.object(
                time_machine,
                "version_requirements",
                new=AsyncMock(return_value=({}, True)),
            ),
            patch.object(
                time_machine,
                "explain_conflict",
                new=AsyncMock(return_value=explanation),
            ),
            patch(
                "server.timeline_execution.execute_snapshot",
                new=AsyncMock(
                    return_value={
                        "exit_code": 1,
                        "stdout": "ResolutionImpossible: conflicting constraints",
                        "stderr": "",
                    }
                ),
            ),
        ):
            result = await time_machine.resolve("a" * 32, "MarkupSafe", "2.1.5")
            self.assertEqual(result["status"], "conflict")
            self.assertIn("ResolutionImpossible", result["message"])
            self.assertEqual(result["explanation"], explanation)

    async def test_resolver_adds_new_transitive_packages_to_the_timeline(self):
        from unittest.mock import AsyncMock

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            record = root / ("a" * 32)
            (record / "source").mkdir(parents=True)
            (record / "analysis.json").write_text(json.dumps(self.analysis))

            async def releases(_client, package, _ecosystem, _limiter):
                package["releases"] = [{"version": "1.0", "date": None}]

            with (
                patch.object(time_machine, "TIMELINES", root),
                patch.object(time_machine, "_releases", releases),
                patch.object(
                    time_machine,
                    "version_requirements",
                    new=AsyncMock(return_value=({}, True)),
                ),
                patch(
                    "server.timeline_execution.execute_snapshot",
                    new=AsyncMock(
                        return_value={
                            "exit_code": 0,
                            "stdout": '__ORICLUS_RESULT__={"MarkupSafe":"2.1.5","leaf":"1.0"}',
                        }
                    ),
                ),
            ):
                result = await time_machine.resolve("a" * 32, "MarkupSafe", "2.1.5")
                leaf = next(
                    item for item in result["packages"] if item["name"] == "leaf"
                )
                self.assertFalse(leaf["direct"])
                self.assertIsNone(leaf["current"])
                self.assertEqual(leaf["releases"][0]["version"], "1.0")
                self.assertTrue(
                    any(
                        item["name"] == "leaf"
                        for item in time_machine.get_analysis("a" * 32)["packages"]
                    )
                )
