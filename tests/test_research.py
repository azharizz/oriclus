"""Provider protocol and untrusted-source boundaries, with explicit HTTP doubles."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from server import agent, config, research
from server.config import BoundaryError
from server.store import Store
from server.workflow import Rehearsal


class ResearchBoundaries(unittest.IsolatedAsyncioTestCase):
    async def test_structured_nemotron_can_disable_thinking(self):
        requests = []

        def endpoint(request):
            requests.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {"role": "assistant", "content": "{}"},
                        }
                    ]
                },
            )

        real = httpx.AsyncClient
        with (
            patch.object(agent, "KEY", "unit-test-only"),
            patch.object(agent, "BASE_URL", "https://example.org"),
            patch.object(agent, "MODEL", "nvidia/Nemotron-3_5-Lightning"),
            patch.object(
                agent.httpx,
                "AsyncClient",
                side_effect=lambda **kw: real(
                    transport=httpx.MockTransport(endpoint), **kw
                ),
            ),
        ):
            await agent.completion(
                [{"role": "user", "content": "test"}], disable_thinking=True
            )
        self.assertEqual(
            requests[0]["chat_template_kwargs"], {"enable_thinking": False}
        )

    async def test_provider_request_and_real_response_fields(self):
        def endpoint(request):
            self.assertEqual(str(request.url), "https://api.tavily.com/search")
            self.assertEqual(request.headers["Authorization"], "Bearer unit-test-only")
            body = json.loads(request.content)
            self.assertEqual(body["query"], "release migration")
            self.assertFalse(body["include_answer"])
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "title": "Release",
                            "url": "https://example.org/release",
                            "content": "An actual response field",
                        }
                    ],
                    "request_id": "test-request",
                    "usage": {"credits": 1},
                },
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(endpoint))
        with (
            patch.object(research, "TAVILY_KEY", "unit-test-only"),
            patch.object(research.httpx, "AsyncClient", return_value=client),
        ):
            result = await research.search("release migration")
        self.assertEqual(result["request_id"], "test-request")
        self.assertEqual(result["results"][0]["content"], "An actual response field")
        self.assertNotIn("unit-test-only", json.dumps(result))

    async def test_missing_key_provider_failure_and_unsafe_sources(self):
        with (
            patch.object(research, "TAVILY_KEY", ""),
            self.assertRaisesRegex(BoundaryError, "not configured"),
        ):
            await research.search("release migration")
        for status, payload, expected in [
            (429, {"detail": "unit-test-only"}, "HTTP 429"),
            (
                200,
                {
                    "results": [
                        {"title": "Bad", "url": "javascript:alert(1)", "content": "x"}
                    ]
                },
                "invalid source data",
            ),
            (
                200,
                {
                    "results": [
                        {
                            "title": "Bad",
                            "url": "https://user:password@example.org",
                            "content": "x",
                        }
                    ]
                },
                "invalid source data",
            ),
        ]:
            client = httpx.AsyncClient(
                transport=httpx.MockTransport(
                    lambda request, status=status, payload=payload: httpx.Response(
                        status, json=payload
                    )
                )
            )
            with (
                patch.object(research, "TAVILY_KEY", "unit-test-only"),
                patch.object(research.httpx, "AsyncClient", return_value=client),
            ):
                with self.assertRaisesRegex(BoundaryError, expected) as caught:
                    await research.search("release migration")
                self.assertNotIn("unit-test-only", str(caught.exception))

    async def test_search_failure_preserves_executable_run(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "runs.sqlite3")
            spec = json.loads(
                (config.ROOT / "examples/httpx-starlette.json").read_text()
            )
            run = store.create(spec)
            with patch.object(
                research,
                "search",
                AsyncMock(side_effect=BoundaryError("quota unavailable")),
            ):
                result = await Rehearsal(store, run).search("release migration")
            self.assertEqual(result["status"], "failed")
            self.assertEqual(store.get(run["id"])["status"], "queued")
            self.assertEqual(
                store.get(run["id"])["research"][0]["error"], "quota unavailable"
            )
            self.assertEqual(len(store.events(run["id"])), 2)
            store.db.close()

    async def test_agent_search_result_is_returned_to_model(self):
        source = {
            "results": [
                {"url": "https://example.org/migration", "content": "source evidence"}
            ]
        }
        messages = []

        async def completion(conversation, tools):
            messages.append(list(conversation))
            if len(messages) == 1:
                self.assertIn(agent.SEARCH_TOOL, tools)
                return {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "query",
                            "type": "function",
                            "function": {
                                "name": "search",
                                "arguments": '{"query":"specific migration"}',
                            },
                        }
                    ],
                }, {}
            return {"role": "assistant", "content": "Review the source evidence."}, {}

        search = AsyncMock(return_value=source)
        with patch.object(agent, "completion", completion):
            await agent.repair("Investigate", AsyncMock(), lambda *args: None, search)
        search.assert_awaited_once_with("specific migration")
        self.assertEqual(json.loads(messages[-1][-1]["content"]), source)

    def test_both_provider_keys_are_redacted(self):
        with (
            patch.object(config, "KEY", "nebius-unit-secret"),
            patch.object(config, "TAVILY_KEY", "tavily-unit-secret"),
            patch.object(
                config, "ENV", {"NEBIUS_SANDBOX_API_KEY": "sandbox-unit-secret"}
            ),
        ):
            self.assertEqual(
                config.safe_error(
                    Exception(
                        "nebius-unit-secret tavily-unit-secret sandbox-unit-secret"
                    )
                ),
                "[redacted] [redacted] [redacted]",
            )
