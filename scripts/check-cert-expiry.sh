#!/usr/bin/env bash
# Usage: check-cert-expiry.sh <min-days> <host[:port]> [host[:port] ...]
# Prints days until each TLS certificate expires. Exits 1 if any certificate
# expires in fewer than <min-days> days or cannot be read.
set -uo pipefail

min_days="$1"; shift
status=0
now=$(date -u +%s)

printf '%-34s %-12s %-26s %s\n' "HOST" "DAYS LEFT" "EXPIRES (UTC)" "ISSUER"

for target in "$@"; do
  host="${target%%:*}"
  port="${target##*:}"; [[ "$port" == "$target" ]] && port=443

  cert="$(echo | timeout 20 openssl s_client -servername "$host" -connect "$host:$port" 2>/dev/null \
          | openssl x509 -noout -enddate -issuer 2>/dev/null)"

  if [[ -z "$cert" ]]; then
    printf '%-34s %-12s %s\n' "$host" "ERROR" "could not read certificate"
    status=1
    continue
  fi

  end="$(sed -n 's/^notAfter=//p' <<<"$cert")"
  issuer="$(sed -n 's/^issuer=//p' <<<"$cert" | sed 's/.*O *= *\([^,]*\).*/\1/')"
  days=$(( ( $(date -u -d "$end" +%s) - now ) / 86400 ))

  flag=""
  if (( days < min_days )); then flag="  <-- below ${min_days} days"; status=1; fi
  printf '%-34s %-12s %-26s %s%s\n' "$host" "$days" "$end" "$issuer" "$flag"
done

exit $status
