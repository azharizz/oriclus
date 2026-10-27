"""User-requested public dependency research tied to an analysis."""

import json
from datetime import UTC, datetime

from server.config import BoundaryError
from server.research import search
from server.time_machine import get_analysis, snapshot_path


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
    entry = {
        "package": package,
        "version": version or None,
        "searched_at": datetime.now(UTC).isoformat(),
        "query": response["query"],
        "sources": response["results"],
        "request_id": response.get("request_id"),
    }
    records = saved(analysis_id)
    records.insert(0, entry)
    path = snapshot_path(analysis_id).parent / "research.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(records[:100]))
    temporary.replace(path)
    return entry
