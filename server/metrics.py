"""Metrics from recorded Time Machine experiments; missing history stays missing."""

import json
import statistics
from pathlib import Path


def calculate(directory: Path) -> dict:
    runs = []
    for path in directory.glob("*.json"):
        try:
            item = json.loads(path.read_text())
            if not item.get("evaluation") and item.get("status") in (
                "completed",
                "failed",
                "cancelled",
                "interrupted",
            ):
                runs.append(item)
        except (OSError, ValueError):
            continue
    completed = sum(run["status"] == "completed" for run in runs)
    durations = [
        run["first_result_at"] - run["started_at"]
        for run in runs
        if isinstance(run.get("first_result_at"), (int, float))
        and isinstance(run.get("started_at"), (int, float))
        and run["first_result_at"] >= run["started_at"]
    ]
    repairs = []
    for run in runs:
        for result in run.get("results", []):
            if isinstance(result.get("repair"), dict):
                repairs.append(result["repair"])
            attempts = result.get("dependency_repairs")
            if isinstance(attempts, list):
                repairs.extend(
                    attempt for attempt in attempts if isinstance(attempt, dict)
                )
            elif isinstance(result.get("dependency_repair"), dict):
                repairs.append(result["dependency_repair"])
    verified = sum(repair.get("status") == "verified" for repair in repairs)
    return {
        "completion": {"completed": completed, "terminal": len(runs)},
        "first_result_seconds": {
            "median": statistics.median(durations) if durations else None,
            "count": len(durations),
        },
        "repair": {"verified": verified, "attempts": len(repairs)},
        "run_statuses": {
            status: sum(run["status"] == status for run in runs)
            for status in ("completed", "failed", "cancelled", "interrupted")
        },
        "test_outcomes": {
            status: sum(
                result.get("status") == status
                for run in runs
                for result in run.get("results", [])
            )
            for status in ("passed", "failed", "inconclusive")
        },
        "duration_bins": [
            sum(duration < 30 for duration in durations),
            sum(30 <= duration < 60 for duration in durations),
            sum(60 <= duration < 120 for duration in durations),
            sum(duration >= 120 for duration in durations),
        ],
    }
