#!/usr/bin/env bash
# common.sh - Shared functions for SafeClaw cross-platform packaging
# This file should be sourced, not executed directly

set -euo pipefail

# =============================================================================
# Platform Detection
# =============================================================================

detect_platform() {
  case "$(uname -s)" in
    Darwin)
      PLATFORM="macos"
      ;;
    Linux)
      PLATFORM="linux"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      PLATFORM="windows"
      ;;
    *)
      echo "[ERROR] Unsupported platform: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

# =============================================================================
# Configuration
# =============================================================================

# App names (can be overridden via environment)
APP_NAME="${SAFECLAW_APP_NAME:-书安}"
EXECUTABLE_NAME="${SAFECLAW_EXECUTABLE_NAME:-$APP_NAME}"

# libkrun version
LIBKRUN_VERSION="${LIBKRUN_VERSION:-1.17.0}"

# =============================================================================
# Logging
# =============================================================================

log_info() {
  echo "[INFO] $*"
}

log_warn() {
  echo "[WARN] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
  exit 1
}

log_success() {
  echo "[SUCCESS] $*"
}

log_step() {
  echo "[STEP] $*..."
}

# =============================================================================
# Directory Finding
# =============================================================================

# Find the app bundle/directory based on platform
find_bundle_path() {
  local target_dir="${CARGO_TARGET_DIR:-${APP_DIR:-$(pwd)}/src-tauri/target}"

  case "$PLATFORM" in
    macos)
      echo "$target_dir/release/bundle/macos/${APP_NAME}.app"
      ;;
    windows)
      # Windows can have nsis or msi
      local nsis_path="$target_dir/release/bundle/nsis/${APP_NAME}"*.exe
      local msi_path="$target_dir/release/bundle/msi/${APP_NAME}"*.msi
      if [[ -e "$nsis_path" ]]; then
        echo "$nsis_path"
      elif [[ -e "$msi_path" ]]; then
        echo "$msi_path"
      else
        echo "$nsis_path"  # Return pattern even if not found
      fi
      ;;
    linux)
      # Linux can have AppImage, deb, or rpm
      local appimage_path="$target_dir/release/bundle/appimage/${APP_NAME}"*.AppImage
      local deb_path="$target_dir/release/bundle/deb/${APP_NAME}"*.deb
      local rpm_path="$target_dir/release/bundle/rpm/${APP_NAME}"*.rpm
      if [[ -e "$appimage_path" ]]; then
        echo "$appimage_path"
      elif [[ -e "$deb_path" ]]; then
        echo "$deb_path"
      elif [[ -e "$rpm_path" ]]; then
        echo "$rpm_path"
      else
        echo "$appimage_path"
      fi
      ;;
  esac
}

# Find the executable path inside bundle
find_executable_path() {
  local bundle_path="$1"
  case "$PLATFORM" in
    macos)
      echo "$bundle_path/Contents/MacOS/${EXECUTABLE_NAME}"
      ;;
    windows)
      echo "$bundle_path"  # For NSIS, the exe IS the bundle
      ;;
    linux)
      # For AppImage, it's the AppImage itself; for deb/rpm, find the actual binary
      if [[ "$bundle_path" == *.AppImage ]]; then
        echo "$bundle_path"
      else
        # For deb/rpm, the executable is typically in /usr/bin/
        echo "/usr/bin/${APP_NAME}"
      fi
      ;;
  esac
}

# Find the lib directory inside bundle
find_lib_dir() {
  local bundle_path="$1"
  case "$PLATFORM" in
    macos)
      echo "$bundle_path/Contents/Resources/box/lib"
      ;;
    windows)
      local dir="$(dirname "$bundle_path")"
      echo "$dir/box/lib"
      ;;
    linux)
      if [[ "$bundle_path" == *.AppImage ]]; then
        # AppImage extracts to squashfs, libs are inside
        echo "$(dirname "$bundle_path")/. squashfs-root/usr/lib"
      else
        echo "/usr/lib"
      fi
      ;;
  esac
}

# =============================================================================
# File Operations
# =============================================================================

# Check if a file exists and has non-zero size
file_exists_and_not_empty() {
  [[ -f "$1" ]] && [[ -s "$1" ]]
}

# Get file size in bytes
file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

# =============================================================================
# Command Existence Check
# =============================================================================

require_cmd() {
  local cmd="$1"
  local name="${2:-$cmd}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Required command not found: $name"
  fi
}

# =============================================================================
# libkrun Version Constants (by platform)
# =============================================================================

# Get libkrun filenames for current platform
get_libkrun_names() {
  case "$PLATFORM" in
    macos)
      echo "libkrun.${LIBKRUN_VERSION}.dylib libkrun.1.dylib libkrun.dylib"
      ;;
    windows)
      echo "libkrun.dll"
      ;;
    linux)
      echo "libkrun.so.${LIBKRUN_VERSION} libkrun.so.1 libkrun.so"
      ;;
  esac
}

# Get libkrunfw filenames for current platform
get_libkrunfw_names() {
  case "$PLATFORM" in
    macos)
      echo "libkrunfw.5.dylib libkrunfw.dylib"
      ;;
    windows)
      echo "libkrunfw.dll"
      ;;
    linux)
      echo "libkrunfw.so.5 libkrunfw.so"
      ;;
  esac
}

# =============================================================================
# Bundle Verification
# =============================================================================

verify_bundle_exists() {
  local bundle_path="$1"
  if [[ ! -e "$bundle_path" ]]; then
    log_error "Bundle not found: $bundle_path"
  fi
  log_info "Bundle found: $bundle_path"
}

verify_libkrun_in_bundle() {
  local lib_dir="$1"
  local found=0
  local missing=""

  for name in $(get_libkrun_names); do
    if [[ -f "$lib_dir/$name" ]]; then
      log_info "  Found: $name"
      found=1
    else
      log_warn "  Missing: $name"
      missing="$missing $name"
    fi
  done

  if [[ "$found" -eq 0 ]]; then
    log_error "No libkrun libraries found in $lib_dir"
  fi

  return 0
}
