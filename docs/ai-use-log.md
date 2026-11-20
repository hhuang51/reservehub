# AI-use log (Q4)

Tool: Claude (Anthropic), used as a pair programmer and reviewer during
2026-11-18 → 2026-11-23. I reviewed, ran, and tested everything before
committing; I am responsible for all code and claims in this repository and
can explain and change any of it.

## How AI was used

| Date | Task | What the AI produced | What I did / verified |
|---|---|---|---|
| 11-18 | Code review of frontend and server | List of bugs (edit form lost on live update, App.css not imported, non-JSON error handling, past dates accepted) | Checked each against the code; fixed the ones that applied |
| 11-18 | McpPanel TypeScript errors | Runtime-validated `readToolResult()` replacing an unsafe `result.content` access | Confirmed the 3 VS Code errors disappeared; tested the panel |
| 11-18 | Test suite (Q1) | Validation, authorization, stubbed-integration, and core-calculation tests with hand-predicted outcomes in each file header | Read every expected value and checked it by hand before running; ran `npm test` locally and in CI |
| 11-18 | Rate limiting, security headers, cache policy | `rate-limits.cjs`, `http-headers.cjs` | Demonstrated 429s against production (see challenged claim below) |
| 11-18 | Render, CI/CD, DNS | `render.yaml`, `deploy.yml`, `wait-for-deploy.sh`, `cert-expiry.yml`, DNS record table | Created all accounts and records myself; ran the pipeline, rollback, and certificate alert demos |
| 11-19 | OpenTelemetry + Grafana | `otel.cjs`, `telemetry.cjs`, `fault-injection.cjs`, Faro setup, SLO and alert queries | Created the Grafana stack and alert rule; ran the fault-injection test and received FIRING/RESOLVED emails |
| 11-19 | Documentation | Drafts of runbook, postmortem, cost estimate, architecture diagrams | Edited for accuracy against what I observed; filled in my own measurements |

## AI claims that were wrong or challenged

| # | AI claim | How it was tested | Result |
|---|---|---|---|
| 1 | Setting `TRUST_PROXY=1` makes `req.ip` the visitor's IP on Render, so per-IP rate limits work | 35 requests to the holiday endpoint in production | **Wrong**: 35 × `200`, no `429`. See detailed case below |
| 2 | OpenTelemetry 0.x packages share version numbers, so `@opentelemetry/api-logs@0.301.2` would match `sdk-node@0.301.2` | `npm install` | **Wrong**: `ETARGET`, no such version |
| 3 | Logs were missing because two different `api-logs` versions were installed | `npm ls --all` | **Wrong**: only one version installed. The real cause was the logger being looked up before the SDK finished starting; fixed by a dedicated log pipeline |
| 4 | A 15-minute staging timeout is enough for the pipeline | First pipeline run | **Wrong**: the free staging API took ~16 minutes; the gate failed (safely). Raised to 30 minutes |
| 5 | The stuck pipeline job was production | Re-read the log: `Timed out after 1800s … at /version.json` | **Wrong**: it was staging, and `WEB_URL` had been created as a secret instead of a variable |
| 6 | Public reads could be cached for 15 seconds | AI self-corrected before shipping | Would have served stale data right after a live-update notice; changed to `public, no-cache` with ETag revalidation |
| 7 | "MCP App" in F13 might mean the MCP Apps extension, not a React MCP client | Flagged as ambiguous, not assumed | Open question to confirm with the instructor |

## Detailed challenged claim: rate limiting behind Render's proxy

**Claim (AI, 11-18):** "Set `TRUST_PROXY=1` on Render so rate limits count each
visitor separately instead of everyone sharing the proxy's address."

**Prediction if true:** the 31st request within a minute to
`/api/holidays` (limit 30/min) returns `429`.

**Test (production, 11-18):**
```powershell
1..35 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code}`n" "https://api.reservehub-hh.com/api/holidays?year=2026" }
```
**Raw result:** 35 × `200`. **Claim rejected.**

**Diagnosis:** requests reach the app through Cloudflare and Render's load
balancer. With one trusted hop, `req.ip` was a Cloudflare edge address that
changes between requests, so every request had a new rate-limit key.

**Fix:** use `CF-Connecting-IP` (set by Cloudflare, client-sent values
overwritten) only when running on Render; ignore it locally where it could be
forged (`server/client-ip.cjs`, 4 unit tests).

**Retest:** 30 × `200`, then 5 × `429`. **Fixed.**

**Lesson:** a configuration claim about infrastructure has to be tested against
the deployed system, not just reasoned about.
