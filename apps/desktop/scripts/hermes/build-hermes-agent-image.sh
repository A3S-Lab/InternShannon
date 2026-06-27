#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOX_WORKSPACE_ROOT="${BOX_WORKSPACE_ROOT:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"
BOX_CARGO_MANIFEST="${BOX_CARGO_MANIFEST:-${BOX_WORKSPACE_ROOT}/Box/src/Cargo.toml}"
LOCAL_BOX_DEBUG_BIN="${LOCAL_BOX_DEBUG_BIN:-${BOX_WORKSPACE_ROOT}/Box/src/target/debug/a3s-box}"
LOCAL_BOX_RELEASE_BIN="${LOCAL_BOX_RELEASE_BIN:-${BOX_WORKSPACE_ROOT}/Box/src/target/release/a3s-box}"
RUNTIME_OVERLAY_DIR="${RUNTIME_OVERLAY_DIR:-${SCRIPT_DIR}/runtime}"
ALLOW_DOCKER_FALLBACK="${ALLOW_DOCKER_FALLBACK:-1}"

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

resolve_a3s_box_cmd() {
	local cargo_bin=""

	if [[ -n "${A3S_BOX_BIN:-}" ]]; then
		A3S_BOX_CMD=("$A3S_BOX_BIN")
	elif command -v a3s-box >/dev/null 2>&1; then
		A3S_BOX_CMD=("a3s-box")
	elif [[ -x "$LOCAL_BOX_DEBUG_BIN" ]]; then
		A3S_BOX_CMD=("$LOCAL_BOX_DEBUG_BIN")
	elif [[ -x "$LOCAL_BOX_RELEASE_BIN" ]]; then
		A3S_BOX_CMD=("$LOCAL_BOX_RELEASE_BIN")
	elif cargo_bin="$(resolve_cargo_bin)" && [[ -f "$BOX_CARGO_MANIFEST" ]]; then
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
}

prepare_build_context() {
	local build_context="$1"

	if [[ ! -d "$RUNTIME_OVERLAY_DIR" ]]; then
		echo "SafeClaw Hermes runtime overlay not found: $RUNTIME_OVERLAY_DIR" >&2
		exit 1
	fi

	mkdir -p "$build_context"
	tar -C "$HERMES_REPO" --exclude='.git' -cf - . | tar -C "$build_context" -xf -

	cp "$RUNTIME_OVERLAY_DIR"/safeclaw_hermes_bootstrap.py "$build_context"/
	cp "$RUNTIME_OVERLAY_DIR"/safeclaw_hermes_patch.py "$build_context"/

	local entrypoint="$build_context/docker/entrypoint.sh"
	if [[ ! -f "$entrypoint" ]]; then
		echo "Expected Hermes entrypoint not found in build context: $entrypoint" >&2
		exit 1
	fi

	perl -0pi -e 's#exec hermes "\\$@"#exec python3 "$INSTALL_DIR/safeclaw_hermes_bootstrap.py" "$@"#g' "$entrypoint"
	if ! grep -Fq 'safeclaw_hermes_bootstrap.py' "$entrypoint"; then
		echo "Failed to inject SafeClaw Hermes bootstrap into $entrypoint" >&2
		exit 1
	fi
	chmod +x "$entrypoint"
}

build_with_a3s_box() {
	local build_context="$1"
	local log_file="$2"

	if "${A3S_BOX_CMD[@]}" build -t "$IMAGE_TAG" "$build_context" 2>&1 | tee "$log_file"; then
		return 0
	fi
	return 1
}

build_with_docker_buildx() {
	local build_context="$1"
	local archive_path="$2"

	if ! command -v docker >/dev/null 2>&1; then
		echo "[safeclaw-hermes] docker not found, cannot use OCI archive fallback." >&2
		return 1
	fi

	echo "[safeclaw-hermes] falling back to docker buildx -> OCI archive -> a3s-box load"
	docker buildx build \
		--progress plain \
		--tag "$IMAGE_TAG" \
		--output "type=oci,dest=$archive_path" \
		"$build_context"

	"${A3S_BOX_CMD[@]}" load -i "$archive_path" -t "$IMAGE_TAG"
}

INVOKING_HOME="${INVOKING_HOME:-$(resolve_invoking_home)}"
HERMES_REPO="${HERMES_REPO:-$INVOKING_HOME/work/project/hermes-agent}"
IMAGE_TAG="${IMAGE_TAG:-safeclaw-hermes-agent:local}"

if [[ "$(uname -s)" == "Linux" && "$(id -u)" -ne 0 ]]; then
	echo "[safeclaw-hermes] Linux 上 a3s-box build 当前需要 root 权限（内部会用到 chroot）。" >&2
	echo "[safeclaw-hermes] 请改用: sudo scripts/hermes/build-hermes-agent-image.sh" >&2
	exit 1
fi

resolve_a3s_box_cmd

if [[ ! -d "$HERMES_REPO" ]]; then
	echo "Hermes repo not found: $HERMES_REPO" >&2
	exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BUILD_CONTEXT="$TMP_DIR/hermes-build-context"
BUILD_LOG="$TMP_DIR/a3s-box-build.log"
OCI_ARCHIVE="$TMP_DIR/safeclaw-hermes.oci.tar"

prepare_build_context "$BUILD_CONTEXT"

echo "[safeclaw-hermes] building OCI image ${IMAGE_TAG} from a temporary SafeClaw-owned overlay context"
echo "[safeclaw-hermes] source repo: ${HERMES_REPO}"

if build_with_a3s_box "$BUILD_CONTEXT" "$BUILD_LOG"; then
	echo "[safeclaw-hermes] a3s-box build completed"
	exit 0
fi

if [[ "$ALLOW_DOCKER_FALLBACK" != "1" ]]; then
	echo "[safeclaw-hermes] a3s-box build failed and docker fallback is disabled." >&2
	exit 1
fi

echo "[safeclaw-hermes] a3s-box build failed; attempting docker buildx fallback"
build_with_docker_buildx "$BUILD_CONTEXT" "$OCI_ARCHIVE"
echo "[safeclaw-hermes] loaded ${IMAGE_TAG} into a3s-box image store via OCI archive fallback"
