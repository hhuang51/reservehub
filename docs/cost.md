# Cost estimate and budget controls (D11)

Prices checked on 2026-11-19 from each provider's pricing page. All amounts USD
per month. Domain price ($12.28/year) and Render charges are what was actually billed.

## Current bill (1×, measured)

| Item | Plan | Monthly cost |
|---|---|---|
| Production API (`reservehub-api`) | Render Starter, 0.5 CPU / 512 MB | $7.00 |
| Production disk (SQLite) | Render persistent disk, 1 GB × $0.25/GB | $0.25 |
| Staging API (`reservehub-api-staging`) | Render Free (sleeps after 15 min idle) | $0.00 |
| Both websites | Render static sites | $0.00 |
| Render workspace | Hobby: 5 GB outbound bandwidth, 2 custom domains, 500 pipeline minutes included | $0.00 |
| Extra custom domains | 5 hostnames used; 2 included, $0.25 each beyond. **Billed: $0.50** (Render counts 2 extra) | $0.50 |
| Domain `reservehub-hh.com` | Namecheap, **$12.28/year** ÷ 12 | $1.02 |
| Identity | Auth0 Free (up to 25,000 monthly active users) | $0.00 |
| Holiday data | Calendarific Free (500 calls/month, attribution required) | $0.00 |
| Observability | Grafana Cloud Free (10k metric series, 50 GB logs, 50 GB traces, 14-day retention) | $0.00 |
| CI/CD | GitHub Free (2,000 Actions minutes/month for private repos) | $0.00 |
| **Total (full month)** | | **$8.77** |

**Measured (Render → Billing, 2026-11-19):** month-to-date $0.75
(services $0.25, custom domains $0.50, pipeline minutes $0.00); projected
November total **$3.37**, lower than a full month because the paid service only
started on 2026-11-18 and Render prorates by the second. Arithmetic for a full
month: $7.00 + $0.25 + $0.50 + $1.02 = **$8.77**.

## Workload assumptions

ReserveHub is a room-booking tool for one building, used during business hours.

| Assumption | 1× | 10× | 100× |
|---|---|---|---|
| Daily active users | 100 | 1,000 | 10,000 |
| Sessions per month (1 session per daily user × 30 days) | 3,000 | 30,000 | 300,000 |
| API requests per session | 15 | 15 | 15 |
| API requests per month | 45,000 | 450,000 | 4,500,000 |
| Users who log in (schedulers), 20% of ~3× DAU monthly uniques | 60 MAU | 600 MAU | 6,000 MAU |
| Peak requests/second (9 h × 22 working days, 3× peak factor) | 0.19 | 1.9 | 19 |

Bytes per session:

- First visit (40% of sessions): 230 KB gzipped JavaScript + 1 KB HTML + 15 API
  responses × 2 KB = **261 KB**
- Repeat visit (60%): hashed assets come from the browser cache (cached for a
  year), so 1 KB HTML + 30 KB API = **31 KB**
- Average: 0.4 × 261 + 0.6 × 31 = **123 KB per session**

Monthly outbound bandwidth = sessions × 123 KB:

| | 1× | 10× | 100× |
|---|---|---|---|
| Bandwidth | 3,000 × 123 KB = **0.35 GB** | **3.5 GB** | **35.2 GB** |
| Over the 5 GB included | 0 | 0 | 30.2 GB |
| Overage at $0.15/GB | $0.00 | $0.00 | **$4.53** |

## Telemetry volume (Grafana Cloud free tier)

| | 1× | 10× | 100× | Free limit |
|---|---|---|---|---|
| Logs (1 line × 300 B per request) | 0.01 GB | 0.13 GB | 1.3 GB | 50 GB |
| Traces (≈10 spans ≈ 5 KB per request) | 0.2 GB | 2.1 GB | 21.5 GB | 50 GB |
| Health-check traces (Render probes every ~5 s, 2 environments, ~1 KB) | 1.0 GB | 1.0 GB | 1.0 GB | — |
| Traces total | **1.2 GB** | **3.1 GB** | **22.5 GB** | 50 GB |
| Metric series (do not grow with traffic: routes × status × buckets × 2 envs) | < 2,000 | < 2,000 | < 2,000 | 10,000 |

At 1× the health-check probes produce most of the trace volume. Excluding
`/healthz` from tracing is the first optimisation if the free tier ever tightens.

## Monthly cost at each scale

| Item | 1× | 10× | 100× |
|---|---|---|---|
| Production API | Starter $7.00 | Starter $7.00 | **Standard $25.00** (see below) |
| Disk 1 GB | $0.25 | $0.25 | $0.25 |
| Staging API | Free $0 | Free $0 | Starter $7.00 (no sleeping; matches production) |
| Static sites | $0 | $0 | $0 |
| Bandwidth overage | $0 | $0 | $4.53 |
| Extra custom domains | $0.50 | $0.50 | $0.50 |
| Auth0 (60 / 600 / 6,000 MAU vs 25,000 free) | $0 | $0 | $0 |
| Calendarific (≤ 120 calls/month at any scale, see below) | $0 | $0 | $0 |
| Grafana Cloud (all within free limits above) | $0 | $0 | $0 |
| GitHub Actions (≈ 470 min/month, independent of traffic) | $0 | $0 | $0 |
| Domain ($12.28/year) | $1.02 | $1.02 | $1.02 |
| **Total** | **$8.77** | **$8.77** | **$38.30** |

### Why cost is flat from 1× to 10×

Render bills fixed instance prices, not per request. At 10× the peak is about
2 requests/second; each API request takes about 1 ms of server time (seen in
traces), so the Starter instance is far from busy, and bandwidth (3.5 GB) is
still inside the 5 GB included.

### What changes at 100×

- **Live-update connections.** At 10,000 DAU, perhaps 5% (500 people) have the page
  open at once. Today each open page has its own SSE connection that queries
  SQLite every 2 seconds: 500 × 2 queries ÷ 2 s = **500 queries/second** just for
  change detection. That needs more CPU (Standard: 1 CPU, 2 GB) **and** a code
  change: one shared poller that broadcasts to all connections (1 query/2 s total).
- **No horizontal scaling with SQLite.** A Render disk attaches to one instance,
  so the API cannot run multiple copies. Beyond 100× the database would move to
  managed Postgres (from about $7–20/month on Render) to allow several instances.
- **Rate limits** are kept in memory per instance; multiple instances would
  need a shared store (Render Key Value / Redis).

### Usage that does not grow with traffic

- **Calendarific:** the server caches each year's holidays for 24 hours and
  shares one in-flight request, so calls are at most 2 years × 30 days ×
  2 environments ≈ **120 per month**, well under 500, regardless of users.
- **GitHub Actions:** each deploy run is about 22 minutes (mostly waiting for the
  free staging service to start). At 20 deploys/month: 440 min + 30 daily
  certificate checks × 1 min = **470 of 2,000 minutes**.

## Budget alerts and free-tier evidence

| Provider | Control | Evidence to capture |
|---|---|---|
| GitHub | Settings → Billing and licensing → **Budgets and alerts**: Actions budget $0 with alerts at 75%/90%/100% | Screenshot of the budget |
| Render | Fixed instance prices; only bandwidth is variable. Usage shown under Billing | Screenshot of Billing → current month |
| Grafana Cloud | Free plan, no payment method on file, so it cannot bill | Screenshot of the plan/usage page |
| Auth0 | Free plan, no payment method | Screenshot of Settings → Subscription |
| Calendarific | Free plan, hard 500-call limit | Screenshot of the account dashboard usage |
| Namecheap | One-time annual charge; auto-renew off | Screenshot of the domain's renewal setting |

## Cost risks

- **Render bandwidth** is the only uncapped variable charge. A traffic spike or
  scraping of the public schedule could add $0.15/GB. Mitigations: hashed assets
  cached for a year, rate limits on writes and the holiday endpoint.
- **Grafana free limits**: if exceeded, ingestion is throttled rather than billed
  (no card on file). Mitigation: exclude `/healthz` traces.
- **Staging sleeping** (free tier) makes the pipeline wait ~16 minutes per deploy;
  this costs GitHub minutes, not money, at current volume.
