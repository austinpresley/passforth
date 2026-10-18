#!/usr/bin/env python3
"""Verify the untouched kit before configuring an installation."""
import argparse
import hashlib
import json
from pathlib import Path
from common import write_json


def verify(root):
    root = Path(root).resolve()
    manifest = json.loads((root / "MANIFEST.json").read_text())
    errors = []
    for name, expected in manifest["files"].items():
        path = root / name
        if path.is_symlink() or root not in path.resolve().parents or not path.is_file():
            errors.append("Missing or unsafe file: " + name)
        elif hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            errors.append("Changed file: " + name)
    expected_files = set(manifest["files"]) | {"MANIFEST.json", "profile.json", "workspace.passforth"}
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if "__pycache__" in relative.parts or relative.parts[0] in ("evidence", ".git"):
            continue
        if path.is_file() and str(relative) not in expected_files:
            errors.append("Unexpected file before setup: " + str(relative))
    return {"schema_version": 1, "gate": "K01", "status": "FAIL" if errors else "PASS",
            "manifest_sha256": hashlib.sha256((root / "MANIFEST.json").read_bytes()).hexdigest(),
            "checked_files": len(manifest["files"]), "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kit", default=".")
    parser.add_argument("--out", default="evidence/package.json")
    args = parser.parse_args()
    result = verify(args.kit)
    write_json(args.out, result)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["status"] == "PASS" else 1)
