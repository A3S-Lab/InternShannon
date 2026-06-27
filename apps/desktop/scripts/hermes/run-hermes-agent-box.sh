#!/usr/bin/env bash
set -euo pipefail

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
INVOKING_UID="${INVOKING_UID:-${SUDO_UID:-$(id -u)}}"
INVOKING_GID="${INVOKING_GID:-${SUDO_GID:-$(id -g)}}"

IMAGE_TAG="${IMAGE_TAG:-safeclaw-hermes-agent:local}"
BOX_NAME="${BOX_NAME:-safeclaw-hermes}"
HOST_PORT="${HOST_PORT:-8642}"
BOX_DATA_DIR="${BOX_DATA_DIR:-$INVOKING_HOME/.internshannon/hermes-box}"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/hermes-api-server.env}"

if [[ "$(uname -s)" == "Linux" && "$(id -u)" -ne 0 ]]; then
	echo "[safeclaw-hermes] Linux 上 a3s-box run 当前需要 root 权限（内部会用到 mount）。" >&2
	echo "[safeclaw-hermes] 请改用: sudo scripts/hermes/run-hermes-agent-box.sh" >&2
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

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Hermes env file not found: $ENV_FILE" >&2
	echo "Copy scripts/hermes/hermes-api-server.env.example to that path and adjust the API key." >&2
	exit 1
fi

mkdir -p "$BOX_DATA_DIR"

if ! "${A3S_BOX_CMD[@]}" image-inspect "$IMAGE_TAG" >/dev/null 2>&1; then
	echo "[safeclaw-hermes] local image not found: $IMAGE_TAG" >&2
	echo "[safeclaw-hermes] 先执行: sudo scripts/hermes/build-hermes-agent-image.sh" >&2
	exit 1
fi

echo "[safeclaw-hermes] starting ${BOX_NAME} on http://127.0.0.1:${HOST_PORT}/v1"
exec "${A3S_BOX_CMD[@]}" run -d \
	--name "$BOX_NAME" \
	-p "${HOST_PORT}:8642" \
	-v "${BOX_DATA_DIR}:/opt/data" \
	-e "HERMES_UID=${INVOKING_UID}" \
	-e "HERMES_GID=${INVOKING_GID}" \
	--env-file "$ENV_FILE" \
	"$IMAGE_TAG" \
	-- gateway
