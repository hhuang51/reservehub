# Redaction attestation (Q4)

I, ____________________, attest that for the ReserveHub submission:

- [ ] No secrets are committed to the repository. `.env`, `.env.local`, and all
      `*.sqlite` files are listed in `.gitignore`, and
      `git log --all -- server/.env` shows no history for the server `.env` file.
- [ ] Secrets exist only in Render environment variables and GitHub environment
      secrets: `CALENDARIFIC_API_KEY`, `OTEL_EXPORTER_OTLP_HEADERS`,
      `OTEL_EXPORTER_OTLP_ENDPOINT`, `RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOK_WEB`.
- [ ] Every screenshot and log excerpt in `evidence/` was checked, and tokens,
      API keys, deploy-hook URLs, Authorization headers, and personal email
      addresses were removed or blurred.
- [ ] The application never logs credentials: the Calendarific URL (which contains
      the key) is never logged (`server/holidays.cjs`, tested in
      `server/tests/holidays.test.cjs`), and request logs contain only method,
      route, status, duration, and trace IDs.
- [ ] The Calendarific API key was shared in an AI chat session during
      development. It was **rotated** on ____ (date) and the new key exists only in
      Render.
- [ ] Values that look sensitive but are public by design are left visible:
      the Auth0 domain and client ID (public SPA configuration) and the Grafana
      Faro collector URL (sent from every browser).

Signed: ____________________  Date: ____________
