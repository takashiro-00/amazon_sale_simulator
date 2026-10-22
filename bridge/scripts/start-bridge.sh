#!/bin/bash
set -euo pipefail
TUNNEL_BIN="${BRIDGE_TUNNEL_BIN:-$HOME/.local/opt/tunnel-client/v0.0.16/tunnel-client-runtime}"
STATE="${BRIDGE_STATE_DIR:-$HOME/.claude-chatgpt-bridge/amazon-ads-automation}"
KEYCHAIN_SERVICE="openai-tunnel-amazon-ads-bridge"
dry_run=false
if [[ $# -eq 1 && $1 == --dry-run ]]; then
  dry_run=true
elif [[ $# -ne 0 ]]; then
  echo 'Usage: start-bridge.sh [--dry-run]' >&2
  exit 1
fi
[[ -x "$TUNNEL_BIN" ]] || { echo "Tunnel binary missing or not executable: $TUNNEL_BIN" >&2; exit 1; }
[[ -f "$STATE/tunnel-id" ]] || { echo "Tunnel ID missing: $STATE/tunnel-id" >&2; exit 1; }
ID=$(cat "$STATE/tunnel-id")
[[ $ID =~ ^tunnel_[A-Za-z0-9]+$ ]] || { echo 'Invalid tunnel ID' >&2; exit 1; }
NODE=$(command -v node) || { echo 'Node.js is missing' >&2; exit 1; }
[[ $NODE == /* ]] || { echo 'Node.js path must be absolute' >&2; exit 1; }
SERVER="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)/server.js"
command_args=("$TUNNEL_BIN" run --control-plane.tunnel-id "$ID" --control-plane.api-key env:CONTROL_PLANE_API_KEY --mcp.command "command=$NODE $SERVER" --health.unix-socket "$STATE/tunnel-health.sock" --pid.file "$STATE/tunnel.pid" --log.file "$STATE/tunnel.log")
if "$dry_run"; then
  printf 'CONTROL_PLANE_API_KEY=<from-keychain> '
  printf '%q ' "${command_args[@]}"
  printf '\n'
  exit 0
fi
if [[ -f "$STATE/tunnel.pid" ]]; then
  pid=$(cat "$STATE/tunnel.pid")
  if [[ $pid =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then
    echo "Tunnel already running (pid $pid)"
    exit 0
  fi
  rm -f "$STATE/tunnel.pid"
fi
umask 077
if ! CONTROL_PLANE_API_KEY=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$USER" -w 2>/dev/null); then
  echo 'Tunnel Keychain item missing or unavailable; run store-tunnel-key.sh' >&2
  exit 1
fi
[[ -n $CONTROL_PLANE_API_KEY ]] || { echo 'Tunnel Keychain item is empty' >&2; exit 1; }
CONTROL_PLANE_API_KEY="$CONTROL_PLANE_API_KEY" nohup "${command_args[@]}" </dev/null >/dev/null 2>&1 &
unset CONTROL_PLANE_API_KEY
for ((attempt=0; attempt<15; attempt++)); do
  if [[ -s "$STATE/tunnel.pid" ]]; then
    pid=$(cat "$STATE/tunnel.pid")
    if [[ $pid =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Tunnel started (pid $pid); log: $STATE/tunnel.log"
      exit 0
    fi
  fi
  sleep 1
done
echo "Tunnel did not start within 15 seconds; log: $STATE/tunnel.log" >&2
exit 1
