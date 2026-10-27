"""Tavily source retrieval. Search evidence informs the agent, never test status."""

from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ValidationError, field_validator

from server.config import TAVILY_KEY, BoundaryError


class Source(BaseModel):
    title: str
    url: str
    content: str
    published_date: str | None = None

    @field_validator("url")
    @classmethod
    def safe_link(cls, value: str) -> str:
        url = urlsplit(value)
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username
            or url.password
        ):
            raise ValueError(
                "Search source must have a public HTTP(S) link without credentials."
            )
        return value


class SearchResponse(BaseModel):
    results: list[Source]
    request_id: str | None = None
    usage: dict | None = None


async def search(query: str) -> dict:
    if not TAVILY_KEY:
        raise BoundaryError(
            "Tavily is not configured. Set TAVILY_API_KEY in .env for source grounding."
        )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                headers={"Authorization": f"Bearer {TAVILY_KEY}"},
                json={
                    "query": query,
                    "search_depth": "basic",
                    "max_results": 5,
                    "include_answer": False,
                    "include_raw_content": False,
                    "include_usage": True,
                    "include_published_date": True,
                },
            )
    except httpx.TransportError as error:
        raise BoundaryError(
            f"Tavily connection failed ({type(error).__name__}). Source grounding is incomplete."
        ) from error
    if response.is_error:
        raise BoundaryError(
            f"Tavily returned HTTP {response.status_code}. Check credentials, quota and account access. Source grounding is incomplete."
        )
    try:
        result = SearchResponse.model_validate_json(response.content).model_dump()
    except ValidationError as error:
        raise BoundaryError(
            "Tavily returned invalid source data. No sources were invented."
        ) from error
    return {"query": query, **result}
