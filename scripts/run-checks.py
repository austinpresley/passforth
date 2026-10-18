#!/usr/bin/env python3
"""Run real source checks and retain exit codes and logs for acceptance."""
import argparse
import json
import os
import platform
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError
from common import source_fingerprint, write_json

SERVER = [["node", "node_modules/typescript/bin/tsc", "--noEmit"]] + [
    ["node", "tests/" + name + ".mjs"] for name in
    ("instance", "schema", "auth", "storage", "task-model", "conversations", "planning-migration", "mcp-event-errors", "event-runtime")
] + [["npm", "run", "build"]]


def run(root, phase, destination):
    root, destination = Path(root).resolve(), Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.parent.chmod(0o700)
    records = []
    before = source_fingerprint(root)
    def execute(argv, directory, env=None):
        started = time.monotonic()
        name = str(len(records) + 1).zfill(2) + ".log"
        log = destination.parent / (phase + "-" + name)
        try:
            result = subprocess.run(argv, cwd=directory, env=env, capture_output=True, text=True, timeout=600)
            output, code = result.stdout + result.stderr, result.returncode
        except (OSError, subprocess.TimeoutExpired) as failure:
            output, code = type(failure).__name__ + ": command unavailable or timed out", 2
        log.write_text(output); log.chmod(0o600)
        records.append({"argv": argv, "exit_code": code, "seconds": round(time.monotonic() - started, 2), "log": log.name})
        print(("PASS " if code == 0 else "FAIL ") + " ".join(argv), flush=True)
        return code == 0
    if phase == "server":
        for command in SERVER:
            execute(command, root / "dashboard")
    elif phase == "native":
        if platform.system() != "Darwin":
            return {"schema_version": 1, "phase": phase, "status": "BLOCKED", "reason": "A Mac is required", "results": []}
        execute(["bash", "macos/tests/native-core.sh"], root)
        execute(["bash", "macos/build.sh"], root)
    else:
        if execute(["node", "scripts/init-local-db.mjs"], root):
            with socket.socket() as port_probe:
                port_probe.bind(("127.0.0.1", 0)); port = port_probe.getsockname()[1]
            base = "http://127.0.0.1:" + str(port)
            env = {**os.environ, "PASSFORTH_TEST_URL": base, "CLOUDFLARE_CF_FETCH_ENABLED": "false"}
            log_path = destination.parent / "local-preview.log"
            with log_path.open("w") as log:
                process = subprocess.Popen(["npm", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", str(port), "--strictPort"],
                    cwd=root / "dashboard", env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    ready = False
                    for _ in range(90):
                        if process.poll() is not None: break
                        try:
                            with urlopen(base + "/api/tasks", timeout=2) as response:
                                ready = response.status == 200
                            if ready: break
                        except HTTPError as failure:
                            if failure.code == 401:
                                ready = True
                                break
                            time.sleep(1)
                        except Exception: time.sleep(1)
                    if ready:
                        for name in ("smoke", "workspace-smoke", "planning-smoke"):
                            execute(["node", "tests/" + name + ".mjs"], root / "dashboard", env)
                    else:
                        records.append({"argv": ["local-preview"], "exit_code": 2, "log": log_path.name})
                finally:
                    import signal
                    os.killpg(process.pid, signal.SIGTERM)
                    try: process.wait(timeout=15)
                    except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait()
            log_path.chmod(0o600)
    after = source_fingerprint(root)
    return {"schema_version": 1, "phase": phase, "status": "PASS" if records and all(r["exit_code"] == 0 for r in records) and before == after else "FAIL",
            "source_sha256": after, "source_changed_during_checks": before != after,
            "finished_at": datetime.now(timezone.utc).isoformat(), "results": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("server", "smoke", "native"))
    parser.add_argument("--source", default="source")
    parser.add_argument("--out")
    args = parser.parse_args()
    output = args.out or "evidence/" + args.phase + ".json"
    report = run(args.source, args.phase, output)
    write_json(output, report)
    print(json.dumps({k:v for k,v in report.items() if k != "results"}, indent=2))
    raise SystemExit(0 if report["status"] == "PASS" else 2)
