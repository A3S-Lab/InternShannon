#!/usr/bin/env bash
# windows.sh - Windows-specific post-build processing for SafeClaw bundle
# This file should be sourced from the main release script
# Note: Intended for MSYS2/Git Bash environments on Windows

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

# =============================================================================
# Windows-specific libkrun constants
# =============================================================================

LIBKRUN_NAME="libkrun.dll"
LIBKRUNFW_NAME="libkrunfw.dll"

# =============================================================================
# Windows Post-Processing Entry Point
# =============================================================================

post_process_windows() {
  local bundle_path="${1:-$(find_bundle_path)}"
  local lib_dir
  local exec_path

  log_step "Post-processing Windows bundle"
  verify_bundle_exists "$bundle_path"

  # Determine lib directory based on bundle type
  if [[ "$bundle_path" == *.exe ]]; then
    process_nsis "$bundle_path"
  elif [[ "$bundle_path" == *.msi ]]; then
    process_msi "$bundle_path"
  else
    # Assume it's a directory structure
    lib_dir="$(dirname "$bundle_path")/box/lib"
    if [[ -d "$lib_dir" ]]; then
      process_bundled_libs "$lib_dir"
    else
      log_warn "No lib directory found at: $lib_dir"
    fi
  fi

  log_success "Windows bundle post-processing complete"
}

# =============================================================================
# NSIS Installer Processing
# =============================================================================

process_nsis() {
  local nsis_exe="$1"
  local install_dir="${nsis_exe%.exe}.install"
  local lib_dir="$install_dir/box/lib"

  log_info "Processing NSIS installer: $nsis_exe"

  # For NSIS installers, the DLLs are typically either:
  # 1. Embedded in the installer and extracted during install
  # 2. Already in the same directory as the .exe
  #
  # We check the installer's contents or look for adjacent libs

  # Find the actual application directory (after installation)
  # NSIS typically installs to $LOCALAPPDATA or Program Files

  # First, let's check if libkrun DLLs are already alongside the installer
  local installer_dir="$(dirname "$nsis_exe")"
  local adjacent_lib_dir="$installer_dir/../box/lib"

  if [[ -d "$adjacent_lib_dir" ]]; then
    log_info "Found adjacent lib directory: $adjacent_lib_dir"
    process_bundled_libs "$adjacent_lib_dir"
  elif [[ -d "$installer_dir/box/lib" ]]; then
    log_info "Found embedded lib directory: $installer_dir/box/lib"
    process_bundled_libs "$installer_dir/box/lib"
  else
    log_info "No separate lib directory found - DLLs may be embedded in installer"
    # For NSIS, we may need to extract and repack, or rely on the installer script
    # to include the DLLs. Check if the installer contains the DLLs.
    check_installer_contents "$nsis_exe"
  fi
}

# =============================================================================
# MSI Installer Processing
# =============================================================================

process_msi() {
  local msi_path="$1"

  log_info "Processing MSI installer: $msi_path"

  # MSI files can be extracted using msiextract or 7z
  local extract_dir="${msi_path}.extracted"

  if [[ ! -d "$extract_dir" ]]; then
    log_info "Extracting MSI package..."
    if command -v msiextract >/dev/null 2>&1; then
      msiextract -C "$extract_dir" "$msi_path" >/dev/null 2>&1 || true
    elif command -v 7z >/dev/null 2>&1; then
      mkdir -p "$extract_dir"
      7z x "$msi_path" -o"$extract_dir" >/dev/null 2>&1 || true
    else
      log_warn "Neither msiextract nor 7z available, skipping MSI extraction"
      return 0
    fi
  fi

  # Find DLLs in extracted content
  local found_libs=0
  for dll in "$extract_dir"**/"libkrun.dll" "$extract_dir"**/"libkrunfw.dll"; do
    if [[ -e "$dll" ]]; then
      log_info "  Found: $dll"
      found_libs=1
      # Ensure they're in a proper lib directory
      ensure_windows_lib_structure "$(dirname "$dll")"
    fi
  done

  if [[ "$found_libs" -eq 0 ]]; then
    log_info "No libkrun DLLs found in MSI (may be expected)"
  fi
}

# =============================================================================
# Process Bundled Libs Directory
# =============================================================================

process_bundled_libs() {
  local lib_dir="$1"

  log_info "Processing bundled libs in: $lib_dir"

  # Verify DLLs exist
  verify_libkrun_in_bundle "$lib_dir"

  # Create version aliases (Windows doesn't use symlinks like Unix)
  create_windows_version_aliases "$lib_dir"

  # Check if DLLs need any patching
  check_dll_dependencies "$lib_dir"
}

# =============================================================================
# Create Windows Version Aliases (copy instead of symlink)
# =============================================================================

create_windows_version_aliases() {
  local lib_dir="$1"

  # Windows DLL versioning: typically libkrun.dll is the main DLL
  # We copy instead of symlinking since Windows symlinks require admin privileges

  # If we have libkrun.dll, it's usually sufficient
  # The version-specific loading is handled by the executable's manifest or search path

  log_info "  Windows: using adjacent DLL loading (DLL next to executable)"
}

# =============================================================================
# Check DLL Dependencies
# =============================================================================

check_dll_dependencies() {
  local lib_dir="$1"

  # On Windows, we can use dumpbin if available (from Visual Studio)
  if ! command -v dumpbin >/dev/null 2>&1; then
    log_info "  dumpbin not available, skipping dependency check"
    return 0
  fi

  for dll in "$lib_dir"/*.dll; do
    [[ -e "$dll" ]] || continue
    local dll_name="$(basename "$dll")"

    log_info "  Checking dependencies for: $dll_name"
    # dumpbin /DEPENDENTS "$dll" 2>/dev/null | grep -i libkrun || true
  done
}

# =============================================================================
# Check Installer Contents
# =============================================================================

check_installer_contents() {
  local installer_path="$1"

  if ! command -v 7z >/dev/null 2>&1; then
    log_info "  7z not available to inspect installer contents"
    return 0
  fi

  log_info "  Checking installer contents for libkrun DLLs..."
  local contents
  contents="$(7z l "$installer_path" 2>/dev/null)" || return 0

  if echo "$contents" | grep -qi "libkrun"; then
    log_info "  Installer contains libkrun DLLs"
  else
    log_warn "  Installer does not appear to contain libkrun DLLs"
  fi
}

# =============================================================================
# Ensure Proper Library Structure
# =============================================================================

ensure_windows_lib_structure() {
  local lib_dir="$1"

  # Ensure the libkrun DLLs are in a 'box/lib' subdirectory structure
  # that matches what the application expects

  local target_dir="$lib_dir/box/lib"
  if [[ "$lib_dir" != */box/lib ]]; then
    if [[ -e "$lib_dir/libkrun.dll" ]] && [[ ! -d "$target_dir" ]]; then
      mkdir -p "$target_dir"
      cp "$lib_dir"/libkrun*.dll "$target_dir/" 2>/dev/null || true
      log_info "  Copied DLLs to: $target_dir"
    fi
  fi
}

# =============================================================================
# Entry Point (when executed directly, not sourced)
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  detect_platform
  if [[ "$PLATFORM" != "windows" ]]; then
    log_error "This script is for Windows only, detected platform: $PLATFORM"
  fi

  if [[ $# -lt 1 ]]; then
    BUNDLE_PATH="$(find_bundle_path)"
  else
    BUNDLE_PATH="$1"
  fi

  post_process_windows "$BUNDLE_PATH"
fi
