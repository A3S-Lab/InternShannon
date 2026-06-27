#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${SAFECLAW_APP_NAME:-书安}"
VERSION="${SAFECLAW_VERSION:-$(node -e 'console.log(require(process.argv[1]).version)' "$ROOT_DIR/package.json")}"
DMG_NAME="${SAFECLAW_DMG_NAME:-${APP_NAME}-${VERSION}.dmg}"
BUILD_BUNDLES="${SAFECLAW_BUILD_BUNDLES:-app}"
KEY_PATH="${SAFECLAW_TAURI_KEY_PATH:-$HOME/.tauri/safeclaw-updater.key}"
PUBKEY_PATH="${SAFECLAW_TAURI_PUBKEY_PATH:-${KEY_PATH}.pub}"
PASSWORD_FILE="${SAFECLAW_TAURI_KEY_PASSWORD_FILE:-$HOME/.tauri/safeclaw-updater.key.password}"
PASSWORD="${SAFECLAW_TAURI_KEY_PASSWORD:-}"
APP_BUNDLE_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/${APP_NAME}.app"
UPDATER_ARCHIVE_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/${APP_NAME}.app.tar.gz"
DMG_OUTPUT_DIR="${SAFECLAW_DMG_OUTPUT_DIR:-$ROOT_DIR/src-tauri/target/release/bundle/dmg}"
DMG_PATH="$DMG_OUTPUT_DIR/$DMG_NAME"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/safeclaw-dmg-stage.XXXXXX")"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

for cmd in pnpm node hdiutil ln rm cp; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "missing required command: $cmd" >&2
    exit 1
  }
done

if [[ -z "$PASSWORD" && -f "$PASSWORD_FILE" ]]; then
  PASSWORD="$(cat "$PASSWORD_FILE")"
fi

[[ -f "$KEY_PATH" ]] || {
  echo "Updater private key not found: $KEY_PATH" >&2
  exit 1
}

[[ -f "$PUBKEY_PATH" ]] || {
  echo "Updater public key not found: $PUBKEY_PATH" >&2
  exit 1
}

[[ -n "$PASSWORD" ]] || {
  echo "SAFECLAW_TAURI_KEY_PASSWORD is required" >&2
  echo "You can export it or keep it in $PASSWORD_FILE" >&2
  exit 1
}

export SAFECLAW_UPDATER_PUBKEY="$(cat "$PUBKEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$PASSWORD"

mkdir -p "$DMG_OUTPUT_DIR"

pushd "$ROOT_DIR" >/dev/null

echo "[safeclaw-dmg] building ${APP_NAME}.app"
pnpm tauri build --bundles "$BUILD_BUNDLES"

echo "[safeclaw-dmg] patching bundled a3s-box runtime"
node scripts/fix-macos-bundle.mjs

echo "[safeclaw-dmg] validating bundled a3s-box resources"
node scripts/verify-box-resources.mjs --dir "$APP_BUNDLE_PATH/Contents/Resources"

if [[ ! -d "$APP_BUNDLE_PATH" ]]; then
  echo "App bundle not found: $APP_BUNDLE_PATH" >&2
  exit 1
fi

if [[ ! -f "$UPDATER_ARCHIVE_PATH" ]]; then
  echo "Updater archive not found: $UPDATER_ARCHIVE_PATH" >&2
  echo "Expected because 书安 desktop builds must retain updater artifacts." >&2
  exit 1
fi

echo "[safeclaw-dmg] preparing dmg staging directory"
cp -R "$APP_BUNDLE_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"
rm -f "$DMG_PATH"

echo "[safeclaw-dmg] creating $DMG_PATH"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "[safeclaw-dmg] verifying dmg contents"
hdiutil verify "$DMG_PATH" >/dev/null

popd >/dev/null

echo
echo "Done."
echo "App:      $APP_BUNDLE_PATH"
echo "Updater:  $UPDATER_ARCHIVE_PATH"
echo "DMG:      $DMG_PATH"
