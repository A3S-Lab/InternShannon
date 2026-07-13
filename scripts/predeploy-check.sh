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

process_start_token() {
  local pid="$1"
  ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
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

validate_port() {
  local port="$1"
  case "$port" in
    ""|*[!0-9]*) return 1 ;;
  esac
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ]
}

role_for_known_port() {
  local port="$1"
  local sidecar_port="${SIDECAR_PORT:-29653}"
  local preview_port="${PUBLIC_DESKTOP_DEV_PORT:-5000}"

  if [ "$port" = "$sidecar_port" ] || [ "$port" = "29654" ]; then
    echo sidecar
    return 0
  fi
  if [ "$port" = "$preview_port" ]; then
    echo preview
    return 0
  fi
  return 1
}

RESOLVED_TARGETS=()

resolve_targets() {
  RESOLVED_TARGETS=()
  local raw_targets=("$@")
  local token role port existing existing_role existing_port

  if [ "${#raw_targets[@]}" -eq 0 ]; then
    raw_targets=("sidecar:${SIDECAR_PORT:-29653}" "preview:${PUBLIC_DESKTOP_DEV_PORT:-5000}")
  fi

  for token in "${raw_targets[@]}"; do
    if [[ "$token" == *:* ]]; then
      role=${token%%:*}
      port=${token#*:}
      if [ "$role" != "sidecar" ] && [ "$role" != "preview" ]; then
        echo "ERROR: unsupported process role '$role' in target '$token'." >&2
        return 1
      fi
    else
      port=$token
      role=$(role_for_known_port "$port") || {
        echo "ERROR: port $port has no known role; use sidecar:$port or preview:$port." >&2
        return 1
      }
    fi

    if ! validate_port "$port"; then
      echo "ERROR: invalid port '$port' in target '$token'." >&2
      return 1
    fi

    if [ "${#RESOLVED_TARGETS[@]}" -gt 0 ]; then
      for existing in "${RESOLVED_TARGETS[@]}"; do
        existing_role=${existing%%|*}
        existing_port=${existing#*|}
        if [ "$existing_port" = "$port" ] && [ "$existing_role" != "$role" ]; then
          echo "ERROR: port $port cannot be managed as both $existing_role and $role." >&2
          return 1
        fi
        if [ "$existing_port" = "$port" ] && [ "$existing_role" = "$role" ]; then
          role=""
          break
        fi
      done
    fi
    [ -n "$role" ] && RESOLVED_TARGETS+=("$role|$port")
  done
}

pid_set_key() {
  local pids="$1"
  local pid result=""
  for pid in $pids; do
    result="${result}${pid},"
  done
  printf '%s' "$result"
}

pid_is_listener() {
  local port="$1"
  local expected_pid="$2"
  local pid
  for pid in $(listener_pids "$port"); do
    [ "$pid" = "$expected_pid" ] && return 0
  done
  return 1
}

LISTENER_SNAPSHOTS=()
VALIDATED_PROCESSES=()
SIGNALED_PROCESSES=()

capture_listener_snapshot() {
  LISTENER_SNAPSHOTS=()
  VALIDATED_PROCESSES=()
  local target role port pids pid rc start_token

  for target in "${RESOLVED_TARGETS[@]}"; do
    role=${target%%|*}
    port=${target#*|}
    pids=$(listener_pids "$port")
    LISTENER_SNAPSHOTS+=("$role|$port|$(pid_set_key "$pids")")

    for pid in $pids; do
      assert_internshannon_process "$pid" "$role"
      rc=$?
      if [ "$rc" -eq 1 ]; then
        echo "ERROR: port $port has an unrelated listener; no processes were signaled." >&2
        return 1
      fi
      [ "$rc" -eq 2 ] && continue

      start_token=$(process_start_token "$pid")
      if [ -z "$start_token" ]; then
        echo "ERROR: cannot read process start time for PID $pid; no processes were signaled." >&2
        return 1
      fi
      VALIDATED_PROCESSES+=("$role|$port|$pid|$start_token")
    done
  done
}

revalidate_listener_snapshot() {
  local snapshot role remainder port expected_key current_pids current_key pid rc
  local process_record process_role process_port process_pid expected_start current_start

  for snapshot in "${LISTENER_SNAPSHOTS[@]}"; do
    role=${snapshot%%|*}
    remainder=${snapshot#*|}
    port=${remainder%%|*}
    expected_key=${remainder#*|}
    current_pids=$(listener_pids "$port")
    current_key=$(pid_set_key "$current_pids")

    if [ "$current_key" != "$expected_key" ]; then
      echo "ERROR: listeners changed during validation for $role on port $port; no processes were signaled." >&2
      echo "   validated PIDs: ${expected_key:-<none>}" >&2
      echo "   current PIDs:   ${current_key:-<none>}" >&2
      for pid in $current_pids; do
        print_process_details "$pid"
      done
      return 1
    fi
  done

  if [ "${#VALIDATED_PROCESSES[@]}" -gt 0 ]; then
    for process_record in "${VALIDATED_PROCESSES[@]}"; do
      process_role=${process_record%%|*}
      remainder=${process_record#*|}
      process_port=${remainder%%|*}
      remainder=${remainder#*|}
      process_pid=${remainder%%|*}
      expected_start=${remainder#*|}

      assert_internshannon_process "$process_pid" "$process_role"
      rc=$?
      if [ "$rc" -ne 0 ]; then
        echo "ERROR: PID $process_pid changed or exited during validation; no processes were signaled." >&2
        return 1
      fi
      current_start=$(process_start_token "$process_pid")
      if [ "$current_start" != "$expected_start" ]; then
        echo "ERROR: PID $process_pid was reused during validation; no processes were signaled." >&2
        return 1
      fi
      if ! pid_is_listener "$process_port" "$process_pid"; then
        echo "ERROR: PID $process_pid stopped listening on port $process_port; no processes were signaled." >&2
        return 1
      fi
    done
  fi
}

process_was_signaled() {
  local expected_record="$1"
  local signaled_record

  [ "${#SIGNALED_PROCESSES[@]}" -eq 0 ] && return 1
  for signaled_record in "${SIGNALED_PROCESSES[@]}"; do
    [ "$signaled_record" = "$expected_record" ] && return 0
  done
  return 1
}

# Before each signal, every current listener must belong to the immutable
# validated set, and every not-yet-signaled process must still be listening.
assert_signal_listener_set() {
  local signal="$1"
  local role="$2"
  local port="$3"
  local current_pids current_pid process_record remainder process_role
  local process_port process_pid found unsafe=0 validated_pids=""

  current_pids=$(listener_pids "$port")

  for current_pid in $current_pids; do
    found=0
    for process_record in "${VALIDATED_PROCESSES[@]}"; do
      process_role=${process_record%%|*}
      remainder=${process_record#*|}
      process_port=${remainder%%|*}
      remainder=${remainder#*|}
      process_pid=${remainder%%|*}
      if [ "$process_role" = "$role" ] && [ "$process_port" = "$port" ] && [ "$process_pid" = "$current_pid" ]; then
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      unsafe=1
      break
    fi
  done

  for process_record in "${VALIDATED_PROCESSES[@]}"; do
    process_role=${process_record%%|*}
    remainder=${process_record#*|}
    process_port=${remainder%%|*}
    remainder=${remainder#*|}
    process_pid=${remainder%%|*}
    if [ "$process_role" != "$role" ] || [ "$process_port" != "$port" ]; then
      continue
    fi
    validated_pids="${validated_pids}${process_pid} "
    if ! process_was_signaled "$process_record" && ! pid_is_in_list "$current_pids" "$process_pid"; then
      unsafe=1
    fi
  done

  if [ "$unsafe" -ne 0 ]; then
    echo "ERROR: listeners changed immediately before SIG$signal for $role on port $port; remaining processes were not signaled." >&2
    echo "   validated PIDs: $(pid_set_key "$validated_pids")" >&2
    echo "   current PIDs:   $(pid_set_key "$current_pids")" >&2
    for current_pid in $current_pids; do
      print_process_details "$current_pid"
    done
    return 1
  fi
}

pid_is_in_list() {
  local pids="$1"
  local expected_pid="$2"
  local pid

  for pid in $pids; do
    [ "$pid" = "$expected_pid" ] && return 0
  done
  return 1
}

signal_listeners() {
  local signal="$1"
  shift
  local process_record role remainder port pid expected_start rc current_start

  resolve_targets "$@" || return 1
  capture_listener_snapshot || return 1
  revalidate_listener_snapshot || return 1
  SIGNALED_PROCESSES=()

  if [ "${#VALIDATED_PROCESSES[@]}" -eq 0 ]; then
    local target
    for target in "${RESOLVED_TARGETS[@]}"; do
      echo "OK: port ${target#*|} (${target%%|*}) is free"
    done
    return 0
  fi

  for process_record in "${VALIDATED_PROCESSES[@]}"; do
    role=${process_record%%|*}
    remainder=${process_record#*|}
    port=${remainder%%|*}
    remainder=${remainder#*|}
    pid=${remainder%%|*}
    expected_start=${remainder#*|}

    # Scan the complete listener set first. Identity and process generation are
    # deliberately the final checks so PID reuse during lsof cannot reach kill.
    assert_signal_listener_set "$signal" "$role" "$port" || return 1
    assert_internshannon_process "$pid" "$role"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      echo "ERROR: PID $pid changed or exited immediately before SIG$signal; remaining processes were not signaled." >&2
      return 1
    fi
    current_start=$(process_start_token "$pid")
    if [ "$current_start" != "$expected_start" ]; then
      echo "ERROR: PID $pid was reused immediately before SIG$signal; remaining processes were not signaled." >&2
      return 1
    fi
    echo "Sending SIG$signal to verified $role PID $pid on port $port"
    kill -"$signal" "$pid" || {
      echo "ERROR: failed to send SIG$signal to PID $pid." >&2
      return 1
    }
    SIGNALED_PROCESSES+=("$process_record")
  done
}

check_targets() {
  resolve_targets "$@" || return 1
  local target role port pids pid failed=0
  for target in "${RESOLVED_TARGETS[@]}"; do
    role=${target%%|*}
    port=${target#*|}
    pids=$(listener_pids "$port")
    if [ -z "$pids" ]; then
      echo "OK: port $port ($role) is free"
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

stop_targets() {
  local raw_targets=("$@")
  if [ "${#raw_targets[@]}" -eq 0 ]; then
    raw_targets=("sidecar:${SIDECAR_PORT:-29653}" "preview:${PUBLIC_DESKTOP_DEV_PORT:-5000}")
  fi
  signal_listeners TERM "${raw_targets[@]}" || return 1
  sleep 2

  resolve_targets "${raw_targets[@]}" || return 1
  local remaining=() target role port
  for target in "${RESOLVED_TARGETS[@]}"; do
    role=${target%%|*}
    port=${target#*|}
    if [ -n "$(listener_pids "$port")" ]; then
      remaining+=("$role:$port")
    fi
  done

  if [ "${#remaining[@]}" -gt 0 ]; then
    echo "Listeners remain after SIGTERM; revalidating before SIGKILL." >&2
    signal_listeners KILL "${remaining[@]}" || return 1
    sleep 1
  fi

  check_targets "${raw_targets[@]}"
}

usage() {
  cat <<'EOF'
Usage: scripts/predeploy-check.sh check [ROLE:PORT ...]
       scripts/predeploy-check.sh stop  [ROLE:PORT ...]

Defaults: sidecar:${SIDECAR_PORT:-29653} preview:${PUBLIC_DESKTOP_DEV_PORT:-5000}
Known default ports may also be passed without a role. Custom ports require an
explicit role, for example: preview:5001. Unknown processes are never signaled.
EOF
}

main() {
  local action=${1:-check}
  if [ "$#" -gt 0 ]; then shift; fi
  local ports=("$@")

  case "$action" in
    check)
      if [ "${#ports[@]}" -eq 0 ]; then check_targets; else check_targets "${ports[@]}"; fi
      ;;
    stop)
      if [ "${#ports[@]}" -eq 0 ]; then stop_targets; else stop_targets "${ports[@]}"; fi
      ;;
    *) usage >&2; return 2 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
