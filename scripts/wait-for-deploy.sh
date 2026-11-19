#!/usr/bin/env bash
# Usage: wait-for-deploy.sh <url returning JSON with "commit"> <expected sha> [timeout seconds]
# Polls until the URL reports the expected commit. Exits 1 on timeout.
set -euo pipefail

url="$1"
expected="$2"
timeout="${3:-900}"
deadline=$(( $(date +%s) + timeout ))

echo "Waiting for $url to report commit ${expected:0:7}"

while (( $(date +%s) < deadline )); do
  body="$(curl -fsS --max-time 20 "$url" 2>/dev/null || true)"
  commit="$(printf '%s' "$body" | jq -r '.commit // empty' 2>/dev/null || true)"

  if [[ -n "$commit" && "$commit" == "$expected"* ]]; then
    echo "Live: $body"
    exit 0
  fi

  echo "  not yet (currently: ${commit:-no response}); retrying in 10 s"
  sleep 10
done

echo "Timed out after ${timeout}s waiting for ${expected:0:7} at $url" >&2
exit 1
