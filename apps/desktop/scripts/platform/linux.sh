#!/usr/bin/env bash
# linux.sh - Linux-specific post-build processing for SafeClaw bundle
# This file should be sourced from the main release script

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

# =============================================================================
# Linux-specific libkrun constants
# =============================================================================

LIBKRUN_VERSIONED="libkrun.so.${LIBKRUN_VERSION}"
LIBKRUN_MAJOR="libkrun.so.1"
LIBKRUN_UNVERSIONED="libkrun.so"
LIBKRUNFW_VERSIONED="libkrunfw.so.5"
LIBKRUNFW_UNVERSIONED="libkrunfw.so"

# =============================================================================
# Linux Post-Processing Entry Point
# =============================================================================

post_process_linux() {
  local bundle_path="${1:-$(find_bundle_path)}"
  local lib_dir
  local exec_path

  log_step "Post-processing Linux bundle"
  verify_bundle_exists "$bundle_path"

  # Determine lib directory based on bundle type
  if [[ "$bundle_path" == *.AppImage ]]; then
    process_appimage "$bundle_path"
  elif [[ "$bundle_path" == *.deb ]]; then
    process_deb "$bundle_path"
  elif [[ "$bundle_path" == *.rpm ]]; then
    process_rpm "$bundle_path"
  else
    log_error "Unknown Linux bundle type: $bundle_path"
  fi

  log_success "Linux bundle post-processing complete"
}

# =============================================================================
# AppImage Processing
# =============================================================================

process_appimage() {
  local appimage_path="$1"
  local extract_dir="${appimage_path}.extracted"
  local lib_dir="$extract_dir/squashfs-root/usr/lib"

  log_info "Processing AppImage: $appimage_path"

  # Check if patchelf is available
  require_cmd "patchelf" "patchelf"

  # Extract AppImage if not already extracted
  if [[ ! -d "$extract_dir" ]]; then
    log_info "Extracting AppImage..."
    "$appimage_path" --appimage-extract >/dev/null 2>&1 || {
      log_error "Failed to extract AppImage"
    }
  fi

  if [[ -d "$lib_dir" ]]; then
    # Create version symlinks
    log_info "Creating version symlinks..."
    create_linux_version_symlinks "$lib_dir"

    # Find and patch the executable inside
    local exec_in_appimage="$extract_dir/squashfs-root/AppRun"
    if [[ -f "$exec_in_appimage" ]]; then
      log_info "Patching rpath in AppRun..."
      patch_linux_rpath "$exec_in_appimage" "$lib_dir"
    fi

    # Also patch any libraries that may have hardcoded paths
    patch_linux_library_paths "$lib_dir"
  else
    log_warn "lib directory not found in extracted AppImage: $lib_dir"
  fi

  # Repack AppImage (optional, depends on use case)
  # log_info "Repacking AppImage is not implemented - extraction is for inspection only"
}

# =============================================================================
# Debian Package Processing
# =============================================================================

process_deb() {
  local deb_path="$1"
  local extract_dir="${deb_path}.extracted"

  log_info "Processing Debian package: $deb_path"

  # Extract deb package
  if [[ ! -d "$extract_dir" ]]; then
    log_info "Extracting Debian package..."
    mkdir -p "$extract_dir"
    dpkg-deb -x "$deb_path" "$extract_dir" || {
      log_error "Failed to extract Debian package"
    }
  fi

  local lib_dir="$extract_dir/usr/lib"
  if [[ -d "$lib_dir" ]]; then
    log_info "Creating version symlinks..."
    create_linux_version_symlinks "$lib_dir"

    # Find and patch the executable
    local exec_path="$extract_dir/usr/bin/${APP_NAME}"
    if [[ -f "$exec_path" ]]; then
      log_info "Patching rpath..."
      patch_linux_rpath "$exec_path" "$lib_dir"
    fi
  fi
}

# =============================================================================
# RPM Package Processing
# =============================================================================

process_rpm() {
  local rpm_path="$1"
  local extract_dir="${rpm_path}.extracted"

  log_info "Processing RPM package: $rpm_path"

  # Extract rpm package
  if [[ ! -d "$extract_dir" ]]; then
    log_info "Extracting RPM package..."
    mkdir -p "$extract_dir"
    rpm2cpio "$rpm_path" | cpio -idm -D "$extract_dir" >/dev/null 2>&1 || {
      log_error "Failed to extract RPM package"
    }
  fi

  local lib_dir="$extract_dir/usr/lib"
  if [[ -d "$lib_dir" ]]; then
    log_info "Creating version symlinks..."
    create_linux_version_symlinks "$lib_dir"

    # Find and patch the executable
    local exec_path="$extract_dir/usr/bin/${APP_NAME}"
    if [[ -f "$exec_path" ]]; then
      log_info "Patching rpath..."
      patch_linux_rpath "$exec_path" "$lib_dir"
    fi
  fi
}

# =============================================================================
# Create Version Symlinks
# =============================================================================

create_linux_version_symlinks() {
  local lib_dir="$1"

  # libkrun.so -> libkrun.so.1
  if [[ ! -e "$lib_dir/$LIBKRUN_MAJOR" ]] && [[ -e "$lib_dir/$LIBKRUN_UNVERSIONED" ]]; then
    ln -sf "$LIBKRUN_UNVERSIONED" "$lib_dir/$LIBKRUN_MAJOR"
    log_info "  Created symlink: $LIBKRUN_MAJOR -> $LIBKRUN_UNVERSIONED"
  fi

  # libkrun.so.1 -> libkrun.so.1.17.0
  if [[ ! -e "$lib_dir/$LIBKRUN_VERSIONED" ]] && [[ -e "$lib_dir/$LIBKRUN_MAJOR" ]]; then
    ln -sf "$LIBKRUN_MAJOR" "$lib_dir/$LIBKRUN_VERSIONED"
    log_info "  Created symlink: $LIBKRUN_VERSIONED -> $LIBKRUN_MAJOR"
  fi

  # libkrunfw.so -> libkrunfw.so.5
  if [[ ! -e "$lib_dir/$LIBKRUNFW_UNVERSIONED" ]] && [[ -e "$lib_dir/$LIBKRUNFW_VERSIONED" ]]; then
    ln -sf "$LIBKRUNFW_VERSIONED" "$lib_dir/$LIBKRUNFW_UNVERSIONED"
    log_info "  Created symlink: $LIBKRUNFW_UNVERSIONED -> $LIBKRUNFW_VERSIONED"
  fi
}

# =============================================================================
# Patch rpath using patchelf
# =============================================================================

patch_linux_rpath() {
  local binary="$1"
  local lib_dir="$2"

  if ! command -v patchelf >/dev/null 2>&1; then
    log_warn "patchelf not available, skipping rpath patch"
    return 0
  fi

  # Set rpath to $ORIGIN/../lib so the binary finds libs next to it
  patchelf --set-rpath '$ORIGIN/../lib' "$binary" 2>/dev/null || {
    log_warn "Failed to patch rpath for $binary"
    return 1
  }

  log_info "  Patched rpath: $binary"
}

# =============================================================================
# Patch library paths
# =============================================================================

patch_linux_library_paths() {
  local lib_dir="$1"

  if ! command -v patchelf >/dev/null 2>&1; then
    return 0
  fi

  # For each libkrun library, ensure it can be found
  for lib in "$lib_dir"/libkrun*.so*; do
    [[ -e "$lib" ]] || continue
    [[ -L "$lib" ]] && continue  # Skip symlinks

    # The SONAME is already embedded, we mainly need to ensure the rpath is correct
    log_info "  Checking: $(basename "$lib")"
  done
}

# =============================================================================
# Entry Point (when executed directly, not sourced)
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  detect_platform
  if [[ "$PLATFORM" != "linux" ]]; then
    log_error "This script is for Linux only, detected platform: $PLATFORM"
  fi

  if [[ $# -lt 1 ]]; then
    BUNDLE_PATH="$(find_bundle_path)"
  else
    BUNDLE_PATH="$1"
  fi

  post_process_linux "$BUNDLE_PATH"
fi
