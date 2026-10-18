#!/usr/bin/env python3
"""Build the final readiness report. Missing evidence produces BLOCKED, never READY."""
import argparse
import hashlib
import importlib.util
import json
import plistlib
from pathlib import Path
from common import bundle_id, cache_namespace, profile_at, source_fingerprint, write_json


def report(kit, source, evidence, profile):
    kit, source, evidence = map(Path, (kit, source, evidence))
    requirements = json.loads((kit / "requirements.json").read_text())["gates"]
    gates = {key: {"description": description, "status": "BLOCKED", "reason": "Evidence is missing"} for key, description in requirements.items()}
    def test(ids, action):
        if isinstance(ids, str): ids = [ids]
        try:
            action()
            for key in ids: gates[key].update(status="PASS", reason="Evidence checks passed")
        except FileNotFoundError: pass
        except (AssertionError, ValueError, KeyError, TypeError, OSError) as error:
            for key in ids: gates[key].update(status="FAIL", reason=str(error) or "Evidence did not satisfy the spec")
    def load(name): return json.loads((evidence / name).read_text())
    def check(condition, message):
        if not condition: raise ValueError(message)
    def package():
        p = load("package.json")
        check(p["status"] == "PASS" and p["checked_files"] == len(json.loads((kit / "MANIFEST.json").read_text())["files"]) and p["manifest_sha256"] == hashlib.sha256((kit / "MANIFEST.json").read_bytes()).hexdigest(), "Package integrity evidence does not match this kit")
    test("K01", package)
    fingerprint = source_fingerprint(source)
    def commands(name, expected):
        p = load(name + ".json")
        check(p["status"] == "PASS" and p["source_sha256"] == fingerprint and not p["source_changed_during_checks"], "Rerun checks against the configured source")
        actual = [row["argv"] for row in p["results"] if row["exit_code"] == 0]
        check(all(command in actual for command in expected), "Required commands are missing")
        for row in p["results"]: check((evidence / row["log"]).is_file(), "Check log is missing")
    spec = importlib.util.spec_from_file_location("run_checks", kit / "scripts/run-checks.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    test("L01", lambda: commands("server", module.SERVER))
    test("L02", lambda: commands("smoke", [["node", "tests/" + n + ".mjs"] for n in ("smoke", "workspace-smoke", "planning-smoke")]))
    def provider():
        p = load("provider.json")
        check(p["project_id"] == profile["site_project_id"] and p["site_url"].rstrip("/") == profile["site_url"], "Provider evidence is for another Site")
        check(p["current_user_role"] == "owner" and p["owner_private"] is True and p["allowed_viewer_count"] == 1, "Owner-only access must be confirmed through provider tools")
        check(p["d1_binding"] == "DB" and p["r2_binding"] == "BUCKET" and p["deployment_status"] == "succeeded" and len(p["deployed_commit"]) == 40, "Storage or deployment evidence is incomplete")
        check(p["plugin_id"] == profile["plugin_id"] and p["mcp_url"] == profile["site_url"] + "/mcp", "Use this Site's provisioned plugin")
        check(p["source_sha256"] == fingerprint, "Deployed source and tested source differ")
    test("P01", provider)
    def operator():
        p = load("operator.json")
        check(p["account_billing_reviewed"] is True and p["usage_limits_recorded"] and p["backup_retention_plan"] and p["provider_account_is_recipient_owned"] is True, "Record the owner's actual billing and storage limits")
        check(p["paid_resources_created"] is False or profile["new_paid_resources_authorized"] is True, "Paid resources need explicit owner authorization")
    test("P02", operator)
    def public():
        p = load("public.json")
        check(p["status"] == "PASS" and p["site_url"] == profile["site_url"] and len(p["results"]) == 8 and all(r["passed"] for r in p["results"]), "Public boundary probes failed")
    test("H01", public)
    live = None
    def mcp():
        nonlocal live
        live = load("mcp-session.json")
        spec = importlib.util.spec_from_file_location("verify_mcp", kit / "scripts/verify-mcp.py")
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        check(live["profile"] == profile and live["position"] == len(module.ORDER), "Live plugin verification is incomplete or belongs to another profile")
        check(set(live["receipts"]) == set(module.ORDER), "A verification receipt is missing")
        replay = {"nonce": live["nonce"], "profile": live["profile"], "started_at": live["started_at"], "mode": live.get("mode", "new"), "receipts": {}}
        for step in module.ORDER:
            receipt = live["receipts"][step]
            response = evidence / receipt["response_file"]
            check(evidence.resolve() in response.resolve().parents and not response.is_symlink(), "Unsafe response path")
            check(hashlib.sha256(response.read_bytes()).hexdigest() == receipt["response_sha256"], "Live response changed: " + step)
            value = module.check(replay, step, json.loads(response.read_text()))
            check(value == receipt["value"], "Stored result differs from its raw response")
            replay["receipts"][step] = receipt
    test(["M01", "D01"], mcp)
    def native():
        p = load("client.json")
        check(p["standard"] == "passforth.setup.v1" and p["workspace_url"].rstrip("/") == profile["site_url"] and p["project_id"] == profile["site_project_id"], "Import this workspace into the shared client and export fresh verification data")
        app = Path(p["verified_app_path"])
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        check(info["CFBundleIdentifier"] == "com.apresley.dotdesk.menubar" and int(info["CFBundleVersion"]) >= 8, "Use the supported shared Mac release")
        check(not info.get("DotDeskDashboardURL") and info["SUFeedURL"] == "https://github.com/austinpresley/passforth/releases/latest/download/appcast.xml", "The client must use runtime connection settings and the public update feed")
        import subprocess
        for argv in (["codesign", "--verify", "--deep", "--strict", str(app)], ["spctl", "--assess", "--type", "execute", str(app)]):
            check(subprocess.run(argv, capture_output=True).returncode == 0, "Installed client signature/Gatekeeper check failed")
        check(p["cache_namespace"] == cache_namespace(profile), "Workspace cache isolation is missing")
    test("N01", native)
    def observed(ids, flags):
        p = load("native-observations.json")
        check(live is not None and p["nonce"] == live["nonce"] and p["bundle_id"] == "com.apresley.dotdesk.menubar", "Native observations do not match this verification session")
        for key in flags: check(p.get(key) is True, "Native observation required: " + key)
        for name in p["evidence_files"]: check((evidence / name).is_file(), "Native screenshot/state evidence is missing")
        check(len(p["evidence_files"]) >= 3, "Retain native signed-in, offline restart and reconnected evidence")
    test("N02", lambda: observed("N02", ["native_signin", "reference_saved_without_request", "native_file_upload", "native_file_download_bytes_match"]))
    test("N03", lambda: observed("N03", ["offline_capture_visible", "draft_visible_after_offline_restart", "capture_absent_from_server_while_offline", "one_capture_after_reconnect", "outbox_empty_after_reconnect", "draft_still_unsent"]))
    def maintenance():
        p = load("maintenance.json")
        check(p["plugin_id"] == profile["plugin_id"] and p["enabled"] is True and p["hourly"] is True and p["timezone"] == profile["timezone"], "Maintenance is not configured for this instance")
        check(p["automation_id"] and p["observed_cloud_run_id"] and p["run_outcome"] == "succeeded" and p["interactive_auth_required"] is False and p["result"]["backup"]["sha256"], "Observe an actual cloud maintenance run before calling it active")
    test("A01", maintenance)
    def recovery():
        p = load("recovery.json")
        check(live is not None and p["nonce"] == live["nonce"] and p["status"] == "PASS" and p["record_roundtrip"] is True and p["attachment_roundtrip"] is True and p["restored_task_key"] == "selfhost-" + live["nonce"], "Restore into a separate temporary database and verify the test attachment")
    test("R01", recovery)
    ready = all(g["status"] == "PASS" for g in gates.values())
    return {"schema_version": 1, "status": "READY" if ready else "INCOMPLETE", "site_url": profile["site_url"], "source_sha256": fingerprint,
            "gates": gates, "note": "Command/HTTP checks and agent-observed UI/provider evidence are distinguished in the setup spec. This report is not a cryptographic attestation of another agent's honesty."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kit", default="."); parser.add_argument("--source", default="source")
    parser.add_argument("--profile", default="profile.json"); parser.add_argument("--evidence", default="evidence")
    parser.add_argument("--out", default="evidence/acceptance.json")
    args = parser.parse_args()
    value = report(args.kit, args.source, args.evidence, profile_at(args.profile))
    write_json(args.out, value)
    print(json.dumps(value, indent=2))
    raise SystemExit(0 if value["status"] == "READY" else 2)
