# ReserveHub: evidence checklist

This file shows the grader where the proof is for every requirement.

**All screenshots, saved reports, and command outputs are in the `evidence/` folder.**

**Links**
- Production site: https://www.reservehub-hh.com
- Production API: https://api.reservehub-hh.com
- Staging site: https://staging.reservehub-hh.com
- Staging API: https://api-staging.reservehub-hh.com
- Repository: https://github.com/hhuang51/reservehub

**Run all tests with one command:** `cd server` then `npm test`

**Tip:** for each item, write down the commit you tested. Get it by opening
https://api.reservehub-hh.com/healthz and copying the first 7 characters of `commit`.

---

## Part 1: The app

### ☐ F1–F2: Search/filter screen with loading, empty, and error states
- **Show:** the rooms list loading, a search with no results ("No rooms match"), and the error message with "Try again".
- **How:** open the site; search for a name that doesn't exist; for the error, run the site locally with the API stopped.
- **Code:** `src/App.tsx`
- Commit: ______

### ☐ F3: REST API with proper status codes and one error format
- **Show:** the API answering with the right codes and the same JSON error shape.
- **How (PowerShell):**
  ```
  curl.exe -i -X POST https://api-staging.reservehub-hh.com/api/reservations
  curl.exe -i https://api-staging.reservehub-hh.com/api/rooms/999/reservations
  ```
  The first should be `401`, the second `404`, both with `{"error":{"code":...,"message":...}}`.
- **Code:** `server/index.cjs`, `server/reservations.cjs`, `server/validation.cjs`
- Commit: ______

### ☐ F4–F6: Database, migrations, audit log
- **Show:** the test output, which covers the migrations, the reversible migration, the overlap rules, and that the audit log can't be edited.
- **How:** `cd server` then `npm test` → copy the whole output.
- **Code:** `server/migrations.cjs`, `server/reservation-migration.cjs`, `server/tests/`
- Commit: ______

### ☐ F7–F9: Login (Auth0) and server-side permission checks
- **Show:** the Auth0 login page, and a viewer account being refused a write (403).
- **How:** log in; try to book with a non-scheduler account (or show the "view-only access" message plus the 403 in the browser Network tab).
- **Code:** `server/auth.cjs`, `server/permissions.cjs`, `server/tests/authorization.test.cjs`
- Commit: ______

### ☐ F10: Holiday API through the server
- **Show:** the holiday endpoint working, and the tests for timeout, retry, cache, and outage.
- **How:** open https://api.reservehub-hh.com/api/holidays?year=2026 → it should say `"status":"fresh"`.
- **Code:** `server/holidays.cjs`, `server/tests/holidays.test.cjs`
- Commit: ______

### ☐ F11: Live updates (SSE)
- **Show:** two browser windows side by side; booking in one makes the other update by itself.
- **Explanation:** `docs/architecture.md` → "Live updates: why SSE"
- **Code:** `server/integrations.cjs` (`/api/events`), `src/useLiveUpdates.tsx`
- Commit: ______

### ☐ F12–F13: MCP panel with per-tool permissions and confirmation
- **Show:** preview → confirm creating a reservation; and a read-only account being refused.
- **How:** click "Open MCP panel" → Load rooms → fill in → Preview reservation → Confirm.
- **Code:** `server/mcp.cjs`, `src/McpPanel.tsx`
- Commit: ______

---

## Part 2: Deployment

### ☐ D1: Separate staging and production
- **Show:** the Render project page with both environments.
- **Config:** `render.yaml`

### ☐ D2: Domain, DNS records, TTL reasoning
- **Show:** Namecheap → Advanced DNS with all records at 30 min.
- **Explanation:** `docs/dns-and-tls.md`

### ☐ D3: HTTPS, auto-renewal, CAA, redirects, expiry alert
- **Show:**
  - Render custom domains all saying "Certificate Issued"
  - Certificate check passing (21 days)
  - Certificate check failing on purpose (100 days) and its email
  - Redirect: run `curl.exe -I http://reservehub-hh.com`
- **Explanation:** `docs/dns-and-tls.md`

### ☐ D4: Infrastructure as code
- **Show:** Render → Blueprints → reservehub (synced from `render.yaml`).

### ☐ D5: Pipeline through staging, health check, rollback
- **Show:**
  - A green run with commit and run ID
  - The run that failed at staging and never touched production
  - The rollback run (#11) and `/healthz` showing the older commit
- **Config:** `.github/workflows/deploy.yml`

### ☐ D6–D7: Caching rules, CORS, security headers
- **How (PowerShell):**
  ```
  curl.exe -I https://www.reservehub-hh.com/
  curl.exe -I https://api.reservehub-hh.com/api/rooms
  ```
  Look for `Cache-Control`, `Content-Security-Policy`, `Strict-Transport-Security`.
  For a hashed asset, copy one `/assets/index-....js` path from the page source and run `curl.exe -I` on it (should say `max-age=31536000, immutable`).
- **Config:** `render.yaml` (site headers), `server/http-headers.cjs` (API)

---

## Part 3: Quality and operations

### ☐ D8: Core Web Vitals before and after
- **Show:** the two Lighthouse reports and the bundle size from `npm run build`.
- **Numbers and explanation:** `docs/accessibility.md` → "Core Web Vitals"

### ☐ D9: Accessibility (axe + keyboard)
- **Show:** Lighthouse Accessibility score (100) and your keyboard test notes.
- **Results:** `docs/accessibility.md`

### ☐ D10: Logs, metrics, traces, SLO and alert
- **Show:**
  - Trace waterfall with `reservehub-web` and `reservehub-api`
  - Service Graph
  - Logs in Grafana
  - Alert rule Firing
  - FIRING and RESOLVED emails
  - Terminal with 200s and 503s
- **Explanation:** `docs/observability.md`

### ☐ D11: Costs and free-tier proof
- **Show:** Render billing page, GitHub budget alert, Grafana and Auth0 free plan pages.
- **Estimate:** `docs/cost.md`

### ☐ S1: Rate limiting
- **Show:** before the fix (35 × `200`) and after (30 × `200`, then `429`); plus Auth0's brute-force protection page for login.
- **Code:** `server/rate-limits.cjs`, `server/client-ip.cjs`

### ☐ S2: Runbook and postmortem
- **Documents:** `docs/runbook.md`, `docs/postmortem-2026-11-19.md`

---

## Part 4: Tests and ownership

### ☐ Q1: Tests from one command, with predictions written first
- **Show:** `npm test` output (53 passing), plus one deliberate failure (see below).
- **Predictions:** written at the top of each file in `server/tests/`
- **How to run:** `server/TESTING.md`

### ☐ Q2: Diagrams
- **Document:** `docs/architecture.md` (GitHub draws the diagrams when you open it)

### ☐ Q3: Evidence with commit, commands, output, and meaning
- **This file**, plus the `evidence/` folder. Fill in the "Commit" lines above.

### ☐ Q4: AI use, a challenged AI claim, redaction
- **Documents:** `docs/ai-use-log.md`, `docs/redaction-attestation.md` (sign it)

---

## Deliberate failures

Each of these was made to fail on purpose (or was caught failing) to prove the
safety checks work.

1. **A test made to fail.** Change `[2]` to `[1, 2]` in `server/tests/schedule.test.cjs`, run `npm test`, save the output in `evidence/`, then change it back.
   - Expected: that one test fails. Observed: ______
2. **Pipeline stopped at staging.** The first deploy timed out at staging.
   - Expected: production not touched. Observed: production stayed on the old commit.
3. **Rate limit before the fix.**
   - Expected: `429` after 30 requests. Observed: 35 × `200`, a real bug, then fixed.
4. **Certificate check at 100 days.**
   - Expected: fails and sends an email. Observed: failed for all 5 hosts, email received.
5. **Fault injection on staging (`FAULT_ERROR_RATE=0.5`).**
   - Expected: alert fires and emails. Observed: fired about 20:41, emailed 20:48, resolved 20:58. Details in `docs/postmortem-2026-11-19.md`.
