#!/bin/bash
set -euo pipefail
KEYCHAIN_SERVICE="openai-tunnel-amazon-ads-bridge"
[[ $# -eq 0 ]] || { echo 'Usage: store-tunnel-key.sh' >&2; exit 1; }
key=$(pbpaste)
key="${key#"${key%%[![:space:]]*}"}"
key="${key%"${key##*[![:space:]]}"}"
if [[ "$key" != sk-* || ${#key} -lt 40 ]]; then
  unset key
  echo 'Error: clipboard key must start with sk- and contain at least 40 characters.' >&2
  exit 1
fi
length=${#key}
security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$USER" -w "$key"
pbcopy </dev/null
unset key
printf 'Stored key (%s characters)\n' "$length"
