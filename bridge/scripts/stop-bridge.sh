#!/bin/bash
set -euo pipefail
STATE="${BRIDGE_STATE_DIR:-$HOME/.claude-chatgpt-bridge/amazon-ads-automation}"
[[ -f "$STATE/tunnel.pid" ]] || { echo 'Tunnel is stopped'; exit 0; }
pid=$(cat "$STATE/tunnel.pid")
if [[ ! $pid =~ ^[1-9][0-9]*$ ]]; then
  echo 'Invalid tunnel pid file; refusing to signal a process' >&2
  exit 1
fi
if kill -0 "$pid" 2>/dev/null; then
  kill -TERM "$pid" 2>/dev/null || true
  for ((attempt=0; attempt<10; attempt++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
fi
rm -f "$STATE/tunnel.pid"
echo 'Tunnel stopped'
