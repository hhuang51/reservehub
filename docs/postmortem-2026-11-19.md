# Postmortem: staging API returning 503s (induced failure), 2026-11-19

**Type:** intentionally induced failure (Game Day) to verify detection and alerting.
**Status:** resolved. **Severity:** staging only; no production impact.
**Author:** <your name>. Blameless format: the focus is on systems, not people.

## Summary

To test the availability SLO alert, the fault-injection switch was turned on
for the staging API (`FAULT_ERROR_RATE=0.5`), making about half of public
room-list requests fail with HTTP 503. The alert detected the problem within
about 3 minutes, as designed. **But nobody was notified for about 7 more
minutes**, because the alert rule was routed to a provisioned Grafana webhook
instead of an email contact point. The routing was fixed during the test, the
email arrived, and the alert resolved by itself after the fault was switched off.

## Impact

- **Staging:** about 50% of `GET /api/rooms` requests returned 503 for about 12 minutes
  (peak error ratio 0.54 in the alert graph).
- **Production:** none. The fault-injection code ignores `FAULT_ERROR_RATE` when
  `APP_ENV=production` (unit-tested in `server/tests/fault-injection.test.cjs`),
  and the production error ratio stayed at 0.
- **Error budget:** staging only; production budget untouched.

## Timeline (America/Chicago)

| Time | Event |
|---|---|
| ~20:37 | `FAULT_ERROR_RATE` set to `0.5` on `reservehub-api-staging` (Render → Environment → Save and deploy). |
| ~20:38 | Traffic generator started: 1 request/second to `https://api-staging.reservehub-hh.com/api/rooms`. Output shows a mix of `200` and `503`. |
| 20:38:30 | First 5xx visible in metrics; staging error ratio 0.37, above the 0.10 threshold. Alert **Pending**. |
| ~20:41 | Alert **Firing** for `job="reservehub/reservehub-api-staging"` (error ratio ≈ 0.52). **Detection: ~3 min.** |
| 20:41–20:47 | No notification received. Rule page showed *"Notifications are delivered to grafana-insight-processor"*, a provisioned webhook, not a person. |
| ~20:46 | Email contact point **"ReserveHub email"** created; test notification sent successfully; rule re-routed to it. |
| 20:47:40 | Grafana sends `[FIRING:1] ReserveHub API error budget burn … reservehub-api-staging`; received 20:48. **Time to notify a human: ~7 min after firing.** |
| ~20:48 | `FAULT_ERROR_RATE` set back to `0`; staging redeployed. Traffic generator stopped. |
| 20:58 | `[RESOLVED]` email received (reason `NoData`: no 5xx left, treated as Normal by design). |

## Detection and diagnosis

- **Metrics** (`http_server_request_duration_seconds_count` by status code)
  showed the error ratio jump from 0 to about 0.5 on staging only.
- **Logs** in Loki: `{service_name="reservehub-api-staging"} |= "injected fault"`
  showed each failure with its `trace_id`.
- **Traces**: the Tempo Service Graph showed a 0.084 error rate on
  `GET /api/rooms` for the staging service while production stayed at 0.

All three signals agreed within a minute, so diagnosis was immediate.

## Root cause

**Of the outage:** deliberate (fault injection), as planned.

**Of the late notification:** the alert rule was created with Grafana's
pre-selected contact point, `grafana-insight-processor`, which Grafana Cloud
provisions automatically for its own analysis features. It is a webhook, it
cannot be edited, and it does not notify anyone. The rule had never been tested
end to end, so the gap only showed up during a real firing.

## What went well

- The SLO alert logic worked: correct threshold, correct environment label,
  2-minute pending period avoided noise, and auto-resolve worked.
- The fault was confined to staging by code, not just by convention, and that is
  covered by a unit test.
- Logs, metrics, and traces were correlated by `trace_id` and service name,
  so diagnosis took seconds.

## What went wrong

- No human was notified for ~7 minutes after firing.
- The notification path had not been tested when the rule was created.

## Action items

| # | Action | Status |
|---|---|---|
| 1 | Create an email contact point and route the SLO alert to it | Done 2026-11-19 |
| 2 | Send a test notification whenever a contact point or route changes | Done (test email received); added to runbook §5.4 |
| 3 | Make "trigger the alert in staging and confirm a human receives it" part of the Game Day checklist | Done (`docs/observability.md`) |
| 4 | Add a second notification channel (e.g. phone push via Grafana OnCall/IRM) so one missed inbox does not delay response | Open |
| 5 | Manage alert rules and contact points as code (Grafana Terraform provider or provisioning files) so routing is reviewed like code | Open |

---

## Appendix: real incidents found during rollout (same week)

These were not induced, but each was caught by a safeguard and fixed.

| # | What happened | Caught by | Cause | Fix |
|---|---|---|---|---|
| A | First pipeline run failed at staging after 15 min; production untouched | Pipeline `/healthz` gate | Free staging API needed ~16 min to build and start | Staging wait raised to 30 min; production still 15 min |
| B | Pipeline could not reach staging (`no response`) despite a healthy service | Pipeline gate | Trailing space pasted into the GitHub `API_URL` variable produced a malformed URL | Variable re-entered; `wait-for-deploy.sh` now strips whitespace |
| C | Rate limit never triggered in production (35 × `200`) | Manual S1 test | Behind Cloudflare/Render the app saw rotating proxy IPs, so every request had a new key | Key by `CF-Connecting-IP` on Render (`server/client-ip.cjs`, unit-tested); retest showed 30 × `200` then `429` |
| D | Certificate check failed for the apex domain only | Daily certificate expiry check (first run) | Namecheap's default URL Redirect record on `@` coexisted with the A record, sending some clients to a host without a certificate | Redirect record deleted; check passes for all 5 hosts |
