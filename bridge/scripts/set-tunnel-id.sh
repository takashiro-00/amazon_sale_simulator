#!/bin/bash
set -euo pipefail
STATE="${BRIDGE_STATE_DIR:-$HOME/.claude-chatgpt-bridge/amazon-ads-automation}"
[[ $# -eq 1 && $1 =~ ^tunnel_[A-Za-z0-9]+$ ]] || { echo 'Usage: set-tunnel-id.sh tunnel_<alphanumeric>' >&2; exit 1; }
umask 077
mkdir -p "$STATE"
printf '%s\n' "$1" > "$STATE/tunnel-id"
chmod 600 "$STATE/tunnel-id"
