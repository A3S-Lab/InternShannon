#!/usr/bin/env bash

# Safely inspect or stop local InternShannon listeners before a deployment.
# This file is also sourced by its regression test; keep side effects in main.

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_WORKSPACE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
WORKSPACE_ROOT=${WORKSPACE_ROOT:-$DEFAULT_WORKSPACE_ROOT}

print_process_details() {
  local pid="$1"
  local executable command cwd
  executable=$(ps -o comm= -p "$pid" 2>/dev/null | head -1)
  command=$(ps -o command= -p "$pid" 2>/dev/null | head -1)
  cwd=$(process_cwd "$pid")

  echo "   PID:        $pid" >&2
  echo "   executable: ${executable:-<unavailable>}" >&2
  echo "   command:    ${command:-<unavailable>}" >&2
  echo "   cwd:        ${cwd:-<unavailable>}" >&2
}

decode_lsof_path() {
  # macOS lsof escapes non-ASCII path bytes as \xHH even in machine output.
  # printf %b restores the real cwd used for exact workspace containment checks.
  printf '%b' "$1"
}

process_cwd() {
  local pid="$1"
  local encoded
  encoded=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  decode_lsof_path "$encoded"
}

path_is_within() {
  local path="$1"
  local root="$2"
  case "$path/" in
    "$root/"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Pure identity predicate used by the live PID check and regression tests.
matches_internshannon_identity() {
  local role="$1"
  local executable="$2"
  local command="$3"
  local cwd="$4"
  local workspace_root="$5"

  # Packaged desktop children are identifiable by their signed app bundle path.
  if [[ "$executable $command $cwd" == *"/InternShannon.app/"* ]]; then
    return 0
  fi

  case "$role" in
    sidecar)
      path_is_within "$cwd" "$workspace_root/apps/sidecar" || return 1
      [[ "$executable $command" =~ (^|[[:space:]/])(node|nodejs)([[:space:]]|$) ]] || return 1
      [[ "$command" =~ (dist/main(\.js)?|src/main(\.ts)?|nest[[:space:]]+start) ]] || return 1
      ;;
    preview)
      path_is_within "$cwd" "$workspace_root/apps/web" || return 1
      [[ "$executable $command" =~ (^|[[:space:]/])rsbuild-node([[:space:]]|$) ]] \
        || [[ "$command" =~ rsbuild[[:space:]]+preview ]] \
        || return 1
      ;;
    *)
      return 1
      ;;
  esac
}

assert_internshannon_process() {
  local pid="$1"
  local role="$2"
  local executable command cwd

  if ! kill -0 "$pid" 2>/dev/null; then
    return 2
  fi

  executable=$(ps -o comm= -p "$pid" 2>/dev/null | head -1)
  command=$(ps -o command= -p "$pid" 2>/dev/null | head -1)
  cwd=$(process_cwd "$pid")

  if matches_internshannon_identity "$role" "$executable" "$command" "$cwd" "$WORKSPACE_ROOT"; then
    return 0
  fi

  echo "ERROR: refusing to signal an unrecognized process for $role." >&2
  print_process_details "$pid"
  return 1
}

listener_pids() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u
}

role_for_port() {
  case "$1" in
    29653|29654) echo sidecar ;;
    5000) echo preview ;;
    *) return 1 ;;
  esac
}

# Validate every listener before signaling any of them. This prevents a mixed
# port (for example ControlCenter plus rsbuild on 5000) from being half-killed.
validate_listeners() {
  local port role pids pid rc
  for port in "$@"; do
    role=$(role_for_port "$port") || {
      echo "ERROR: unsupported managed port: $port" >&2
      return 1
    }
    pids=$(listener_pids "$port")
    for pid in $pids; do
      assert_internshannon_process "$pid" "$role"
      rc=$?
      if [ "$rc" -eq 1 ]; then
        echo "ERROR: port $port has an unrelated listener; no processes were signaled." >&2
        return 1
      fi
    done
  done
}

signal_listeners() {
  local signal="$1"
  shift
  local port role pids pid

  validate_listeners "$@" || return 1
  for port in "$@"; do
    role=$(role_for_port "$port")
    pids=$(listener_pids "$port")
    if [ -z "$pids" ]; then
      echo "OK: port $port is free"
      continue
    fi
    for pid in $pids; do
      # The process may exit between validation and signaling.
      if kill -0 "$pid" 2>/dev/null; then
        echo "Sending SIG$signal to verified $role PID $pid on port $port"
        kill -"$signal" "$pid"
      fi
    done
  done
}

check_ports() {
  local port role pids pid failed=0
  for port in "$@"; do
    role=$(role_for_port "$port") || return 1
    pids=$(listener_pids "$port")
    if [ -z "$pids" ]; then
      echo "OK: port $port is free"
      continue
    fi
    failed=1
    echo "BUSY: port $port ($role)" >&2
    for pid in $pids; do
      print_process_details "$pid"
    done
  done
  return "$failed"
}

stop_ports() {
  signal_listeners TERM "$@" || return 1
  sleep 2

  local remaining=() port
  for port in "$@"; do
    if [ -n "$(listener_pids "$port")" ]; then
      remaining+=("$port")
    fi
  done

  if [ "${#remaining[@]}" -gt 0 ]; then
    echo "Listeners remain after SIGTERM; revalidating before SIGKILL." >&2
    signal_listeners KILL "${remaining[@]}" || return 1
    sleep 1
  fi

  check_ports "$@"
}

usage() {
  cat <<'EOF'
Usage: scripts/predeploy-check.sh check [PORT ...]
       scripts/predeploy-check.sh stop  [PORT ...]

Managed ports default to 29653 and 5000. Unknown processes are never signaled.
EOF
}

main() {
  local action=${1:-check}
  if [ "$#" -gt 0 ]; then shift; fi
  local ports=("$@")
  if [ "${#ports[@]}" -eq 0 ]; then
    ports=(29653 5000)
  fi

  case "$action" in
    check) check_ports "${ports[@]}" ;;
    stop) stop_ports "${ports[@]}" ;;
    *) usage >&2; return 2 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
