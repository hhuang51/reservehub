# Observability, SLI/SLO, and alerting (D10)

Backend: **Grafana Cloud** (stack `tanlime2726`, free tier) receiving OpenTelemetry
over OTLP/HTTP from both APIs on Render.

| Signal | How it is produced | Where to see it |
|---|---|---|
| Traces | OpenTelemetry Node.js auto-instrumentation (`server/otel.cjs`): HTTP server, Express routes, outgoing `fetch` (Calendarific, MCP → REST) | Explore → `grafanacloud-tanlime2726-traces` (Tempo) |
| Metrics | Same SDK: `http.server.request.duration` histogram, `http.client.request.duration`, plus the business counter `reservehub.reservation.changes` (`server/telemetry.cjs`) | Explore → `grafanacloud-tanlime2726-prom` |
| Logs | `server/telemetry.cjs`: one JSON line per request to stdout **and** OTLP, each with `trace_id`/`span_id` | Explore → `grafanacloud-tanlime2726-logs` (Loki), Render → Logs |

Services are separated by `service.name`: `reservehub-api` (production) and
`reservehub-api-staging` (staging). In Prometheus these appear as
`job="reservehub/reservehub-api"` and `job="reservehub/reservehub-api-staging"`.

Credentials (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`) are Render
secrets, never in the repository. Telemetry is disabled when they are unset
(local development).

## Useful queries

Trace search without health checks (TraceQL):

```
{ resource.service.name = "reservehub-api" && name != "GET /healthz" }
```

Logs for production, errors only (LogQL):

```
{service_name="reservehub-api"} | json | level="error"
```

Request rate by status (PromQL):

```
sum by (http_response_status_code) (
  rate(http_server_request_duration_seconds_count{job="reservehub/reservehub-api", http_route!="/healthz"}[5m])
)
```

## SLI

**Availability SLI** = share of API requests that do not fail on the server side:

```
good  = requests with HTTP status < 500
valid = all requests except Render's /healthz probes
SLI   = good / valid
```

4xx responses (validation errors, 401/403, 404, 429 rate limits) are the client's
problem, not an outage, so they count as good. Health-check probes are excluded
because they arrive every few seconds and would hide real-user failures.

PromQL (error ratio over 5 minutes, per environment):

```
sum by (job) (rate(http_server_request_duration_seconds_count{job=~"reservehub/reservehub-api.*", http_route!="/healthz", http_response_status_code=~"5.."}[5m]))
/
sum by (job) (rate(http_server_request_duration_seconds_count{job=~"reservehub/reservehub-api.*", http_route!="/healthz"}[5m]))
```

**Latency SLI (tracked, no alert)**: share of requests faster than 500 ms:

```
sum(rate(http_server_request_duration_seconds_bucket{job="reservehub/reservehub-api", http_route!="/healthz", le="0.5"}[1h]))
/
sum(rate(http_server_request_duration_seconds_count{job="reservehub/reservehub-api", http_route!="/healthz"}[1h]))
```

## SLO

| SLO | Target | Window | Error budget |
|---|---|---|---|
| Availability | **99%** of valid requests succeed | rolling 7 days | 1% of requests |
| Latency | 95% of valid requests < 500 ms | rolling 7 days | 5% of requests |

Why 99%: a single Render instance with SQLite has no failover; a deploy on the
disk-backed service causes a short restart. 99% (about 1 h 41 min of full outage
per week) is achievable and still meaningful for a room-booking tool used during
business hours.

Error budget arithmetic (example at 1×, 2,000 valid requests/week):
1% × 2,000 = **20 failed requests per week** before the SLO is breached.

## Alert

Grafana-managed alert rule **"ReserveHub API error budget burn"**:

- Query: the error-ratio PromQL above (one alert instance per environment).
- Condition: error ratio **> 0.10** (10%).
- Evaluated every 1 minute; must hold for **2 minutes** before firing.
- No data → **Normal** (no 5xx at all produces no numerator series).
- Contact point: email to the project owner.

Why 10%: that is a burn rate of 10× the 1% budget. At that rate the whole
weekly budget (7 days × 1% ≈ 1.7 h of failures) is gone in about **17 hours**,
fast enough to need attention, slow enough that a single failed request or a
brief restart does not page anyone.

## Triggering the alert (demonstration)

The staging API has a fault switch (`server/fault-injection.cjs`), ignored in
production by the code and by a unit test:

1. Render → `reservehub-api-staging` → Environment → `FAULT_ERROR_RATE` = `0.5` → save.
2. Generate traffic for ~6 minutes:

   ```powershell
   1..360 | ForEach-Object {
     curl.exe -s -o NUL -w "%{http_code}`n" "https://api-staging.reservehub-hh.com/api/rooms"
     Start-Sleep -Seconds 1
   }
   ```

3. About half the responses are `503`. Within ~5–7 minutes the alert goes
   Pending → Firing for `job="reservehub/reservehub-api-staging"` and the email
   arrives.
4. Set `FAULT_ERROR_RATE` back to `0`. The alert resolves after the 5-minute
   window clears (a "Resolved" email is sent).

Evidence to keep: the alert rule page, the Firing state, the email, the
error-ratio graph during the test, a trace of a failed request, and the matching
`injected fault` log line (same `trace_id`).
