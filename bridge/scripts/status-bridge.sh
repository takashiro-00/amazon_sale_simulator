#!/bin/bash
set -euo pipefail
STATE="${BRIDGE_STATE_DIR:-$HOME/.claude-chatgpt-bridge/amazon-ads-automation}"
pid=''
if [[ -f "$STATE/tunnel.pid" ]]; then pid=$(cat "$STATE/tunnel.pid"); fi
if [[ $pid =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then
  echo "Tunnel running (pid $pid)"
else
  echo 'Tunnel is stopped'
fi
for endpoint in healthz readyz; do
  printf '%s: ' "$endpoint"
  curl -s --max-time 5 --unix-socket "$STATE/tunnel-health.sock" "http://localhost/$endpoint" || printf 'unavailable'
  printf '\n'
done
if [[ -f "$STATE/tunnel.log" ]]; then
  tail -n 20 "$STATE/tunnel.log" | awk 'tolower($0) ~ /key|token|secret|authorization|bearer/ {print "[redacted]"; next} {print}'
fi
