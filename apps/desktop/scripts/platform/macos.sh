#!/usr/bin/env bash
# macos.sh - macOS-specific post-build processing for SafeClaw bundle
# This file should be sourced from the main release script

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

# =============================================================================
# macOS-specific libkrun constants
# =============================================================================

LIBKRUN_VERSIONED="libkrun.${LIBKRUN_VERSION}.dylib"
LIBKRUN_MAJOR="libkrun.1.dylib"
LIBKRUN_UNVERSIONED="libkrun.dylib"
LIBKRUNFW_VERSIONED="libkrunfw.5.dylib"
LIBKRUNFW_UNVERSIONED="libkrunfw.dylib"

# The expected install name in the bundled dylib
BUNDLED_LIB_PREFIX="@executable_path/../Resources/box/lib/"

# =============================================================================
# macOS Post-Processing Entry Point
# =============================================================================

post_process_macos() {
  local bundle_path="${1:-$(find_bundle_path)}"
  local exec_path="$bundle_path/Contents/MacOS/${EXECUTABLE_NAME}"
  local lib_dir="$bundle_path/Contents/Resources/box/lib"

  log_step "Post-processing macOS bundle"
  verify_bundle_exists "$bundle_path"

  require_cmd "install_name_tool" "install_name_tool (Xcode)"
  require_cmd "otool" "otool (Xcode)"
  require_cmd "codesign" "codesign (Xcode)"

  # Step 1: Verify libkrun libraries exist
  log_info "Checking bundled libkrun libraries..."
  verify_libkrun_in_bundle "$lib_dir"

  # Step 2: Create version symlinks (libkrun.1.dylib -> libkrun.dylib, etc.)
  log_info "Creating version symlinks..."
  create_macos_version_symlinks "$lib_dir"

  # Step 3: Patch dylib install names to use @executable_path relative path
  log_info "Patching dylib install names..."
  patch_all_dylib_install_names "$lib_dir"

  # Step 4: Patch executable's libkrun linkage
  log_info "Patching executable libkrun linkage..."
  patch_executable_libkrun_linkage "$exec_path"

  # Step 5: Code sign the bundle
  log_info "Code signing bundle..."
  codesign_macos_bundle "$bundle_path"

  # Step 6: Verify the patch worked
  log_info "Verifying bundle..."
  verify_macos_bundle "$exec_path"

  log_success "macOS bundle post-processing complete"
}

# =============================================================================
# Step 1: Create Version Symlinks
# =============================================================================

create_macos_version_symlinks() {
  local lib_dir="$1"

  # libkrun.1.dylib -> libkrun.dylib (if libkrun.dylib exists but libkrun.1.dylib doesn't)
  if [[ ! -e "$lib_dir/$LIBKRUN_MAJOR" ]] && [[ -e "$lib_dir/$LIBKRUN_UNVERSIONED" ]]; then
    ln -sf "$LIBKRUN_UNVERSIONED" "$lib_dir/$LIBKRUN_MAJOR"
    log_info "  Created symlink: $LIBKRUN_MAJOR -> $LIBKRUN_UNVERSIONED"
  fi

  # libkrun.1.17.0.dylib -> libkrun.1.dylib (if libkrun.1.dylib exists but libkrun.1.17.0.dylib doesn't)
  if [[ ! -e "$lib_dir/$LIBKRUN_VERSIONED" ]] && [[ -e "$lib_dir/$LIBKRUN_MAJOR" ]]; then
    ln -sf "$LIBKRUN_MAJOR" "$lib_dir/$LIBKRUN_VERSIONED"
    log_info "  Created symlink: $LIBKRUN_VERSIONED -> $LIBKRUN_MAJOR"
  fi

  # libkrunfw.dylib -> libkrunfw.5.dylib (if libkrunfw.5.dylib exists but libkrunfw.dylib doesn't)
  if [[ ! -e "$lib_dir/$LIBKRUNFW_UNVERSIONED" ]] && [[ -e "$lib_dir/$LIBKRUNFW_VERSIONED" ]]; then
    ln -sf "$LIBKRUNFW_VERSIONED" "$lib_dir/$LIBKRUNFW_UNVERSIONED"
    log_info "  Created symlink: $LIBKRUNFW_UNVERSIONED -> $LIBKRUNFW_VERSIONED"
  fi
}

# =============================================================================
# Step 2: Patch Dylib Install Names
# =============================================================================

patch_all_dylib_install_names() {
  local lib_dir="$1"

  for dylib_path in "$lib_dir"/*.dylib; do
    [[ -e "$dylib_path" ]] || continue
    patch_dylib_install_name "$dylib_path"
  done
}

patch_dylib_install_name() {
  local dylib_path="$1"
  local dylib_name="$(basename "$dylib_path")"
  local expected_id="${BUNDLED_LIB_PREFIX}${dylib_name}"

  # Get current install name
  local current_id
  current_id="$(otool -D "$dylib_path" 2>/dev/null | sed -n '2p')" || return 0

  if [[ "$current_id" == "$expected_id" ]]; then
    log_info "  Already patched: $dylib_name"
    return 0
  fi

  if [[ "$current_id" == *"@executable_path"* ]]; then
    # Already has @executable_path, just needs path correction
    log_info "  Patching install name: $dylib_name ($current_id -> $expected_id)"
    install_name_tool -id "$expected_id" "$dylib_path" 2>/dev/null || true
  else
    # Has absolute path or no path
    log_info "  Setting install name: $dylib_name -> $expected_id"
    install_name_tool -id "$expected_id" "$dylib_path" 2>/dev/null || true
  fi
}

# =============================================================================
# Step 3: Patch Executable's libkrun Linkage
# =============================================================================

patch_executable_libkrun_linkage() {
  local exec_path="$1"
  local bundled_lib="${BUNDLED_LIB_PREFIX}${LIBKRUN_VERSIONED}"

  # Get current libkrun linkage
  local current_links
  current_links="$(otool -L "$exec_path" 2>/dev/null)" || {
    log_warn "Could not read linkage from $exec_path"
    return 1
  }

  # Check if already patched
  if echo "$current_links" | grep -q "$bundled_lib"; then
    log_info "  Executable already linked to bundled libkrun"
    return 0
  fi

  # Find any libkrun reference in the executable
  # The otool output format is: "    /full/path/libkrun.X.dylib (compatibility version ...)"
  # We need the full path, not just the filename, because install_name_tool -change requires it
  local libkrun_ref
  libkrun_ref="$(echo "$current_links" | grep 'libkrun.*\.dylib' | head -1 | awk '{print $1}')" || {
    log_warn "No libkrun reference found in executable"
    return 1
  }

  log_info "  Patching: $libkrun_ref -> $bundled_lib"
  install_name_tool -change "$libkrun_ref" "$bundled_lib" "$exec_path" || {
    log_error "Failed to patch executable libkrun linkage"
  }
}

# =============================================================================
# Step 4: Code Signing
# =============================================================================

codesign_macos_bundle() {
  local bundle_path="$1"
  local exec_path="$bundle_path/Contents/MacOS/${EXECUTABLE_NAME}"

  # Sign all dylibs first
  for dylib in "$bundle_path/Contents/Resources/box/lib"/*.dylib; do
    [[ -e "$dylib" ]] || continue
    local dylib_name="$(basename "$dylib")"
    log_info "  Signing: $dylib_name"
    codesign --force --sign - "$dylib" 2>/dev/null || true
  done

  # Sign main executable
  log_info "  Signing executable"
  codesign --force --sign - "$exec_path" 2>/dev/null || true

  # Sign app bundle (deep)
  log_info "  Signing app bundle"
  codesign --force --deep --sign - "$bundle_path" 2>/dev/null || true

  # Verify signatures
  log_info "  Verifying signatures..."
  codesign --verify --deep --strict "$bundle_path" 2>/dev/null || {
    log_warn "Signature verification failed (may be expected for unsigned dev builds)"
  }
}

# =============================================================================
# Step 5: Verification
# =============================================================================

verify_macos_bundle() {
  local exec_path="$1"
  local bundled_lib="${BUNDLED_LIB_PREFIX}${LIBKRUN_VERSIONED}"

  local current_links
  current_links="$(otool -L "$exec_path" 2>/dev/null)" || {
    log_warn "Could not verify - otool failed"
    return 0
  }

  if echo "$current_links" | grep -q 'libkrun.*dylib'; then
    local libkrun_ref
    libkrun_ref="$(echo "$current_links" | grep 'libkrun.*dylib' | head -1 | awk '{print $1}')"
    if [[ "$libkrun_ref" == "$bundled_lib" ]]; then
      log_success "Verification passed: executable links to $bundled_lib"
    elif [[ "$libkrun_ref" == *"/opt/homebrew/"* ]]; then
      log_error "Verification failed: executable still links to homebrew path: $libkrun_ref"
    else
      log_warn "Verification: executable links to $libkrun_ref (expected: $bundled_lib)"
    fi
  else
    log_warn "Verification: no libkrun linkage found"
  fi
}

# =============================================================================
# Entry Point (when executed directly, not sourced)
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  detect_platform
  if [[ "$PLATFORM" != "macos" ]]; then
    log_error "This script is for macOS only, detected platform: $PLATFORM"
  fi

  if [[ $# -lt 1 ]]; then
    BUNDLE_PATH="$(find_bundle_path)"
  else
    BUNDLE_PATH="$1"
  fi

  post_process_macos "$BUNDLE_PATH"
fi
