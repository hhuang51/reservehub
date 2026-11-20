# ReserveHub runbook

For someone who has never seen this system. Every step says where to click or
what to run. Times are America/Chicago unless marked UTC.

## 1. What the system is

| Part | Production | Staging | Hosted on |
|---|---|---|---|
| Website (React, static) | https://www.reservehub-hh.com | https://staging.reservehub-hh.com | Render static site |
| API (Node.js/Express + SQLite) | https://api.reservehub-hh.com | https://api-staging.reservehub-hh.com | Render web service |
| Database | SQLite file on a 1 GB disk at `/var/data` | SQLite file inside the service (reset on every deploy) | Render |
| Login | Auth0 tenant `dev-ufj4dlu42vc0rwfy.us.auth0.com` | same | Auth0 |
| Holiday data | Calendarific API (cached 24 h) | same | Calendarific |
| Telemetry | Grafana Cloud stack `tanlime2726` | same | Grafana |
| Source and pipeline | github.com/hhuang51/reservehub, `.github/workflows/` | | GitHub |
| DNS | Namecheap, domain `reservehub-hh.com` | | Namecheap |

Architecture diagrams: `docs/architecture.md`. Deployment details: `DEPLOY.md`.

## 2. Access you need

- Render dashboard (workspace with the `reservehub` project)
- GitHub repository (write access, to run Actions)
- Grafana Cloud stack `tanlime2726`
- Auth0 dashboard (only for login problems)
- Namecheap account (only for DNS problems)

Secrets live only in Render environment variables and GitHub environment
secrets. Never paste them into chat, tickets, or the repository.

## 3. Is it healthy? (2 minutes)

```
curl https://api.reservehub-hh.com/healthz
curl https://www.reservehub-hh.com/version.json
```

Healthy: `/healthz` returns `"status":"ok","database":"connected"` and the same
`commit` as `/version.json`.

Then in Grafana:
- **Alerts & IRM → Alert rules → "ReserveHub API error budget burn"**: should be Normal.
- **Explore → traces → Service Graph**: error rate near 0 on `reservehub-api`.

## 4. Incidents

### 4.1 Alert "ReserveHub API error budget burn" is firing

Meaning: more than 10% of real API requests returned 5xx for 2+ minutes.

1. Check the alert's `job` label: `reservehub/reservehub-api` = production,
   `...-staging` = staging.
2. **Staging only?** Render → `reservehub-api-staging` → Environment →
   `FAULT_ERROR_RATE`. If it is not `0`, someone left the fault-injection test
   on. Set it to `0` → Save and deploy. The alert resolves within ~10 minutes.
3. Find the failing requests. Grafana → Explore → logs:
   ```
   {service_name="reservehub-api"} | json | level="error"
   ```
   Each line has `route`, `status`, and `trace_id`. Open the trace
   (Explore → traces → Trace ID) to see which step failed.
4. Did a deploy just happen? Compare `/healthz` `commit` with the latest green
   run in GitHub Actions. If the errors started with that deploy, **roll back**
   (section 5.2).
5. Otherwise follow the matching section below (database, Auth0, Calendarific).

### 4.2 API is down (`/healthz` fails or times out)

1. Render → `reservehub-api` → **Events**: was there a failed deploy or a restart?
2. Render → `reservehub-api` → **Logs**: look at the last lines before the failure.
   - `requires a newer server version` → code older than the database schema
     was deployed (a rollback across a migration). Redeploy the newer commit.
   - `SQLITE_FULL` / disk errors → section 4.5.
   - `Missing Auth0 settings` → an environment variable was removed. Restore
     `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` (values in `render.yaml`).
3. If the last deploy is the cause: Render → **Deploys** → previous successful
   deploy → **Rollback** (fastest), then fix forward through the pipeline.
4. Staging is on the free plan and **sleeps after 15 minutes idle**. The first
   request can take up to a minute. That is expected, not an outage.

### 4.3 Website loads but shows errors / nothing loads from the API

1. Browser → F12 → Console.
   - **CORS error**: `FRONTEND_ORIGIN` on the API must exactly equal the site
     origin (`https://www.reservehub-hh.com` or `https://staging.reservehub-hh.com`,
     no trailing slash or space).
   - **Content-Security-Policy error**: the site's `connect-src` in `render.yaml`
     must list the API origin. Fix in `render.yaml`, push, Blueprint sync, redeploy the site.
2. F12 → Network: requests going to the wrong API host mean `VITE_API_URL` was
   wrong **at build time**. Fix it (Render → site → Environment, or `render.yaml`)
   and redeploy the site; static sites need a rebuild to pick it up.

### 4.4 Users cannot log in

1. Auth0 error "Callback URL mismatch": Auth0 → Applications → ReserveHub →
   Settings: the site origin must be in Allowed Callback URLs, Logout URLs, and
   Web Origins.
2. API returns 401 for everyone: `AUTH0_AUDIENCE` on the API must equal the
   audience the site requests (`https://reservehub-api`).
3. "Only schedulers can…" (403): the user lacks the `scheduler` role or the
   `write:reservations` permission in Auth0. Expected for viewers.

### 4.5 Database / disk problems (production)

1. Render → `reservehub-api` → **Disks**: check usage (1 GB).
2. Back up before any change. Render → `reservehub-api` → **Shell** (paid
   instances only; if it is not offered, use `render ssh` from the Render CLI):
   ```
   cp /var/data/reservehub.sqlite /var/data/backup-$(date +%Y%m%d-%H%M).sqlite
   ls -lh /var/data
   ```
3. To grow the disk: Render → Disks → change size → save (billed $0.25/GB/month).
   Disks can grow but not shrink.
4. Never delete `reservehub.sqlite` or edit `audit_events` / `closure_audit`
   (they are append-only by design; triggers will reject edits).

### 4.6 Certificate expiry alert (GitHub email "Certificate expiry check failed")

1. Open the failed run → job summary table: which host, how many days left.
2. A host showing `ERROR could not read certificate`: check that host in Render
   → service → Settings → Custom Domains shows "Certificate Issued"; click
   Verify if not.
3. Few days left on a valid certificate: renewal is failing. Most likely causes:
   - DNS record changed or removed in Namecheap (compare with `docs/dns-and-tls.md`).
   - CAA records missing `letsencrypt.org` or `pki.goog`.
   - A stray Namecheap "URL Redirect" record on `@` (happened once; see postmortem appendix).

### 4.7 Holiday notice says "unavailable" or "may be out of date"

Booking still works; holidays are advisory. Check Render → API → Logs for
`Holiday lookup ... failed` with an HTTP status:
- `HTTP 401/403`: key invalid → replace `CALENDARIFIC_API_KEY` on the API, Save and deploy.
- `HTTP 429`: monthly quota (500 calls) used up → it recovers next month; the
  cache keeps the last good data ("stale").
- `timed out` / `could not be reached`: provider outage; nothing to do.

### 4.8 Many `429 Too Many Requests`

Expected for abusive clients. If legitimate users are blocked, check Render
logs for `rate limit reached`. Limits can be raised without a code change via
`RATE_LIMIT_WRITES_PER_MINUTE`, `RATE_LIMIT_MCP_PER_MINUTE`,
`RATE_LIMIT_HOLIDAYS_PER_MINUTE` on the API (Environment → Save and deploy).

## 5. Routine operations

### 5.1 Deploy

Push to `main` (or Actions → **Test and deploy** → Run workflow). The pipeline
runs tests, deploys staging, waits for `/healthz` and `/version.json` to report
the new commit, then does the same for production. Expect ~20 minutes
(the free staging API builds slowly). A commit message containing `[skip ci]`
does not deploy.

### 5.2 Roll back

Actions → **Test and deploy** → Run workflow → enter the previous good commit
SHA (`git log --oneline`). Verify with `curl https://api.reservehub-hh.com/healthz`.
Emergency alternative: Render → service → Deploys → Rollback (skips tests).

### 5.3 Change configuration

Edit `render.yaml` → push with `[skip ci]` → Render → Blueprints → reservehub →
**Manual sync** → then run the pipeline so services rebuild with the new values.
Secrets (`sync: false`) are set in the Render dashboard, never in the file.

### 5.4 Run the alert test (Game Day)

See `docs/observability.md` → "Triggering the alert". Always set
`FAULT_ERROR_RATE` back to `0` afterwards.

## 6. Escalation

| Problem with | Status page / support |
|---|---|
| Render | Render dashboard → Help; status.render.com |
| Auth0 | Auth0 dashboard → Support; status.auth0.com |
| Grafana Cloud | grafana.com → Support; status.grafana.com |
| Calendarific | calendarific.com (community support on free plan) |
| Namecheap DNS | Namecheap live chat |
