#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:---development}"
case "$MODE" in
    --development)
        OUTPUT="$PWD/build/Passforth.app"
        ARCHITECTURES=("$(uname -m)")
        IDENTITY=-
        SIGN_OPTIONS=(--timestamp=none)
        ;;
    --release)
        : "${DOT_DESK_SIGN_IDENTITY:?Set DOT_DESK_SIGN_IDENTITY to a Developer ID Application identity}"
        OUTPUT="$PWD/build/release/Passforth.app"
        ARCHITECTURES=(arm64 x86_64)
        IDENTITY="$DOT_DESK_SIGN_IDENTITY"
        SIGN_OPTIONS=(--options runtime --timestamp)
        ;;
    *) echo 'Usage: bash macos/build.sh [--development|--release]' >&2; exit 2 ;;
esac

SPARKLE=$(bash fetch-sparkle.sh)
mkdir -p build/module-cache "$(dirname "$OUTPUT")"
STAGING=$(mktemp -d "$PWD/build/staging.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT
APP_DIR="$STAGING/Passforth.app"
mkdir -p "$APP_DIR/Contents/"{MacOS,Resources,Frameworks}
cp Info.plist "$APP_DIR/Contents/Info.plist"
cp DotDesk.icns "$APP_DIR/Contents/Resources/"
cp "$SPARKLE/LICENSE" "$APP_DIR/Contents/Resources/Sparkle-LICENSE.txt"
ditto "$SPARKLE/Sparkle.framework" "$APP_DIR/Contents/Frameworks/Sparkle.framework"
FRAMEWORK="$APP_DIR/Contents/Frameworks/Sparkle.framework"

# This app is not sandboxed, so Sparkle's optional XPC services are unused.
rm -rf "$FRAMEWORK/Versions/B/XPCServices" "$FRAMEWORK/XPCServices"
if [[ "$MODE" == --development ]]; then
    /usr/libexec/PlistBuddy -c 'Set :SUEnableAutomaticChecks false' "$APP_DIR/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c 'Set :SUAutomaticallyUpdate false' "$APP_DIR/Contents/Info.plist"
fi

BINARIES=()
for ARCH in "${ARCHITECTURES[@]}"; do
    BINARY="$STAGING/DotDesk-$ARCH"
    xcrun swiftc -O -parse-as-library -target "$ARCH-apple-macosx13.0" \
        -module-cache-path build/module-cache -F "$SPARKLE" \
        -framework Cocoa -framework SwiftUI -framework WebKit -framework Sparkle -framework Carbon -lsqlite3 \
        -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
        main.swift Updates.swift Native/*.swift -o "$BINARY"
    BINARIES+=("$BINARY")
done
if [[ ${#BINARIES[@]} -eq 1 ]]; then
    cp "${BINARIES[0]}" "$APP_DIR/Contents/MacOS/DotDesk"
else
    xcrun lipo -create "${BINARIES[@]}" -output "$APP_DIR/Contents/MacOS/DotDesk"
fi

# Sign nested executables before their containing bundles. --deep is for verification only.
for COMPONENT in "$FRAMEWORK/Versions/B/Autoupdate" "$FRAMEWORK/Versions/B/Updater.app" "$FRAMEWORK" "$APP_DIR"; do
    codesign --force --sign "$IDENTITY" "${SIGN_OPTIONS[@]}" "$COMPONENT" >&2
done
codesign --verify --deep --strict "$APP_DIR" >&2
plutil -lint "$APP_DIR/Contents/Info.plist" >&2
rm -rf "$OUTPUT"
mv "$APP_DIR" "$OUTPUT"
printf '%s\n' "$OUTPUT"
