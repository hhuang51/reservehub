# Architecture: request path and trust boundaries (Q2)

GitHub renders these Mermaid diagrams when the file is viewed in the repository.

## 1. Request path

```mermaid
flowchart LR
    U([User's browser])

    subgraph Edge["Render edge: Cloudflare + load balancer (TLS, DDoS)"]
        direction TB
        E1[www / staging<br/>static hosting + CDN]
        E2[api / api-staging<br/>proxy]
    end

    subgraph API["Render web service: reservehub-api (Node.js / Express)"]
        direction TB
        MW["middleware: request log → security headers → cache policy<br/>→ CORS → JSON parse → rate limit"]
        AUTH["checkJwt: signature (JWKS), issuer,<br/>audience, expiry → scopes → role"]
        ROUTES["REST routes · MCP endpoint (/mcp)<br/>· SSE (/api/events) · /healthz"]
        DB[("SQLite on disk<br/>/var/data (prod)")]
        MW --> AUTH --> ROUTES --> DB
    end

    A0[(Auth0<br/>identity provider)]
    CAL[(Calendarific<br/>holiday API)]
    GR[(Grafana Cloud<br/>OTLP + Faro)]

    U -- "1 GET page, JS (hashed, cached 1 y)" --> E1
    U -- "2 login: Authorization Code + PKCE, state, nonce" --> A0
    A0 -- "3 access token (JWT, RS256)" --> U
    U -- "4 fetch + Bearer token + traceparent" --> E2
    E2 --> MW
    U -- "5 SSE: revision notifications" --> E2
    AUTH -. "JWKS (public keys, cached)" .-> A0
    ROUTES -- "server-side, key in env, 5 s timeout, 1 retry, 24 h cache" --> CAL
    API -- "traces, metrics, logs (OTLP/HTTP, auth header)" --> GR
    U -- "Web Vitals, errors, browser spans" --> GR
```

Step by step for "make a reservation":

1. The browser loads the static site from `www.reservehub-hh.com`.
2. "Log in" redirects to Auth0 (Authorization Code + PKCE, with `state` and
   `nonce`); Auth0 redirects back with a code, and the SDK exchanges it for an
   access token for audience `https://reservehub-api`.
3. The form calls `POST https://api.reservehub-hh.com/api/reservations` with
   `Authorization: Bearer <token>` and a `traceparent` header.
4. Render's edge terminates TLS and forwards to the API.
5. The API: logs the request, adds security headers, checks CORS (exact origin),
   parses JSON (16 KB limit), applies the write rate limit (keyed by
   `CF-Connecting-IP`), validates the JWT, checks `write:reservations` and the
   `scheduler` role, validates the body, then inserts the reservation and its
   audit event in one SQLite transaction (database triggers reject overlaps
   and closures).
6. Other open pages learn about the change through the SSE stream and refetch.
7. Spans from the browser and the API share one trace in Grafana.

MCP path: the MCP panel calls `POST /mcp` (tools) and `POST /mcp/confirmations`
(preview). Each tool checks its own scope; `create_reservation` needs a
single-use, user-bound, 5-minute confirmation ID and then calls the REST route
above over loopback, so the same validation and audit apply.

## 2. Trust boundaries

```mermaid
flowchart TB
    subgraph Z0["UNTRUSTED: internet"]
        B([Browser, any user or script])
        X([Other origins / attackers])
    end

    subgraph Z1["PLATFORM: Render edge (trusted for TLS + client IP)"]
        CF[Cloudflare + Render LB]
    end

    subgraph Z2["TRUSTED: ReserveHub API process"]
        V["Boundary checks:<br/>CORS exact origin · body size · rate limit<br/>JWT signature/iss/aud/exp · scopes · role<br/>input validation · MCP confirmation binding"]
        L[Business logic]
        D[("SQLite: constraints, triggers,<br/>append-only audit")]
        V --> L --> D
    end

    subgraph Z3["THIRD PARTIES"]
        A0[(Auth0: trusted issuer of identity)]
        CAL[(Calendarific: untrusted data)]
        GR[(Grafana: receives telemetry only)]
    end

    subgraph Z4["DELIVERY: build and deploy"]
        GH[GitHub Actions<br/>deploy-hook secrets]
        RD[Render dashboard<br/>runtime secrets]
    end

    B -- "HTTPS" --> CF
    CF -- "X-Forwarded-For, CF-Connecting-IP" --> V
    X -. "blocked by CORS / 401 / 403 / 429" .-> CF
    V -. "verify token with JWKS" .-> A0
    L -- "response validated before use" --> CAL
    Z2 -- "no secrets, no personal data in spans" --> GR
    GH -- "deploy exact commit" --> Z2
    RD -- "env vars (keys, OTLP header)" --> Z2
```

| Boundary | What crosses it | What we trust | How it is enforced |
|---|---|---|---|
| Internet → Render edge | All traffic | Nothing from the client | HTTPS only (HSTS), Render DDoS protection |
| Edge → API | Requests + forwarding headers | `CF-Connecting-IP` (set by Cloudflare, client copies overwritten; API not reachable except via the edge) | `server/client-ip.cjs`; ignored when not on Render |
| Client data → business logic | Headers, JSON bodies, query strings, tokens | Only verified JWT claims | `checkJwt` (signature, issuer, audience, expiry), scope + role checks, `validation.cjs`, 16 KB body limit |
| Browser origin → API | Cross-origin requests | Exactly one origin per environment | CORS `FRONTEND_ORIGIN`; MCP also rejects other `Origin`s |
| API → Calendarific | Outgoing request with key in URL | Nothing in the response | Runtime validation of every field, year check, 5 s timeout, bounded retry, key never logged |
| API → Grafana | Telemetry | n/a (outbound only) | No tokens or request bodies in spans or logs; auth header from env |
| Delivery → runtime | Code + configuration | GitHub repo `main`, Render secrets | Tests + staging gate before production; secrets only in Render/GitHub, `.env` and databases git-ignored |
| Database | Writes | Only the API process | Constraints, overlap/closure triggers, append-only audit triggers |
