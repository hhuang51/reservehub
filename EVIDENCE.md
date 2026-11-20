# ReserveHub: evidence index

Every checklist item, where its evidence is, and how to reproduce it.
Screenshots and saved outputs go in `evidence/` with the item ID in the file
name (e.g. `evidence/D5-pipeline-green.png`). Record the commit SHA shown in
`/healthz` next to each item when you capture it.

**Production:** https://www.reservehub-hh.com · API https://api.reservehub-hh.com
**Staging:** https://staging.reservehub-hh.com · API https://api-staging.reservehub-hh.com
**Repository:** https://github.com/hhuang51/reservehub
**One test command:** `cd server && npm test`

| ID | Requirement | Evidence (code / docs) | Evidence to capture in `evidence/` | Reproduce | Commit |
|---|---|---|---|---|---|
| F1–F2 | React + TypeScript UI; loading, empty, error states | `src/*.tsx` | UI screenshots: loading, "No rooms match", error with Try again | Open site; stop API locally to see error | |
| F3 | Validated REST API, status codes, JSON error shape | `server/index.cjs`, `reservations.cjs`, `closures.cjs`, `validation.cjs` | `curl -i` of a 400, 401, 403, 404, 409 | `curl -i -X POST https://api-staging.reservehub-hh.com/api/reservations` (401) | |
| F4–F5 | DB with PK/FK, justified index, versioned + reversible tested migration | `server/migrations.cjs`, `reservation-migration.cjs`, `tests/reservation-migration.test.cjs`, `tests/schedule.test.cjs` | `npm test` output | `cd server && npm test` | |
| F6 | Append-only before/after audit with token actor | `audit_events`, `closure_audit` triggers; `tests/schedule.test.cjs` "audit history is append-only" | Test output; one audit row | `npm test` | |
| F7–F9 | OIDC Code + PKCE, server JWT validation, roles from claims | `src/main.tsx` (Auth0), `server/auth.cjs`, `permissions.cjs`, `tests/authorization.test.cjs` | Login flow screenshot; 403 for viewer | `npm test`; log in as viewer | |
| F10 | Server-side integration: secret, timeout, retry, cache, validation, outage policy, key redaction | `server/holidays.cjs`, `tests/holidays.test.cjs` | Test output; `/api/holidays` showing `"status":"fresh"` | `curl https://api.reservehub-hh.com/api/holidays?year=2026` | |
| F11 | SSE with event IDs, snapshot recovery, client dedup; why SSE | `server/integrations.cjs` (`/api/events`), `src/useLiveUpdates.tsx` | Two browser windows updating live | Make a booking in one window | |
| F12–F13 | OAuth on every MCP tool, per-tool scopes, audit, operation-bound confirmation | `server/mcp.cjs`, `src/McpPanel.tsx`, `tests/authorization.test.cjs` | Preview → confirm flow; read-only user denied | MCP panel on staging | |
| D1 | Staging + production, separate data and secrets | `render.yaml` | Render project with both environments | Render dashboard | |
| D2 | Domain, DNS records, TTL rationale | `docs/dns-and-tls.md` | Namecheap Advanced DNS (TTL 30 min) | `nslookup reservehub-hh.com` | |
| D3 | HTTPS, auto-renewal, CAA, redirects, expiry alert demonstrated | `docs/dns-and-tls.md`, `.github/workflows/cert-expiry.yml`, `scripts/check-cert-expiry.sh` | Render "Certificate Issued"; cert check pass (21 d) + fail (100 d) + email; `curl -I http://reservehub-hh.com` | Actions → Certificate expiry check | |
| D4 | Reproducible infrastructure/config | `render.yaml` (Blueprint) | Blueprint page | Render → Blueprints | |
| D5 | CI/CD via staging, `/healthz` gate, commit/build IDs, rollback | `.github/workflows/deploy.yml`, `scripts/wait-for-deploy.sh` | Green run summary; failed run that never reached production; rollback run #11 + `/healthz` showing old commit | Actions → Test and deploy → Run workflow (SHA) | |
| D6–D7 | Cache policies (HTML, hashed assets, public API, authenticated), CORS allowlist, security headers | `render.yaml` headers, `server/http-headers.cjs` | `curl -I` of `/`, `/assets/…js`, `/api/rooms`, an authenticated request | See commands in `docs/dns-and-tls.md` | |
| D8 | Core Web Vitals before/after | `src/App.tsx` (lazy MCP panel), `src/main.tsx` (lazy telemetry) | `lighthouse-before.html`, `lighthouse-after.html`, bundle sizes from `npm run build` | Lighthouse, mobile, Incognito | |
| D9 | axe + keyboard accessibility | `docs/accessibility.md` | Lighthouse accessibility before/after; keyboard walkthrough notes | Lighthouse; keyboard only | |
| D10 | OTel logs, metrics, distributed trace (≥2 components); SLI/SLO; alert triggered | `server/otel.cjs`, `telemetry.cjs`, `fault-injection.cjs`, `src/observability.ts`, `docs/observability.md` | Trace waterfall (web + api); Service Graph; Loki logs; alert Firing; FIRING + RESOLVED emails; 200/503 output | `docs/observability.md` → Triggering the alert | |
| D11 | Free-tier/budget evidence; 1×/10×/100× cost with assumptions | `docs/cost.md` | Render billing; GitHub budget; Grafana/Auth0 free plan pages | n/a | |
| S1 | Rate limiting: login, writes, third-party endpoint | `server/rate-limits.cjs`, `client-ip.cjs`, `tests/client-ip.test.cjs` | Before (35 × 200) and after (30 × 200, 5 × 429); Auth0 brute-force protection page | PowerShell loop in `docs/ai-use-log.md` | |
| S2 | Runbook; postmortem of induced failure | `docs/runbook.md`, `docs/postmortem-2026-11-19.md` | Links | n/a | |
| Q1 | Validation, authorization, stubbed integration, core calculation tests; hand-predicted; one command | `server/tests/*.test.cjs`, `server/TESTING.md` | `npm test` raw output (53 passing) + one deliberate failure | `cd server && npm test` | |
| Q2 | Request-path and trust-boundary diagrams | `docs/architecture.md` | GitHub-rendered diagrams | n/a | |
| Q3 | Evidence with SHA, commands, raw output, interpretation, deliberate failures | this file | | | |
| Q4 | AI-use log, challenged AI claim, redaction attestation | `docs/ai-use-log.md`, `docs/redaction-attestation.md` | Signed attestation | n/a | |

## Deliberate failures (for Q3)

| Failure | Expected | Observed | Where |
|---|---|---|---|
| Test expectation changed (`[2]` → `[1, 2]` in `schedule.test.cjs`) | `npm test` fails on that assertion | | `evidence/Q1-deliberate-failure.txt` |
| Pipeline staging gate times out | Production not deployed | Production stayed on old commit | Actions run (first failed run) |
| Rate-limit test before fix | 429 after 30 | 35 × 200 (bug found) | `evidence/S1-before.png` |
| Certificate check with `min_days=100` | Fails, email sent | Failed for all 5 hosts | Actions run #4 |
| Fault injection `FAULT_ERROR_RATE=0.5` on staging | Alert fires, email | Fired ~20:41, emailed 20:48, resolved 20:58 | `docs/postmortem-2026-11-19.md` |
