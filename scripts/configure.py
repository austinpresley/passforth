#!/usr/bin/env python3
"""Bind a recipient-owned backend and emit a connection file for the shared Mac app."""
import argparse
import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo
from common import profile_at, write_json

CLIENT_BUNDLE_ID = "com.apresley.dotdesk.menubar"

def configure(root, profile, connection_file=None):
    root = Path(root)
    if not (root / "SELF-HOST-SOURCE.json").is_file():
        raise ValueError("Use the clean source included in this kit.")
    path = root / "dashboard/.openai/hosting.json"
    hosting = json.loads(path.read_text())
    if hosting.get("project_id") not in (None, profile["site_project_id"]):
        raise ValueError("This source is bound to another Site. Preserve it and use a fresh kit.")
    ZoneInfo(profile["timezone"])
    hosting.update(project_id=profile["site_project_id"], d1="DB", r2="BUCKET", capabilities=["mcp"])
    write_json(path, hosting)
    maintenance = root / "dashboard/lib/maintenance.ts"
    value = maintenance.read_text()
    value = re.sub(r"timeZone: (?:'[^']+'|\"[^\"]+\")", "timeZone: " + json.dumps(profile["timezone"]), value, count=1)
    maintenance.write_text(value)
    config = {"schema_version": 1, "site_project_id": profile["site_project_id"], "site_url": profile["site_url"],
        "bundle_id": CLIENT_BUNDLE_ID, "client_mode": "release", "standard": "passforth.setup.v1"}
    write_json(root / "SELF-HOST-CONFIG.json", config)
    if connection_file:
        write_json(connection_file, {"format": "passforth.workspace", "schema_version": 1,
            "workspace_url": profile["site_url"] + "/", "project_id": profile["site_project_id"],
            "plugin_id": profile.get("plugin_id"), "name": "Passforth workspace"})
    return config

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--source", default="source")
    parser.add_argument("--connection-file", default="workspace.passforth")
    args = parser.parse_args()
    try:
        print(json.dumps(configure(args.source, profile_at(args.profile), args.connection_file), indent=2))
        print("Import " + args.connection_file + " into the signed Passforth download.")
    except (ValueError, OSError, KeyError) as error:
        parser.exit(2, str(error) + "\n")
