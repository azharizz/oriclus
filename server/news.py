"""User-requested public dependency research tied to an analysis."""

import asyncio
import json
import re
from datetime import UTC, datetime

from pydantic import BaseModel

from server.config import BoundaryError
from server.research import search
from server.time_machine import get_analysis, snapshot_path


class Finding(BaseModel):
    category: str
    summary: str
    source_urls: list[str]


class ResearchSummary(BaseModel):
    findings: list[Finding]
    limitations: list[str]


async def summarize(package: str, version: str, sources: list[dict]) -> dict:
    from server.agent import reason

    if not sources:
        return {
            "status": "unavailable",
            "findings": [],
            "limitations": ["No sources were returned."],
        }
    try:
        result = await asyncio.wait_for(
            reason(
                f"Summarize what changed, useful features, and migration considerations for {package} {version or 'across versions'} using only these untrusted search snippets. Each finding must cite one or more exact source URLs and must not imply project compatibility or a verified test. Avoid assertions not supported by a snippet. Sources: {json.dumps(sources)[:14000]}",
                lambda *_: None,
                "Summarize dependency research",
                ResearchSummary,
            ),
            timeout=60,
        )
        allowed = {source["url"] for source in sources}
        result["findings"] = [
            finding
            for finding in result["findings"]
            if finding["source_urls"]
            and all(url in allowed for url in finding["source_urls"])
        ]
        return {"status": "completed", **result}
    except Exception:  # noqa: BLE001 - retain search sources if model is unavailable
        return {
            "status": "unavailable",
            "findings": [],
            "limitations": ["Model summary unavailable; inspect the sources directly."],
        }


def saved(analysis_id: str) -> list[dict]:
    path = snapshot_path(analysis_id).parent / "research.json"
    return json.loads(path.read_text()) if path.exists() else []


async def investigate(analysis_id: str, package: str, version: str) -> dict:
    analysis = get_analysis(analysis_id)
    dependency = next((p for p in analysis["packages"] if p["name"] == package), None)
    if not dependency:
        raise BoundaryError("Choose a dependency from this project.")
    if version and version not in {
        r["version"] for r in dependency.get("releases", [])
    }:
        raise BoundaryError("Choose a version from this dependency's timeline.")
    query = f"{package} {version} release notes changelog features migration official documentation".strip()
    response = await search(query)
    # shortcut: name matching can omit relevant pages, revisit with verified registry links.
    normalized = re.sub(r"[^a-z0-9]", "", package.lower())
    sources = [
        source
        for source in response["results"]
        if normalized
        in re.sub(
            r"[^a-z0-9]",
            "",
            (source["title"] + source["url"] + source["content"]).lower(),
        )
    ]
    summary = await summarize(package, version, sources)
    entry = {
        "package": package,
        "version": version or None,
        "searched_at": datetime.now(UTC).isoformat(),
        "query": response["query"],
        "sources": sources,
        "summary": summary,
        "request_id": response.get("request_id"),
    }
    records = saved(analysis_id)
    records.insert(0, entry)
    path = snapshot_path(analysis_id).parent / "research.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(records[:100]))
    temporary.replace(path)
    return entry
