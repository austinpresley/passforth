#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
xcrun swiftc -parse-as-library macos/Native/Models.swift macos/Native/LocalCache.swift \
  macos/Native/Confirmation.swift macos/tests/NativeCore.swift -lsqlite3 -o "$TEST_DIR/native-core"
"$TEST_DIR/native-core"
