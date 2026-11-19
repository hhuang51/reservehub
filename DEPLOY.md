# Deploying ReserveHub to Render

Two environments, each with its own API, static site, data, and secrets:

| | Staging | Production |
|---|---|---|
| API | `reservehub-api-staging` (free, SQLite resets on deploy) | `reservehub-api` (Starter + 1 GB disk at `/var/data`) |
| Web | `reservehub-web-staging` (static) | `reservehub-web` (static) |
| Deploys | Only from GitHub Actions, after tests | Only from GitHub Actions, after staging passes |

Everything is defined in `render.yaml` (infrastructure as code) and
`.github/workflows/deploy.yml` (pipeline).

---

## 0. Before the first push (on your computer)

1. Add these lines to the repository's root `.gitignore`:

   ```
   .env
   *.sqlite
   *.sqlite-journal
   ```

2. Make sure secrets and databases were never committed:

   ```
   git rm --cached server/.env server/*.sqlite
   ```

   ("did not match any files" is good news.) If `server/.env` was ever
   pushed, treat the Calendarific key as public and generate a new one.

3. Update the server lockfile and run the tests:

   ```
   cd server
   npm install
   npm test
   cd ..
   npm run build
   ```

4. Commit and push to `main` on GitHub. The pipeline will fail at the
   staging step until step 3 below is done; that is expected.

## 1. Create the services on Render

1. Render Dashboard → **New → Blueprint** → choose the GitHub repository.
2. Render reads `render.yaml` and shows the `reservehub` project with
   `staging` and `production` environments. When asked, enter:
   - `CALENDARIFIC_API_KEY` for each API (use a separate key for staging
     if you can; that makes "separate secrets" easy to show)
   - `VITE_AUTH0_CLIENT_ID` for each static site (the value from
     `.env.local`)
3. Confirm. Production asks for a payment method (Starter plan + disk).
4. Open each service and note its URL. If any URL is not exactly
   `https://<service-name>.onrender.com`, update `VITE_API_URL`,
   `FRONTEND_ORIGIN`, and the `connect-src` part of the
   Content-Security-Policy in `render.yaml`, push, and sync the Blueprint.

## 2. Allow the new URLs in Auth0

Auth0 Dashboard → Applications → your SPA → Settings. Add both web URLs
(keep `http://localhost:5173`):

- **Allowed Callback URLs**
- **Allowed Logout URLs**
- **Allowed Web Origins**

```
http://localhost:5173, https://reservehub-web-staging.onrender.com, https://reservehub-web.onrender.com
```

## 3. Connect the pipeline

GitHub repository → **Settings → Environments**. Create `staging` and
`production`. In each, add:

| Kind | Name | Value |
|---|---|---|
| Secret | `RENDER_DEPLOY_HOOK_API` | That environment's API: Render → service → Settings → Deploy Hook |
| Secret | `RENDER_DEPLOY_HOOK_WEB` | That environment's static site deploy hook |
| Variable | `API_URL` | e.g. `https://reservehub-api-staging.onrender.com` |
| Variable | `WEB_URL` | e.g. `https://reservehub-web-staging.onrender.com` |

Deploy hook URLs are secrets: anyone with one can trigger a deploy.

Optional: on `production`, turn on **Required reviewers** so production
waits for your approval.

## 4. Run it

Push any commit to `main`, or Actions → **Test and deploy** → Run workflow.
The run summary records the commit SHA, run ID, and verification times.
Screenshot it for D5.

Check by hand:

```
curl -i https://reservehub-api.onrender.com/healthz
curl -I https://reservehub-web.onrender.com/
curl https://reservehub-web.onrender.com/version.json
```

`/healthz` and `/version.json` both report the deployed commit.

## 5. Rollback demonstration

1. Note the current commit: `curl https://reservehub-api.onrender.com/healthz`.
2. Actions → **Test and deploy** → Run workflow → enter the **previous**
   commit SHA (`git log --oneline`).
3. When the run finishes, `/healthz` shows the older commit. Save the
   output.
4. Run the workflow again with no SHA (or push) to roll forward.

Render's dashboard also has a one-click **Rollback** on each service's
Deploys page, which is faster in an emergency but skips the tests.

Database note: migrations only move forward. Rolling back across a commit
that added a migration makes the older code stop at startup ("requires a
newer server version"), so check `git log -- server/migrations.cjs` first.

## Environment variables reference

| Variable | Where | Purpose |
|---|---|---|
| `APP_ENV` | API | `staging` / `production`, shown in `/healthz` |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` | API | Token validation |
| `FRONTEND_ORIGIN` | API | Exact-origin CORS allowlist |
| `CALENDARIFIC_API_KEY` | API | Holiday provider key (secret) |
| `TRUST_PROXY` | API | `1` on Render, so rate limits see the real client IP |
| `DATABASE_PATH`, `HOLIDAY_CACHE_PATH`, `MCP_AUDIT_PATH` | Production API | SQLite files on the persistent disk |
| `RATE_LIMIT_*_PER_MINUTE` | API (optional) | Override limits (e.g. lower for the S1 demo) |
| `VITE_API_URL`, `VITE_AUTH0_*` | Static sites | Baked in at build time |
