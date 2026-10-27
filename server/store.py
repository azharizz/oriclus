"""SQLite is the durable evidence ledger; only one service owns execution."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from server.config import DATA


def now() -> str:
    return datetime.now(UTC).isoformat()


def stop_incomplete(run: dict, status: str) -> None:
    for consumer in run["consumers"]:
        if consumer["status"] in ("preparing", "testing", "repairing"):
            consumer["status"] = status
        for attempt in consumer["attempts"]:
            if attempt["status"] in ("working", "verifying"):
                attempt["status"] = status


class Store:
    def __init__(self, path: Path = DATA / "runs.sqlite3"):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, document TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
                at TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS event_run ON events(run_id, id);
        """)

    def create(self, request: dict, status: str = "queued") -> dict:
        run = {
            "id": uuid4().hex,
            "created_at": now(),
            "updated_at": now(),
            "status": status,
            "request": request,
            "consumers": [],
            "analysis": None,
            "assessment": None,
            "error": None,
        }
        self.save(run)
        return run

    def save(self, run: dict) -> None:
        run["updated_at"] = now()
        with self.db:
            self.db.execute(
                "INSERT INTO runs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document",
                (run["id"], json.dumps(run)),
            )

    def get(self, run_id: str) -> dict | None:
        row = self.db.execute(
            "SELECT document FROM runs WHERE id = ?", (run_id,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def list(self) -> list[dict]:
        return [
            json.loads(row[0])
            for row in self.db.execute("SELECT document FROM runs ORDER BY rowid DESC")
        ]

    def event(self, run_id: str, kind: str, title: str, data: dict | str) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO events (run_id, at, kind, title, data) VALUES (?, ?, ?, ?, ?)",
                (run_id, now(), kind, title, json.dumps(data)),
            )

    def run_page(self, limit: int, offset: int, query: str, status: str) -> dict:
        # ponytail: scans local history; index extracted metadata if history outgrows this workspace.
        where = """WHERE (
            instr(lower(json_extract(document, '$.request.title')), lower(?)) > 0
            OR instr(lower(json_extract(document, '$.request.upstream')), lower(?)) > 0
        ) AND (? = '' OR json_extract(document, '$.status') = ?)"""
        parameters = (query, query, status, status)
        total = self.db.execute(
            f"SELECT count(*) FROM runs {where}", parameters
        ).fetchone()[0]
        rows = self.db.execute(
            f"""SELECT json_object(
                'id', id, 'created_at', json_extract(document, '$.created_at'),
                'status', json_extract(document, '$.status'),
                'request', json_object(
                    'title', json_extract(document, '$.request.title'),
                    'upstream', json_extract(document, '$.request.upstream'),
                    'baseline_ref', json_extract(document, '$.request.baseline_ref'),
                    'candidate_ref', json_extract(document, '$.request.candidate_ref')),
                'consumer_count', json_array_length(document, '$.request.consumers'))
                FROM runs {where}
                ORDER BY json_extract(document, '$.created_at') DESC, id DESC LIMIT ? OFFSET ?""",
            (*parameters, limit, offset),
        )
        return {"items": [json.loads(row[0]) for row in rows], "total": total}

    def active_run(self) -> dict | None:
        row = self.db.execute(
            """SELECT id, json_extract(document, '$.request.title'),
                json_extract(document, '$.status') FROM runs
                WHERE json_extract(document, '$.status') IN ('planning', 'queued', 'running')
                LIMIT 1"""
        ).fetchone()
        return {"id": row[0], "title": row[1], "status": row[2]} if row else None

    def event_page(self, run_id: str, limit: int, offset: int, kind: str) -> dict:
        where = "WHERE run_id = ? AND (? = '' OR kind = ?)"
        parameters = (run_id, kind, kind)
        total = self.db.execute(
            f"SELECT count(*) FROM events {where}", parameters
        ).fetchone()[0]
        rows = self.db.execute(
            f"SELECT id, at, kind, title FROM events {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            (*parameters, limit, offset),
        )
        return {
            "items": [
                {"id": row[0], "at": row[1], "kind": row[2], "title": row[3]}
                for row in rows
            ],
            "total": total,
        }

    def event_data(self, run_id: str, event_id: int) -> dict | None:
        row = self.db.execute(
            "SELECT data FROM events WHERE run_id = ? AND id = ?", (run_id, event_id)
        ).fetchone()
        return {"data": json.loads(row[0])} if row else None

    def events(self, run_id: str) -> list[dict]:
        rows = self.db.execute(
            "SELECT id, at, kind, title, data FROM events WHERE run_id = ? ORDER BY id",
            (run_id,),
        )
        return [
            {
                "id": r[0],
                "at": r[1],
                "kind": r[2],
                "title": r[3],
                "data": json.loads(r[4]),
            }
            for r in rows
        ]

    def interrupt_unfinished(self) -> None:
        for run in self.list():
            if run["status"] in ("planning", "queued", "running"):
                run.update(
                    status="interrupted",
                    error="The service stopped before this run completed. Start a new run to retry.",
                )
                stop_incomplete(run, "interrupted")
                self.save(run)
