#!/usr/bin/env bash
# safeclaw-post-build.sh - Cross-platform post-build processing for SafeClaw
#
# This script should be called after `pnpm tauri build` completes.
# It handles platform-specific tasks like:
#   - macOS: Patch libkrun install names, create symlinks, code sign
#   - Linux: Create version symlinks, patch rpath
#   - Windows: Ensure DLLs are in correct location
#
# Usage:
#   ./safeclaw-post-build.sh [bundle_path]
#
# Environment variables:
#   SAFECLAW_APP_NAME          - App display name (default: internShannon)
#   SAFECLAW_EXECUTABLE_NAME   - Executable name (default: same as app name)
#   LIBKRUN_VERSION            - libkrun version (default: 1.17.0)

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load common functions
# shellcheck source=platform/common.sh
source "${SCRIPT_DIR}/platform/common.sh"

# Detect current platform
detect_platform

# Usage function
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [BUNDLE_PATH]

Post-process SafeClaw bundle after build.

Arguments:
  BUNDLE_PATH    Path to the bundle (optional, auto-detected if not provided)

Options:
  --app-name NAME         Set app display name (default: internShannon)
  --exec-name NAME        Set executable name (default: same as app name)
  --libkrun-version VER   Set libkrun version (default: 1.17.0)
  --skip-verify           Skip verification steps
  -h, --help              Show this help message

Examples:
  $(basename "$0")                                    # Auto-detect bundle
  $(basename "$0") /path/to/internShannon.app                  # macOS app bundle
  $(basename "$0") ./target/release/bundle/appimage/*.AppImage

EOF
}

# Parse arguments
BUNDLE_PATH=""
SKIP_VERIFY="${SAFECLAW_SKIP_VERIFY:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-name)
      APP_NAME="$2"
      shift 2
      ;;
    --exec-name)
      EXECUTABLE_NAME="$2"
      shift 2
      ;;
    --libkrun-version)
      LIBKRUN_VERSION="$2"
      shift 2
      ;;
    --skip-verify)
      SKIP_VERIFY="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      BUNDLE_PATH="$1"
      shift
      ;;
  esac
done

# Auto-detect bundle path if not provided
if [[ -z "$BUNDLE_PATH" ]]; then
  log_info "No bundle path provided, auto-detecting..."
  BUNDLE_PATH="$(find_bundle_path)"

  if [[ ! -e "$BUNDLE_PATH" ]]; then
    # Try to find it relative to typical locations
    for try_path in \
      "src-tauri/target/release/bundle/macos/${APP_NAME}.app" \
      "src-tauri/target/release/bundle/appimage/${APP_NAME}"*.AppImage \
      "src-tauri/target/release/bundle/nsis/${APP_NAME}"*.exe \
      "src-tauri/target/release/bundle/msi/${APP_NAME}"*.msi \
      "src-tauri/target/release/${APP_NAME}"*.exe; do
      if [[ -e "$try_path" ]]; then
        BUNDLE_PATH="$try_path"
        break
      fi
    done
  fi
fi

if [[ ! -e "$BUNDLE_PATH" ]]; then
  log_error "Bundle not found. Please provide the bundle path or run from the app directory after building."
  echo ""
  usage
  exit 1
fi

log_info "========================================"
log_info "SafeClaw Post-Build Processing"
log_info "========================================"
log_info "Platform:     $PLATFORM"
log_info "App name:     $APP_NAME"
log_info "Bundle:       $BUNDLE_PATH"
log_info "libkrun ver:  $LIBKRUN_VERSION"
log_info "========================================"

# Call the appropriate platform-specific script
case "$PLATFORM" in
  macos)
    log_info "Loading macOS post-processing..."
    # shellcheck source=platform/macos.sh
    source "${SCRIPT_DIR}/platform/macos.sh"
    post_process_macos "$BUNDLE_PATH"
    ;;

  linux)
    log_info "Loading Linux post-processing..."
    # shellcheck source=platform/linux.sh
    source "${SCRIPT_DIR}/platform/linux.sh"
    post_process_linux "$BUNDLE_PATH"
    ;;

  windows)
    log_info "Loading Windows post-processing..."
    # shellcheck source=platform/windows.sh
    source "${SCRIPT_DIR}/platform/windows.sh"
    post_process_windows "$BUNDLE_PATH"
    ;;

  *)
    log_error "Unsupported platform: $PLATFORM"
    exit 1
    ;;
esac

log_info "========================================"
log_success "Post-build processing complete!"
log_info "========================================"
