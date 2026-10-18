#!/usr/bin/env python3
"""Validate real tool results from the recipient's connected plugin, without handling credentials."""
import argparse
import base64
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from common import profile_at, write_json

if not __debug__:
    raise RuntimeError("Verification requires normal Python mode; remove -O/PYTHONOPTIMIZE.")

ORDER = ["instance", "empty_tasks", "empty_workspace", "create", "replay", "update", "conflict", "area", "project", "assign", "note", "note_replay", "view", "block", "context", "maintenance", "maintenance_replay", "reference", "attachment", "read_attachment", "monitoring", "dot_reply", "offline_absent", "offline_present", "archive_note", "archive_view", "archive_block", "archive_project", "archive_area", "complete_offline", "final_task_context", "complete_setup", "backup", "final_workspace"]


def unwrap(raw):
    if isinstance(raw, dict) and "result" in raw: raw = raw["result"]
    if isinstance(raw, dict) and raw.get("isError"):
        return {"_tool_error": True, "message": json.dumps(raw.get("content", []))}
    if isinstance(raw, dict) and "content" in raw:
        if isinstance(raw.get("structuredContent"), dict): return raw["structuredContent"]
        texts = [c.get("text", "") for c in raw["content"] if c.get("type") == "text"]
        if len(texts) != 1: raise ValueError("Expected one actual JSON tool result")
        try: return json.loads(texts[0])
        except json.JSONDecodeError: raise ValueError("The tool response was not JSON")
    if not isinstance(raw, dict): raise ValueError("Expected an object tool result")
    return raw


def first_record(value):
    return value.get("record", value)


def context_task(value):
    if not isinstance(value.get("task"), dict): raise ValueError("Missing task in context")
    return value["task"]


def attachment_bytes(raw):
    if "result" in raw: raw = raw["result"]
    for item in raw.get("content", []):
        if item.get("type") == "resource":
            resource = item["resource"]
            if "blob" in resource: return base64.b64decode(resource["blob"], validate=True)
            if "text" in resource: return resource["text"].encode()
        if item.get("type") == "text": return item.get("text", "").encode()
    raise ValueError("Missing attachment bytes")


def initialize(profile, mode="new"):
    nonce = uuid.uuid4().hex
    return {"schema_version": 1, "mode": mode, "profile": profile, "nonce": nonce,
        "started_at": datetime.now(timezone.utc).isoformat(), "receipts": {}, "position": 0}


def payload(session, step):
    n, r = session["nonce"], session["receipts"]
    key = "selfhost-" + n
    def result(name): return r[name]["value"]
    def entity(name): return first_record(result(name))["id"]
    task = {"task_key": key, "title": "Self-host verification", "status": "paused", "summary": "Setup verification only. Dot has not accepted work.", "details": "VERIFICATION " + n, "event_id": n + "-create", "expected_version": 0}
    note = {"id": "note-" + n, "title": "Setup reference", "body": "SETUP-CONTEXT " + n, "tags": "setup/verification", "daily_on": None, "archived": False, "links": [{"target_type": "task", "target_key": key}], "event_id": n + "-note", "expected_version": 0}
    view = {"id": "view-" + n, "title": "Setup verification", "filters": {"query": n, "view": "all", "area_id": "", "project_id": "", "label": "", "scope": "all", "priority_min": 0}, "archived": False, "expected_version": 0, "event_id": n + "-view"}
    block = {"id": "block-" + n, "task_key": key, "starts_at": (datetime.fromisoformat(session["started_at"]) + timedelta(hours=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "duration_minutes": 15, "timezone": session["profile"]["timezone"], "archived": False, "expected_version": 0, "event_id": n + "-block"}
    context = {"target_type": "task", "target_key": key}
    calls = {
        "instance": ("get_instance", {}), "empty_tasks": ("list_tasks", {}), "empty_workspace": ("get_workspace", {}),
        "create": ("update_task", task), "replay": ("update_task", task),
        "update": ("update_task", {"task_key": key, "status": "waiting", "action_owner": "user", "blocker": "Verification only: inspect this test record.", "expected_version": 1, "event_id": n + "-update"}),
        "conflict": ("update_task", {"task_key": key, "summary": "This stale edit must be rejected.", "expected_version": 1, "event_id": n + "-conflict"}),
        "area": ("save_entity", {"type": "area", "id": "area-" + n, "title": "Setup verification", "expected_version": 0}),
        "note": ("save_note", note), "note_replay": ("save_note", note), "view": ("save_view", view), "block": ("save_time_block", block),
        "context": ("get_context", context), "reference": ("get_context", context), "attachment": ("get_context", context),
        "monitoring": ("get_workspace", {}), "dot_reply": ("get_context", context), "final_task_context": ("get_context", context),
        "offline_absent": ("list_tasks", {}), "offline_present": ("list_tasks", {}),
        "maintenance": ("maintain_workspace", {}), "maintenance_replay": ("maintain_workspace", {}),
        "backup": ("backup_workspace", {}), "final_workspace": ("get_workspace", {}),
    }
    if step in calls: return calls[step]
    if step == "project": return "save_entity", {"type": "project", "id": "project-" + n, "title": "Setup verification", "notes": "Verification " + n, "area_id": entity("area"), "expected_version": 0}
    if step == "assign": return "update_task", {"task_key": key, "area_id": entity("area"), "project_id": entity("project"), "expected_version": 2, "event_id": n + "-assign"}
    if step == "read_attachment": return "read_attachment", {"id": session["attachment_id"]}
    if step == "complete_setup": return "update_task", {"task_key": key, "status": "completed", "action_owner": "unknown", "blocker": "", "summary": "Private setup, live Dot reply and native offline recovery verified.", "expected_version": context_task(result("final_task_context"))["version"], "event_id": n + "-complete-setup-v" + str(context_task(result("final_task_context"))["version"])}
    if step == "complete_offline": return "update_task", {"task_key": session["offline_task"]["task_key"], "status": "completed", "summary": "Offline capture, restart and exactly one sync verified.", "expected_version": session["offline_task"]["version"], "event_id": n + "-offline-complete"}
    if step.startswith("archive_"):
        kind = step.removeprefix("archive_")
        previous = first_record(result(kind))
        if kind in ("area", "project"):
            return "save_entity", {"type": kind, "id": previous["id"], "title": previous["title"], "archived": True, "expected_version": previous["version"]}
        body = {"note": note, "view": view, "block": block}[kind].copy()
        body.update(id=previous["id"], archived=True, expected_version=previous["version"], event_id=n + "-archive-" + kind)
        return {"note": "save_note", "view": "save_view", "block": "save_time_block"}[kind], body
    raise ValueError("Unknown verification step")


def check(session, step, raw):
    n, key = session["nonce"], "selfhost-" + session["nonce"]
    if step == "read_attachment":
        data = attachment_bytes(raw)
        assert data == ("PASSFORTH ATTACHMENT " + n + "\n").encode(), "Attachment bytes differ"
        return {"sha256": hashlib.sha256(data).hexdigest(), "byte_count": len(data)}
    value = unwrap(raw)
    if step == "conflict":
        assert value.get("_tool_error") and any(word in value.get("message", "").lower() for word in ("changed", "conflict", "version")), "Stale update was not rejected"
        return {"rejected": True}
    assert not value.get("_tool_error"), "The plugin reported an error"
    if step == "instance":
        assert value.get("product") == "passforth" and value.get("api_version") == 1 and value.get("standard") == "passforth.setup.v1"
        assert value.get("project_id") == session["profile"]["site_project_id"], "This plugin belongs to another workspace"
    elif step == "empty_tasks":
        session["baseline_task_keys"] = [task["task_key"] for task in value.get("tasks", [])]
        assert session.get("mode", "new") == "existing" or value.get("tasks") == [], "This instance already has tasks. Review ownership and use an empty instance."
    elif step == "empty_workspace":
        for field in ("areas", "projects", "notes", "saved_views", "time_blocks", "comments", "requests"):
            assert session.get("mode", "new") == "existing" or not value.get(field), "This instance already has " + field
    elif step in ("create", "replay", "update", "assign", "complete_offline", "complete_setup"):
        task = value["task"]
        expected_key = session["offline_task"]["task_key"] if step == "complete_offline" else key
        assert task["task_key"] == expected_key and task["version"] == {"create": 1, "replay": 1, "update": 2, "assign": 3, "complete_offline": session.get("offline_task", {}).get("version", 0) + 1, "complete_setup": session.get("receipts", {}).get("final_task_context", {}).get("value", {}).get("task", {}).get("version", 0) + 1}[step]
        if step == "create": session["owner_digest"] = hashlib.sha256(task["owner"].encode()).hexdigest()
        if step == "replay": assert value.get("duplicate") is True
        if step == "update": assert task["action_owner"] == "user" and task["status"] == "waiting" and task["title"] == "Self-host verification" and task["details"] == "VERIFICATION " + n
    elif step in ("area", "project", "note", "note_replay", "view", "block") or step.startswith("archive_"):
        record = first_record(value)
        assert record.get("id") and record.get("version") == (2 if step.startswith("archive_") else 1)
        if step.startswith("archive_"): assert record["archived"] in (True, 1)
        if step == "note_replay": assert value.get("duplicate") is True
        _, expected = payload(session, step)
        assert record["id"] == expected["id"] or record["id"].endswith(":" + expected["id"]), "Record belongs to another save"
        for field in ("title", "body", "tags", "daily_on", "archived", "area_id", "notes", "task_key", "starts_at", "duration_minutes", "timezone"):
            if field in expected: assert record.get(field) == expected[field], "Saved field differs: " + field
        if "filters" in expected:
            actual = json.loads(record["filters"]) if isinstance(record["filters"], str) else record["filters"]
            assert actual == expected["filters"], "Saved filter differs"
        if "owner" in record: assert hashlib.sha256(record["owner"].encode()).hexdigest() == session["owner_digest"], "Record belongs to another owner"
        if step == "block": assert record["id"] != record["task_key"], "Block and task identities must differ"
    elif step in ("context", "reference", "attachment", "dot_reply", "final_task_context"):
        task = context_task(value)
        assert task["task_key"] == key
        if step == "final_task_context": assert n in task.get("details", ""), "Only complete this session's own verification record"
        if step == "context":
            assert task["version"] == 3 and any(note.get("body") == "SETUP-CONTEXT " + n for note in value.get("linked_notes", [])), "Linked reference missing"
        if step == "reference":
            assert any(c.get("kind") == "reference" and c.get("body") == "REFERENCE " + n and not c.get("request_id") for c in value.get("comments", [])), "Save the native reference comment before retrying this check"
            assert not any(c.get("kind") == "request" for c in value.get("comments", [])), "A reference comment must not create a request"
        if step == "attachment":
            files = [f for f in value.get("attachments", []) if f.get("filename") == "self-host-verification.txt"]
            assert len(files) == 1, "Upload the one generated test attachment in the native app"
            session["attachment_id"] = files[0]["id"]
        if step == "dot_reply":
            comments = value.get("comments", [])
            requests = [c for c in comments if c.get("kind") == "request" and c.get("body") == dot_request(n)]
            assert len(requests) == 1, "Send the one verification request through the native app"
            request = requests[0]
            assert request.get("request_state") == "answered" and request.get("acknowledged_at") and request.get("answered_at"), "The real Dot has not acknowledged and answered yet"
            assert request["created_at"] <= request["acknowledged_at"] <= request["answered_at"]
            assert any(c.get("kind") == "reply" and c.get("author_kind") == "agent" and c.get("request_id") == request["request_id"] and c.get("body", "").strip() == "PASSFORTH VERIFIED " + n for c in comments), "The exact same-request Dot reply is missing"
    elif step in ("monitoring", "final_workspace"):
        assert value.get("delivery", {}).get("subscribed") is True, "A verified request.created subscription is required"
        if step == "final_workspace":
            assert value["delivery"].get("pending_notifications") == 0 and value["delivery"].get("failed_notifications") == 0
    elif step.startswith("offline_"):
        assert set(session.get("baseline_task_keys", [])).issubset({t["task_key"] for t in value["tasks"]}), "An existing task disappeared"
        tasks = [t for t in value["tasks"] if t["title"] == "Offline verification " + n]
        assert len(tasks) == (0 if step == "offline_absent" else 1), "Offline capture reached the server too early, is missing, or duplicated"
        if step == "offline_present":
            assert tasks[0]["status"] == "paused" and tasks[0]["action_owner"] == "unknown" and tasks[0]["next_check_at"] is None
            session["offline_task"] = tasks[0]
    elif step.startswith("maintenance") or step == "backup":
        backup = value.get("backup", value)
        assert isinstance(backup.get("sha256"), str) and len(backup["sha256"]) == 64 and backup.get("record_counts", {}).get("tasks", 0) >= 1
        if step == "maintenance_replay":
            assert value.get("duplicate") is True and backup["sha256"] == session["receipts"]["maintenance"]["value"]["backup"]["sha256"]
        if step == "backup": assert backup.get("attachment_count", 0) >= 1 and "checksum-verified" in backup.get("attachment_contents", "")
    return value


def dot_request(nonce):
    return 'Setup verification only. Please reply in this same conversation with exactly: PASSFORTH VERIFIED ' + nonce + '. No other action is needed.'


def next_step(session):
    if session["position"] >= len(ORDER): return {"status": "PASS", "scope": "Live plugin checks only. Run the final acceptance report for complete readiness."}
    step = ORDER[session["position"]]
    tool, arguments = payload(session, step)
    notes = {
        "reference": "In the native app, open the verification task and Save as reference: REFERENCE " + session["nonce"],
        "attachment": "Run the attachment command, upload that file through the native app, then call get_context.",
        "monitoring": "Follow DOT_CONNECTION.md in the owner's personal Dot. Use this installation's plugin, request.created and agent_id dot.",
        "dot_reply": "Send exactly this through the native app once: " + dot_request(session["nonce"]) + " The setup agent must not acknowledge or answer the test.",
        "offline_absent": "Follow NATIVE_CHECKS.md: capture the named task offline and verify it plus the unsent draft across an offline restart. Keep the app offline for this read.",
        "offline_present": "Quit the offline app, reopen normally, wait for sync, then read tasks. Preserve screenshots/state evidence from both launches.",
    }
    return {"status": "NEXT", "step": step, "tool": tool, "arguments": arguments, "instructions": notes.get(step, "Call the actual recipient-owned plugin and save its raw response.")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "next", "record", "attachment", "status", "refresh-final-context"))
    parser.add_argument("--session", default="evidence/mcp-session.json")
    parser.add_argument("--profile", default="profile.json")
    parser.add_argument("--response")
    parser.add_argument("--mode", choices=("new", "existing"), default="new")
    args = parser.parse_args()
    path = Path(args.session)
    try:
        if args.command == "start":
            if path.exists(): raise ValueError("Session exists. Use next/status to resume it.")
            session = initialize(profile_at(args.profile), args.mode); write_json(path, session)
        else:
            session = json.loads(path.read_text())
        if args.command == "refresh-final-context":
            if ORDER[session["position"]] != "complete_setup": raise ValueError("Refresh is only for a completion conflict on the setup test task")
            session["position"] = ORDER.index("final_task_context")
            session["receipts"].pop("final_task_context", None)
            write_json(path, session)
        if args.command == "record":
            if not args.response: raise ValueError("Pass --response with the actual tool response file")
            if session["position"] >= len(ORDER): raise ValueError("Session already complete")
            response_path = Path(args.response).resolve()
            if path.parent.resolve() not in response_path.parents: raise ValueError("Save the raw response inside this session evidence directory")
            raw = json.loads(response_path.read_text()); step = ORDER[session["position"]]
            value = check(session, step, raw)
            session["receipts"][step] = {"value": value, "response_file": str(response_path.relative_to(path.parent.resolve())), "response_sha256": hashlib.sha256(response_path.read_bytes()).hexdigest(), "recorded_at": datetime.now(timezone.utc).isoformat()}
            session["position"] += 1; write_json(path, session)
        if args.command == "attachment":
            target = path.parent / "self-host-verification.txt"
            target.write_text("PASSFORTH ATTACHMENT " + session["nonce"] + "\n"); target.chmod(0o600)
            print(target.resolve())
        elif args.command == "status":
            print(json.dumps({"status": "PASS" if session["position"] == len(ORDER) else "BLOCKED", "passed": session["position"], "required": len(ORDER), "next": next_step(session)}, indent=2))
        else: print(json.dumps(next_step(session), indent=2))
    except (ValueError, KeyError, AssertionError, OSError) as error:
        parser.exit(2, "BLOCKED: " + str(error) + "\n")
