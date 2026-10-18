#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
TASK_TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TASK_TEST_DIR"' EXIT
xcrun swiftc -parse-as-library macos/Native/Models.swift macos/Native/LocalCache.swift \
  macos/Native/WorkspaceConnection.swift macos/tests/WorkspaceConnectionTests.swift -lsqlite3 -o "$TASK_TEST_DIR/workspace-connection"
"$TASK_TEST_DIR/workspace-connection"
