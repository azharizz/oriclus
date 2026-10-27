import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from server import metrics, news
from server.config import BoundaryError


class ResearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_research_is_scoped_to_known_package_and_version_and_saved(self):
        analysis = {"packages": [{"name": "demo", "releases": [{"version": "1.0"}]}]}
        response = {
            "query": "demo 1.0 release notes",
            "results": [
                {
                    "title": "Release",
                    "url": "https://example.com",
                    "content": "Example",
                    "published_date": None,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            source.mkdir()
            with (
                patch.object(news, "get_analysis", return_value=analysis),
                patch.object(news, "snapshot_path", return_value=source),
                patch.object(
                    news, "search", new=AsyncMock(return_value=response)
                ) as search,
            ):
                result = await news.investigate("a" * 32, "demo", "1.0")
                self.assertEqual(news.saved("a" * 32)[0], result)
                self.assertIn("demo 1.0", search.call_args.args[0])
                with self.assertRaises(BoundaryError):
                    await news.investigate("a" * 32, "private-secret", "1.0")
                with self.assertRaises(BoundaryError):
                    await news.investigate("a" * 32, "demo", "2.0")


class MetricsTests(unittest.TestCase):
    def test_metrics_exclude_active_and_missing_timing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = [
                {
                    "status": "completed",
                    "started_at": 100,
                    "first_result_at": 110,
                    "results": [{"repair": {"status": "verified"}}],
                },
                {
                    "status": "failed",
                    "results": [{"repair": {"status": "unavailable"}}],
                },
                {"status": "running", "results": []},
            ]
            for i, entry in enumerate(entries):
                (root / f"{i}.json").write_text(json.dumps(entry))
            result = metrics.calculate(root)
            self.assertEqual(result["completion"], {"completed": 1, "terminal": 2})
            self.assertEqual(result["first_result_seconds"], {"median": 10, "count": 1})
            self.assertEqual(result["repair"], {"verified": 1, "attempts": 2})
