"""Discovery provenance and pagination checks. Provider data here is a test double."""

import asyncio
import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from pydantic import ValidationError

from server import app as api_module
from server import planning
from server.config import ROOT, BoundaryError, DiscoveryRequest, RunRequest
from server.planning import Planner, Proposal
from server.store import Store

EXAMPLE = json.loads((ROOT / "examples/httpx-starlette.json").read_text())


class DiscoveryContracts(unittest.IsolatedAsyncioTestCase):
    async def test_source_provenance_and_review_before_execution(self):
        spec = {**EXAMPLE, "consumers": EXAMPLE["consumers"][:1]}
        consumer = spec["consumers"][0]
        source_path = consumer["editable_paths"][0] + "client.py"
        excerpt = "import httpx"
        proposal = Proposal.model_validate(
            {
                "spec": spec,
                "summary": "Check the consumer's existing tests.",
                "evidence": [
                    {
                        "repository": consumer["repository"],
                        "ref": consumer["ref"],
                        "path": source_path,
                        "excerpt": excerpt,
                        "reason": "Imports the upstream package.",
                    }
                ],
                "limitations": ["Selected suite only."],
            }
        )
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "runs.sqlite3")
            self.addCleanup(store.db.close)
            run = store.create(spec, "planning")
            run["discovery"] = {"upstream": spec["upstream"]}
            planner = Planner(store, run)
            for field, sha in (("baseline_ref", "a" * 40), ("candidate_ref", "b" * 40)):
                planner.repositories[(spec["upstream"], spec[field])] = {"sha": sha}
            planner.repositories[(consumer["repository"], consumer["ref"])] = {
                "sha": "c" * 40,
                "files": [{"path": source_path}],
            }
            planner.files[(consumer["repository"], "c" * 40, source_path)] = {
                "content": excerpt,
                "url": f"{consumer['repository']}/blob/{'c' * 40}/{source_path}",
            }
            accepted = planner.accept(proposal)
            self.assertEqual(accepted["spec"]["baseline_ref"], "a" * 40)
            self.assertEqual(accepted["spec"]["candidate_ref"], "b" * 40)
            self.assertEqual(accepted["spec"]["consumers"][0]["ref"], "c" * 40)
            invented = proposal.model_copy(deep=True)
            invented.evidence[0].excerpt = "unread source"
            with self.assertRaisesRegex(BoundaryError, "actually read"):
                planner.accept(invented)
            uninspected = proposal.model_copy(deep=True)
            uninspected.spec.candidate_ref = "uninspected"
            with self.assertRaisesRegex(BoundaryError, "Inspect the upstream"):
                planner.accept(uninspected)
            planner.input.baseline_ref = "user-selected-ref"
            with self.assertRaisesRegex(BoundaryError, "unchanged"):
                planner.accept(proposal)
            planner.input.baseline_ref = ""
            message = {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "proposal",
                        "type": "function",
                        "function": {
                            "name": "propose",
                            "arguments": json.dumps(
                                {"proposal_json": proposal.model_dump_json()}
                            ),
                        },
                    }
                ],
            }
            with (
                patch.object(
                    planner, "repository", AsyncMock(return_value={"sha": "b" * 40})
                ),
                patch.object(
                    planning.agent, "completion", AsyncMock(return_value=(message, {}))
                ),
                patch.object(api_module.Rehearsal, "execute", AsyncMock()) as execute,
            ):
                await planner.execute()
                saved = store.get(run["id"])
                self.assertEqual(saved["status"], "ready")
                self.assertEqual(saved["consumers"], [])
                self.assertEqual(saved["proposal"]["evidence"][0]["excerpt"], excerpt)
                execute.assert_not_awaited()

    async def test_public_github_protocol_and_file_allowlist(self):
        repo = "https://github.com/example/library"
        paths = []
        responses = {
            "/repos/example/library": {"default_branch": "main"},
            "/repos/example/library/releases": [],
            "/repos/example/library/tags": [{"name": "1.0.0"}],
            "/repos/example/library/commits/main": {
                "sha": "a" * 40,
                "commit": {"tree": {"sha": "tree"}},
            },
            "/repos/example/library/git/trees/tree": {
                "tree": [
                    {
                        "type": "blob",
                        "path": "pyproject.toml",
                        "sha": "blob",
                        "size": 30,
                    }
                ]
            },
            "/repos/example/library/git/blobs/blob": {
                "content": base64.b64encode(b'name = "library"').decode()
            },
        }

        def endpoint(request):
            self.assertEqual(request.url.host, "api.github.com")
            self.assertEqual(request.method, "GET")
            self.assertNotIn("authorization", request.headers)
            paths.append(request.url.path)
            if request.url.path == "/repos/example/library/commits/main":
                return httpx.Response(
                    301,
                    headers={
                        "location": "https://api.github.com/repositories/1/commits/main"
                    },
                )
            if request.url.path == "/repositories/1/commits/main":
                return httpx.Response(
                    200, json=responses["/repos/example/library/commits/main"]
                )
            return httpx.Response(200, json=responses[request.url.path])

        http_client = httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "runs.sqlite3")
            self.addCleanup(store.db.close)
            planner = Planner(store, {"discovery": {"upstream": repo}})
            with patch.object(
                planning.httpx,
                "AsyncClient",
                side_effect=lambda **kwargs: http_client(
                    transport=httpx.MockTransport(endpoint), **kwargs
                ),
            ):
                source = await planner.read_file(repo, "HEAD", "pyproject.toml")
                snapshot = await planner.repository(repo, "HEAD")
                self.assertEqual(snapshot["tags"], ["1.0.0"])
                self.assertEqual(source["sha"], "a" * 40)
                self.assertEqual(source["content"], 'name = "library"')
                await planner.read_file(repo, "HEAD", "pyproject.toml")
                self.assertEqual(len(paths), len(responses) + 1)
                with self.assertRaises(BoundaryError):
                    await planner.read_file(repo, "HEAD", "../../secret")

    async def test_reviewed_setup_starts_once_and_keeps_same_record(self):
        async def pending(_self):
            await asyncio.Event().wait()

        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "runs.sqlite3")
            self.addCleanup(store.db.close)
            run = store.create(EXAMPLE, "ready")
            with (
                patch.object(api_module, "store", store, create=True),
                patch.object(api_module, "jobs", {}),
                patch.object(api_module, "submission_lock", asyncio.Lock()),
                patch.object(
                    api_module,
                    "readiness",
                    AsyncMock(
                        return_value={
                            "inference_configured": True,
                            "docker": True,
                            "image": True,
                        }
                    ),
                ),
                patch.object(api_module.Rehearsal, "execute", pending),
            ):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=api_module.app),
                    base_url="http://127.0.0.1:8787",
                ) as client:
                    responses = await asyncio.gather(
                        *[
                            client.post(f"/api/runs/{run['id']}/start", json=EXAMPLE)
                            for _ in range(2)
                        ]
                    )
                    self.assertEqual(
                        sorted(response.status_code for response in responses),
                        [202, 409],
                    )
                    self.assertEqual(len(store.list()), 1)
                    saved = store.get(run["id"])
                    self.assertEqual(saved["prepared_request"], EXAMPLE)
                    self.assertEqual(saved["status"], "queued")
                    for task in api_module.jobs.values():
                        task.cancel()
                    await asyncio.gather(
                        *api_module.jobs.values(), return_exceptions=True
                    )

    def test_discovery_input_and_required_commands(self):
        request = DiscoveryRequest(
            upstream="encode/httpx",
            consumers=["Kludex/starlette", "https://github.com/Kludex/starlette"],
        )
        self.assertEqual(request.upstream, "https://github.com/encode/httpx")
        self.assertEqual(request.consumers, ["https://github.com/Kludex/starlette"])
        consumer = {
            key: value
            for key, value in EXAMPLE["consumers"][0].items()
            if key != "test_command"
        }
        with self.assertRaises(ValidationError):
            RunRequest.model_validate({**EXAMPLE, "consumers": [consumer]})
        with self.assertRaises(ValidationError):
            RunRequest.model_validate(
                {**EXAMPLE, "consumers": [{**consumer, "test_command": " \n "}]}
            )


class Pagination(unittest.TestCase):
    def test_filters_pages_and_event_ownership_preserve_full_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "runs.sqlite3")
            self.addCleanup(store.db.close)
            runs = [
                store.create(
                    {**EXAMPLE, "title": f"Check {index}"},
                    "completed" if index % 2 else "failed",
                )
                for index in range(12)
            ]
            for index, run in enumerate(runs):
                run["created_at"] = f"2026-09-20T00:00:{index:02d}+00:00"
                store.save(run)
            store.save(runs[0])
            first, second = store.run_page(5, 0, "", ""), store.run_page(5, 5, "", "")
            self.assertEqual(first["total"], 12)
            self.assertEqual(
                [item["id"] for item in first["items"]],
                [run["id"] for run in reversed(runs[-5:])],
            )
            self.assertTrue(
                {item["id"] for item in first["items"]}.isdisjoint(
                    item["id"] for item in second["items"]
                )
            )
            self.assertNotIn("consumers", first["items"][0])
            self.assertEqual(store.run_page(2, 2, "Check", "completed")["total"], 6)
            self.assertEqual(
                store.run_page(5, 0, "CHECK 11", "completed")["items"][0]["id"],
                runs[11]["id"],
            )
            run_id = runs[0]["id"]
            for index in range(7):
                store.event(
                    run_id,
                    "model" if index % 2 else "execution",
                    str(index),
                    {"output": index},
                )
            page = store.event_page(run_id, 2, 1, "execution")
            self.assertEqual(page["total"], 4)
            self.assertEqual([event["title"] for event in page["items"]], ["4", "2"])
            self.assertNotIn("data", page["items"][0])
            event_id = page["items"][0]["id"]
            self.assertEqual(
                store.event_data(run_id, event_id), {"data": {"output": 4}}
            )
            self.assertIsNone(store.event_data(runs[1]["id"], event_id))
            self.assertEqual(len(store.events(run_id)), 7)


if __name__ == "__main__":
    unittest.main()
