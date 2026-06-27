#!/usr/bin/env bash
set -euo pipefail

BOX_NAME="${BOX_NAME:-safeclaw-hermes}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOX_WORKSPACE_ROOT="${BOX_WORKSPACE_ROOT:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"
BOX_CARGO_MANIFEST="${BOX_CARGO_MANIFEST:-${BOX_WORKSPACE_ROOT}/Box/src/Cargo.toml}"
LOCAL_BOX_DEBUG_BIN="${LOCAL_BOX_DEBUG_BIN:-${BOX_WORKSPACE_ROOT}/Box/src/target/debug/a3s-box}"
LOCAL_BOX_RELEASE_BIN="${LOCAL_BOX_RELEASE_BIN:-${BOX_WORKSPACE_ROOT}/Box/src/target/release/a3s-box}"

resolve_user_home() {
	local username="$1"
	local home_dir=""

	if command -v getent >/dev/null 2>&1; then
		home_dir="$(getent passwd "$username" 2>/dev/null | cut -d: -f6 || true)"
		if [[ -n "$home_dir" ]]; then
			printf '%s\n' "$home_dir"
			return 0
		fi
	fi

	if command -v dscl >/dev/null 2>&1; then
		home_dir="$(
			dscl . -read "/Users/$username" NFSHomeDirectory 2>/dev/null |
				awk '{print $2}' || true
		)"
		if [[ -n "$home_dir" ]]; then
			printf '%s\n' "$home_dir"
			return 0
		fi
	fi

	if command -v python3 >/dev/null 2>&1; then
		home_dir="$(
			python3 - "$username" <<'PY' 2>/dev/null || true
import pwd
import sys

try:
    print(pwd.getpwnam(sys.argv[1]).pw_dir)
except KeyError:
    raise SystemExit(1)
PY
		)"
		if [[ -n "$home_dir" ]]; then
			printf '%s\n' "$home_dir"
			return 0
		fi
	fi

	return 1
}

resolve_invoking_home() {
	if [[ -n "${SUDO_USER:-}" ]]; then
		resolve_user_home "$SUDO_USER" ||
			{
				echo "Unable to resolve home directory for sudo user: $SUDO_USER" >&2
				exit 1
			}
		return
	fi

	printf '%s\n' "$HOME"
}

resolve_cargo_bin() {
	if command -v cargo >/dev/null 2>&1; then
		command -v cargo
		return 0
	fi

	if [[ -n "${INVOKING_HOME:-}" && -x "${INVOKING_HOME}/.cargo/bin/cargo" ]]; then
		printf '%s\n' "${INVOKING_HOME}/.cargo/bin/cargo"
		return 0
	fi

	return 1
}

INVOKING_HOME="${INVOKING_HOME:-$(resolve_invoking_home)}"

if [[ "$(uname -s)" == "Linux" && "$(id -u)" -ne 0 ]]; then
	echo "[safeclaw-hermes] Linux 上 a3s-box rm 当前需要 root 权限。" >&2
	echo "[safeclaw-hermes] 请改用: sudo scripts/hermes/stop-hermes-agent-box.sh" >&2
	exit 1
fi

if ! cargo_bin="$(resolve_cargo_bin)"; then
	cargo_bin=""
fi

if [[ -n "${A3S_BOX_BIN:-}" ]]; then
	A3S_BOX_CMD=("$A3S_BOX_BIN")
elif command -v a3s-box >/dev/null 2>&1; then
	A3S_BOX_CMD=("a3s-box")
elif [[ -x "$LOCAL_BOX_DEBUG_BIN" ]]; then
	A3S_BOX_CMD=("$LOCAL_BOX_DEBUG_BIN")
elif [[ -x "$LOCAL_BOX_RELEASE_BIN" ]]; then
	A3S_BOX_CMD=("$LOCAL_BOX_RELEASE_BIN")
elif [[ -n "$cargo_bin" && -f "$BOX_CARGO_MANIFEST" ]]; then
	A3S_BOX_CMD=("$cargo_bin" "run" "--manifest-path" "$BOX_CARGO_MANIFEST" "--bin" "a3s-box" "--")
elif [[ -f "$BOX_CARGO_MANIFEST" ]]; then
	echo "a3s-box binary not found, and cargo is not available in PATH. Expected one of:" >&2
	echo "  $LOCAL_BOX_DEBUG_BIN" >&2
	echo "  $LOCAL_BOX_RELEASE_BIN" >&2
	echo "  cargo run --manifest-path $BOX_CARGO_MANIFEST --bin a3s-box -- ..." >&2
	exit 1
else
	echo "a3s-box not found in PATH, and no local Box workspace manifest found at: $BOX_CARGO_MANIFEST" >&2
	exit 1
fi

echo "[safeclaw-hermes] stopping ${BOX_NAME}"
exec "${A3S_BOX_CMD[@]}" rm -f "$BOX_NAME"
