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
    _store(analysis_id, entry)
    return entry


def _store(analysis_id: str, entry: dict) -> None:
    records = saved(analysis_id)
    records.insert(0, entry)
    path = snapshot_path(analysis_id).parent / "research.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(records[:100]))
    temporary.replace(path)


def feed() -> dict:
    """Collect local analyses and previously saved research by ecosystem and package."""
    from packaging.utils import canonicalize_name

    from server.time_machine import TIMELINES

    def package_key(ecosystem: str, name: str) -> str:
        return canonicalize_name(name) if ecosystem == "python" else name.lower()

    groups = {}
    projects = {}
    for path in sorted(
        TIMELINES.glob("*/analysis.json"), key=lambda p: p.stat().st_mtime, reverse=True
    ):
        try:
            analysis = json.loads(path.read_text())
            analysis_id = analysis["id"]
            if (
                not re.fullmatch(r"[a-f0-9]{32}", analysis_id)
                or path.parent.name != analysis_id
            ):
                continue
            key = analysis.get("project_key", analysis_id)
            if key in projects:
                for record in saved(analysis_id):
                    group_key = (
                        analysis["ecosystem"],
                        package_key(analysis["ecosystem"], record.get("package", "")),
                    )
                    group = groups.get(group_key)
                    if (
                        group
                        and any(
                            p["analysis_id"] == projects[key]["analysis_id"]
                            for p in group["projects"]
                        )
                        and not any(
                            r.get("searched_at") == record.get("searched_at")
                            and r.get("query") == record.get("query")
                            for r in group["research"]
                        )
                    ):
                        group["research"].append(record)
                continue
            project = {
                "analysis_id": analysis_id,
                "name": analysis.get("project_name")
                or f"Project snapshot {analysis_id[:8]}",
            }
            projects[key] = project
            records = saved(analysis_id)
            for package in analysis.get("packages", []):
                ecosystem = analysis["ecosystem"]
                group_key = (ecosystem, package_key(ecosystem, package["name"]))
                group = groups.setdefault(
                    group_key,
                    {
                        "name": package["name"],
                        "ecosystem": ecosystem,
                        "projects": [],
                        "latest": None,
                        "research": [],
                    },
                )
                group["projects"].append(
                    {
                        **project,
                        "name_in_project": package["name"],
                        "direct": package["direct"],
                        "requirement": package.get("requirement", ""),
                    }
                )
                for release in package.get("releases", []):
                    if release.get("date") and (
                        not group["latest"] or release["date"] > group["latest"]["date"]
                    ):
                        group["latest"] = {
                            **release,
                            "analysis_id": analysis_id,
                            "package": package["name"],
                        }
                for record in records:
                    if package_key(
                        analysis["ecosystem"], record.get("package", "")
                    ) == group_key[1] and not any(
                        r.get("searched_at") == record.get("searched_at")
                        and r.get("query") == record.get("query")
                        for r in group["research"]
                    ):
                        group["research"].append(record)
        except (OSError, ValueError, KeyError, TypeError, BoundaryError):
            continue
    for group in groups.values():
        group["research"].sort(key=lambda r: r.get("searched_at", ""), reverse=True)
        group["research"] = group["research"][:10]
    return {
        "projects": list(projects.values()),
        "groups": sorted(
            groups.values(), key=lambda g: (g["name"].lower(), g["ecosystem"])
        ),
    }


async def refresh_group(group: dict) -> None:
    """Search a shared package once, then retain the result with each project."""
    first = group["projects"][0]
    entry = await investigate(first["analysis_id"], first["name_in_project"], "")
    for project in group["projects"][1:]:
        _store(project["analysis_id"], {**entry, "package": project["name_in_project"]})
