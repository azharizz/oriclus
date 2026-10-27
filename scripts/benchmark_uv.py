"""Repeat the same bounded candidate tests with uv alone and with Oriclus.

Prints the comparison to stdout only; no benchmark comparison file is written.
"""

import argparse
import asyncio
import json
import shlex
import statistics
import sys
import time
from pathlib import Path

from packaging.utils import canonicalize_name

from server.config import BoundaryError
from server.time_machine import analyze, snapshot_path
from server.timeline_execution import Sandbox, TimelineRuns, _test_environment


def candidate_specs(analysis, package, version):
    """Keep the project requirements while replacing only the chosen direct pin."""
    if analysis["manager"] != "pip" or analysis["ecosystem"] != "python":
        raise BoundaryError(
            "This benchmark currently supports pip requirements.txt projects only."
        )
    if any(
        w.startswith(
            (
                "Dynamic Python dependencies",
                "Requirements file options",
                "Unsupported Python requirement",
            )
        )
        for w in analysis.get("warnings", [])
    ):
        raise BoundaryError("The project's requirements cannot be compared completely.")
    match = [
        p
        for p in analysis["packages"]
        if p["direct"] and canonicalize_name(p["name"]) == canonicalize_name(package)
    ]
    if len(match) != 1 or version not in {r["version"] for r in match[0]["releases"]}:
        raise BoundaryError(
            "Choose a direct dependency and a release from its metadata."
        )
    specs = []
    for p in analysis["packages"]:
        if not p["direct"]:
            continue
        extras = f"[{','.join(p.get('extras', []))}]" if p.get("extras") else ""
        requirement = (
            f"=={version}"
            if p is match[0]
            else ("" if p["requirement"] == "*" else p["requirement"])
        )
        marker = f"; {p['marker']}" if p.get("marker") else ""
        specs.append(p["name"] + extras + requirement + marker)
    return specs


async def uv_trial(analysis, package, versions, command):
    started = time.monotonic()
    record = {"status": "failed", "first_seconds": None, "results": [], "repair": None}
    try:
        box = Sandbox()
        base = await box.project(snapshot_path(analysis["id"]), "python")
        install = await box.run(
            base,
            "python -m pip install --quiet uv && uv pip install --system -r requirements.txt",
            network=True,
            save=True,
        )
        if install["exit_code"] != 0 or not install["image_id"]:
            record["error"] = "uv baseline installation failed"
            return record
        parent = install["image_id"]
        baseline = await box.run(parent, _test_environment(command), network=False)
        record["baseline_exit"] = baseline["exit_code"]
        if baseline["exit_code"] != 0 or baseline["timed_out"]:
            record["error"] = "baseline failed or timed out"
            return record
        for version in versions:
            specs = candidate_specs(analysis, package, version)
            install = await box.run(
                parent,
                "uv pip install --system " + " ".join(shlex.quote(x) for x in specs),
                network=True,
                save=True,
            )
            if install["exit_code"] or not install["image_id"]:
                record["results"].append({"version": version, "status": "inconclusive"})
                continue
            test = await box.run(
                install["image_id"], _test_environment(command), network=False
            )
            status = (
                "inconclusive"
                if test["timed_out"]
                else "passed"
                if test["exit_code"] == 0
                else "failed"
            )
            record["results"].append({"version": version, "status": status})
            if record["first_seconds"] is None and status != "inconclusive":
                record["first_seconds"] = round(time.monotonic() - started, 3)
        record["status"] = "completed"
    except Exception as exc:  # noqa: BLE001 - report failure instead of dropping a trial
        record["error"] = (
            f"{type(exc).__name__}: {exc}"
            if isinstance(exc, BoundaryError)
            else type(exc).__name__
        )
    finally:
        record["total_seconds"] = round(time.monotonic() - started, 3)
    return record


async def oriclus_trial(analysis, package, versions, command):
    started = time.monotonic()
    runs = TimelineRuns()
    run = await runs.start(analysis["id"], package, versions, command)
    task = runs.tasks[run["id"]]
    await task
    run = runs.get(run["id"])
    repairs = [r["repair"] for r in run["results"] if r.get("repair")]
    return {
        "status": run["status"],
        "first_seconds": round(run["first_result_at"] - run["started_at"], 3)
        if run.get("first_result_at")
        else None,
        "total_seconds": round(time.monotonic() - started, 3),
        "baseline_exit": (run.get("baseline") or {}).get("exit_code"),
        "results": [
            {"version": r["version"], "status": r["status"]} for r in run["results"]
        ],
        "repair": {
            "attempts": len(repairs),
            "verified": sum(r["status"] == "verified" for r in repairs),
        },
        "error": run.get("error"),
    }


def aggregate(trials, has_repairs):
    durations = [
        t["first_seconds"] for t in trials if t.get("first_seconds") is not None
    ]
    repairs = [t["repair"] for t in trials if t.get("repair")]
    return {
        "completed": sum(t["status"] == "completed" for t in trials),
        "trials": len(trials),
        "first_result_median_seconds": statistics.median(durations)
        if durations
        else None,
        "timed_trials": len(durations),
        "repair": {
            "verified": sum(r["verified"] for r in repairs),
            "attempts": sum(r["attempts"] for r in repairs),
        }
        if has_repairs
        else None,
    }


async def main(args):
    analysis = await analyze("local", str(args.project.resolve()))
    if not (snapshot_path(analysis["id"]) / "requirements.txt").is_file():
        raise BoundaryError("The benchmark currently requires a requirements.txt file.")
    for version in args.versions:
        candidate_specs(analysis, args.package, version)
    records = {"uv": [], "oriclus": []}
    for trial in range(args.trials):
        order = ("uv", "oriclus") if trial % 2 == 0 else ("oriclus", "uv")
        for name in order:
            print(
                f"Trial {trial + 1}/{args.trials}: {name}", file=sys.stderr, flush=True
            )
            runner = uv_trial if name == "uv" else oriclus_trial
            records[name].append(
                await runner(analysis, args.package, args.versions, args.test)
            )
    report = {
        "project": str(args.project.resolve()),
        "package": args.package,
        "versions": args.versions,
        "test": args.test,
        "sandbox_base": "python:3.12-slim",
        "notes": [
            "One Sandbox project snapshot per workflow and trial; same project, candidate constraints and test command.",
            "uv alone installs using uv and does not perform AI repair; Oriclus uses the project's pip resolver, checkpoints and optional agent repair.",
            "First result is elapsed time from trial start to the first conclusive candidate test; total Oriclus time includes any repair.",
            "Resolvers may choose different transitive versions; a matching outcome does not prove identical environments.",
            "These are sequential trials; network, image caching and provider variation affect timings. No benchmark report is written to a file.",
        ],
        "observed_results_match": [
            u.get("baseline_exit") == o.get("baseline_exit") == 0
            and u["results"] == o["results"]
            and len(u["results"]) == len(args.versions)
            and all(r["status"] in ("passed", "failed") for r in u["results"])
            for u, o in zip(records["uv"], records["oriclus"], strict=True)
        ],
        "summary": {
            name: aggregate(trials, name == "oriclus")
            for name, trials in records.items()
        },
        "trials": records,
    }
    print(json.dumps(report, indent=2))


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project", type=Path, default=Path("examples/timeline-python")
    )
    parser.add_argument("--package", default="MarkupSafe")
    parser.add_argument("--versions", nargs="+", default=["2.0.1", "2.1.5"])
    parser.add_argument("--test", default="python -m unittest -v")
    parser.add_argument("--trials", type=int, default=1, choices=range(1, 6))
    args = parser.parse_args()
    if not 1 <= len(args.versions) <= 5:
        parser.error("Choose one to five versions.")
    asyncio.run(main(args))


if __name__ == "__main__":
    cli()
