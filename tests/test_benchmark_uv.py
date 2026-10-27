import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from scripts.benchmark_uv import aggregate, candidate_specs, main, uv_trial
from server.config import BoundaryError


class BenchmarkTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.analysis = {
            "id": "a" * 32,
            "manager": "pip",
            "ecosystem": "python",
            "packages": [
                {
                    "name": "Demo",
                    "direct": True,
                    "requirement": "==1",
                    "releases": [{"version": "1"}, {"version": "2"}],
                },
                {"name": "other", "direct": True, "requirement": ">=2", "releases": []},
            ],
        }

    def test_candidate_replaces_only_selected_constraint(self):
        self.assertEqual(
            candidate_specs(self.analysis, "demo", "2"), ["Demo==2", "other>=2"]
        )
        with self.assertRaises(BoundaryError):
            candidate_specs(self.analysis, "demo", "3")

    def test_aggregate_keeps_unavailable_timings_and_uv_repair_distinct(self):
        trials = [
            {"status": "completed", "first_seconds": 8, "repair": None},
            {"status": "failed", "first_seconds": None, "repair": None},
        ]
        result = aggregate(trials, False)
        self.assertEqual(
            (result["completed"], result["trials"], result["timed_trials"]), (1, 2, 1)
        )
        self.assertIsNone(result["repair"])

    async def test_report_checks_outcomes_without_writing_comparison_file(self):
        sample = {
            "status": "completed",
            "first_seconds": 1,
            "baseline_exit": 0,
            "results": [{"version": "1", "status": "passed"}],
            "repair": None,
        }
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "requirements.txt").write_text("Demo==1")
            args = SimpleNamespace(
                project=source,
                package="Demo",
                versions=["1"],
                test="python -m unittest",
                trials=1,
            )
            out = io.StringIO()
            with (
                patch(
                    "scripts.benchmark_uv.analyze",
                    new=AsyncMock(return_value=self.analysis),
                ),
                patch("scripts.benchmark_uv.snapshot_path", return_value=source),
                patch(
                    "scripts.benchmark_uv.uv_trial", new=AsyncMock(return_value=sample)
                ),
                patch(
                    "scripts.benchmark_uv.oriclus_trial",
                    new=AsyncMock(return_value=sample),
                ),
                redirect_stdout(out),
            ):
                await main(args)
            report = json.loads(out.getvalue())
            self.assertEqual(report["observed_results_match"], [True])
            self.assertEqual(
                [path.name for path in source.iterdir()], ["requirements.txt"]
            )

    async def test_uv_trial_stops_when_baseline_fails(self):
        box = AsyncMock()
        box.project.return_value = "image"
        box.run.side_effect = [
            {"exit_code": 0, "image_id": "prepared"},
            {"exit_code": 1, "timed_out": False},
        ]
        with (
            patch("scripts.benchmark_uv.Sandbox", return_value=box),
            patch("scripts.benchmark_uv.snapshot_path"),
        ):
            result = await uv_trial(
                self.analysis, "Demo", ["1", "2"], "python -m unittest"
            )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["results"], [])
        self.assertEqual(box.run.await_count, 2)
