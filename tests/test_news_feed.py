import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from server import news, time_machine


class FeedTests(unittest.IsolatedAsyncioTestCase):
    async def test_merges_shared_dependencies_and_keeps_saved_research(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first, second = "a" * 32, "b" * 32
            for ident, name, package in [
                (first, "one", "demo-lib"),
                (second, "two", "Demo_Lib"),
            ]:
                folder = root / ident
                (folder / "source").mkdir(parents=True)
                data = {
                    "id": ident,
                    "project_name": name,
                    "project_key": name,
                    "ecosystem": "python",
                    "packages": [
                        {
                            "name": package,
                            "direct": True,
                            "requirement": ">=1",
                            "releases": [
                                {"version": "1", "date": "2024-01-01T00:00:00Z"}
                            ],
                        }
                    ],
                }
                (folder / "analysis.json").write_text(json.dumps(data))
            record = {
                "package": "demo-lib",
                "version": None,
                "searched_at": "2024-02-01T00:00:00Z",
                "query": "demo-lib release",
                "sources": [
                    {
                        "title": "demo-lib",
                        "url": "https://example.com",
                        "content": "release",
                    }
                ],
            }
            with patch.object(time_machine, "TIMELINES", root):
                news._store(first, record)
                result = news.feed()
                self.assertEqual(len(result["projects"]), 2)
                self.assertEqual(len(result["groups"]), 1)
                group = result["groups"][0]
                self.assertEqual(len(group["projects"]), 2)
                self.assertEqual(len(group["research"]), 1)
                target = group["projects"][1]
                previous = len(news.saved(target["analysis_id"]))
                with patch.object(
                    news, "investigate", new=AsyncMock(return_value=record)
                ) as search:
                    await news.refresh_group(group)
                self.assertEqual(search.await_count, 1)
                self.assertEqual(len(news.saved(target["analysis_id"])), previous + 1)

    def test_node_punctuation_does_not_merge_distinct_packages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ident = "c" * 32
            folder = root / ident
            (folder / "source").mkdir(parents=True)
            (folder / "analysis.json").write_text(
                json.dumps(
                    {
                        "id": ident,
                        "ecosystem": "node",
                        "packages": [
                            {"name": name, "direct": True, "releases": []}
                            for name in ("a.b", "a-b")
                        ],
                    }
                )
            )
            with patch.object(time_machine, "TIMELINES", root):
                self.assertEqual(len(news.feed()["groups"]), 2)
