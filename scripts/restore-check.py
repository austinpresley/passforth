#!/usr/bin/env python3
"""Restore an owner-downloaded export into disposable local SQLite and compare every record."""
import argparse
import hashlib
import json
import sqlite3
import tempfile
from pathlib import Path
from urllib.parse import quote
from common import write_json

if not __debug__:
    raise RuntimeError("Restore verification requires normal Python mode; remove -O/PYTHONOPTIMIZE.")

TABLES = {"tasks", "events", "task_reads", "areas", "projects", "comments", "requests", "attachments", "notes", "note_links", "saved_views", "time_blocks", "planning_changes"}


def restore(source, snapshot_path, files, session, manifest=None):
    snapshot = json.loads(Path(snapshot_path).read_text())
    assert snapshot["schema_version"] == 4 and set(snapshot["tables"]) == TABLES, "Use the complete version 4 record export"
    with tempfile.TemporaryDirectory(prefix="passforth-restore-") as temporary:
        database = sqlite3.connect(Path(temporary) / "restored.sqlite")
        database.row_factory = sqlite3.Row
        for migration in sorted((Path(source) / "dashboard/drizzle").glob("*.sql")):
            database.executescript(migration.read_text())
        for table, rows in snapshot["tables"].items():
            columns = {r[1] for r in database.execute('PRAGMA table_info("' + table + '")')}
            for row in rows:
                assert set(row) <= columns and row, "Unknown export columns"
                keys = sorted(row)
                database.execute('INSERT INTO "' + table + '" (' + ','.join('"' + key + '"' for key in keys) + ') VALUES (' + ','.join('?' for _ in keys) + ')', [row[key] for key in keys])
        database.commit()
        for table, rows in snapshot["tables"].items():
            restored = [dict(row) for row in database.execute('SELECT * FROM "' + table + '"')]
            assert len(restored) == len(rows), "Record count differs: " + table
            by_id = {row["id"]: row for row in restored}
            for row in rows:
                assert all(by_id[row["id"]][key] == value for key, value in row.items()), "Restored field differs: " + table
        key = "selfhost-" + session["nonce"]
        assert database.execute("SELECT COUNT(*) FROM tasks WHERE task_key=?", (key,)).fetchone()[0] == 1
        attachments = snapshot["tables"]["attachments"]
        checksums = manifest or {}
        expected_test = session["receipts"]["read_attachment"]["value"]["sha256"]
        checksums[session["attachment_id"]] = expected_test
        assert {record["id"] for record in attachments} <= set(checksums), "Export a fresh live checksum manifest for every attachment"
        for record in attachments:
            contents = (Path(files) / quote(record["id"], safe="")).read_bytes()
            assert len(contents) == record["byte_size"]
            expected = checksums[record["id"]]
            assert hashlib.sha256(contents).hexdigest() == expected, "Attachment differs from its live read"
            copy = Path(temporary) / "restored-attachment"
            copy.write_bytes(contents)
            assert hashlib.sha256(copy.read_bytes()).hexdigest() == expected
    return {"schema_version": 1, "status": "PASS", "nonce": session["nonce"], "record_roundtrip": True,
            "attachment_roundtrip": True, "restored_task_key": key, "record_counts": {t:len(rows) for t, rows in snapshot["tables"].items()},
            "export_sha256": hashlib.sha256(Path(snapshot_path).read_bytes()).hexdigest(), "attachment_sha256": expected_test, "attachment_count": len(attachments)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="source"); parser.add_argument("--snapshot", required=True)
    parser.add_argument("--files", required=True); parser.add_argument("--session", default="evidence/mcp-session.json")
    parser.add_argument("--out", default="evidence/recovery.json"); parser.add_argument("--manifest")
    args = parser.parse_args()
    try:
        report = restore(args.source, args.snapshot, args.files, json.loads(Path(args.session).read_text()), json.loads(Path(args.manifest).read_text()) if args.manifest else None)
        write_json(args.out, report); print(json.dumps(report, indent=2))
    except (AssertionError, KeyError, OSError, sqlite3.Error) as error:
        parser.exit(2, "Restore verification failed: " + str(error) + "\n")
