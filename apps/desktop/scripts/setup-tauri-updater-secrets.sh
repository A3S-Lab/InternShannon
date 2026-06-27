#!/usr/bin/env bash

set -euo pipefail

REPO="${1:-A3S-Lab/a3s}"
KEY_PATH="${SAFECLAW_TAURI_KEY_PATH:-$HOME/.tauri/safeclaw-updater.key}"
PASSWORD="${SAFECLAW_TAURI_KEY_PASSWORD:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required" >&2
  exit 1
fi

if [[ -z "$PASSWORD" ]]; then
  echo "SAFECLAW_TAURI_KEY_PASSWORD is required" >&2
  exit 1
fi

mkdir -p "$(dirname "$KEY_PATH")"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Generating Tauri updater keypair at $KEY_PATH"
  pnpm --dir apps/safeclaw tauri signer generate \
    --ci \
    --password "$PASSWORD" \
    --write-keys "$KEY_PATH"
else
  echo "Reusing existing private key at $KEY_PATH"
fi

if [[ ! -f "${KEY_PATH}.pub" ]]; then
  echo "Public key file not found at ${KEY_PATH}.pub" >&2
  exit 1
fi

echo "Validating gh authentication"
gh auth status >/dev/null

echo "Uploading updater secrets to $REPO"
gh secret set SAFECLAW_UPDATER_PUBKEY --repo "$REPO" < "${KEY_PATH}.pub"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEY_PATH"
printf '%s' "$PASSWORD" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO"

cat <<EOF
Done.

Uploaded secrets:
- SAFECLAW_UPDATER_PUBKEY
- TAURI_SIGNING_PRIVATE_KEY
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD

Private key:
- $KEY_PATH

Public key:
- ${KEY_PATH}.pub
EOF
