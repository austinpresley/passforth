#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# Pin both the release and its GitHub-published SHA256. Never fetch "latest".
VERSION=2.10.0
SHA256=c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c
DEST="$PWD/.cache/Sparkle-$VERSION"
ARCHIVE="$PWD/.cache/Sparkle-$VERSION.tar.xz"
mkdir -p .cache
if [[ ! -f "$ARCHIVE" ]]; then
    curl --fail --location --silent --show-error \
        "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-$VERSION.tar.xz" \
        -o "$ARCHIVE.download"
    mv "$ARCHIVE.download" "$ARCHIVE"
fi
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | shasum -a 256 --check >&2
if [[ ! -f "$DEST/.verified-$SHA256" ]]; then
    rm -rf "$DEST"
    mkdir -p "$DEST"
    tar -xf "$ARCHIVE" -C "$DEST"
    touch "$DEST/.verified-$SHA256"
fi
printf '%s\n' "$DEST"
