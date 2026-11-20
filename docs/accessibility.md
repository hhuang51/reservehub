# Accessibility (D9) and Core Web Vitals (D8)

## Method

- **Automated:** Chrome Lighthouse (uses the axe-core rule engine), Mobile,
  Incognito (no extensions), against production `https://www.reservehub-hh.com`.
- **Automated, logged-in states:** Lighthouse **Snapshot** mode after logging
  in, opening a room, opening the reservation preview, and opening the MCP panel
  (Navigation mode only sees the first screen).
- **Manual keyboard test:** mouse unplugged; only `Tab`, `Shift+Tab`, `Enter`,
  `Space`, arrow keys.

## Automated results

| Run | Date | Commit | Accessibility | Notes |
|---|---|---|---|---|
| Navigation, first screen | 2026-11-19 21:30 | (from `/version.json`) | **100** | No failing audits |
| Snapshot, logged in + room details + preview | | | | |
| Snapshot, MCP panel open | | | | |

Lighthouse checks only what it can detect automatically (names, labels,
contrast, landmarks, ARIA validity); the manual tests below cover the rest.

## Keyboard test (manual, 2026-11-19)

| Task | Result |
|---|---|
| Reach Log in, search box, capacity and equipment filters, availability form, "Find available rooms", each room's "View details" | Pass |
| Focus visible at every step | Pass |
| Log in, open a room, preview and save a reservation with keyboard only | Pass |
| Order follows the visual order (no focus jumps) | Pass |
| No keyboard traps (can always Tab out of forms, dialogs, and the MCP panel) | Pass |

## Design choices that support accessibility

- Every input has a `<label htmlFor>`; form groups use `<fieldset>`/`<legend>`.
- Loading and results messages use `role="status"`; errors use `role="alert"`,
  so screen readers announce them without moving focus.
- Buttons are real `<button type="button">` elements, so Enter/Space work natively.
- "View details" buttons set `aria-expanded` and `aria-controls`.
- Times are always labelled "Chicago local time"; nothing relies on color alone.
- Confirmation dialogs for destructive actions (cancel, reopen) use the native
  `window.confirm`, which is keyboard- and screen-reader-accessible.

## Core Web Vitals (D8)

Lighthouse Mobile, Incognito, production.

| Metric | Before (2026-11-19 21:30, 1 run) | After (2026-11-19 21:47, 1 run) | Change |
|---|---|---|---|
| Performance score | 94 | 86 | −8 |
| First Contentful Paint | 2.4 s | 3.0 s | +0.6 s (worse) |
| Largest Contentful Paint | 2.5 s | 3.4 s | +0.9 s (worse) |
| Total Blocking Time | 20 ms | 20 ms | no change |
| Cumulative Layout Shift | 0 | 0 | no change |
| Speed Index | 2.4 s | 3.0 s | +0.6 s (worse) |
| Main JS bundle (from `npm run build`) | 785.79 kB (227.01 kB gzip) | _fill in from build output_ | |
| Accessibility score | 100 | 100 | no change |
| Best Practices score | 96 | 96 | no change |

**Change made:** the MCP panel (MCP SDK + zod, the largest dependencies) is
loaded with `React.lazy` only when the user clicks "Open MCP panel", and browser
telemetry (Faro + OpenTelemetry web) is loaded with a dynamic `import()` in
parallel instead of in the main bundle (`src/App.tsx`, `src/main.tsx`). The
first screen needs neither.

**Why FCP was the target:** it was the only metric outside the green range.
Before first paint the browser had to download and parse one 786 kB bundle;
splitting removes code the first screen never uses.

**Interpretation of the result.** The first "after" run was slower, not
faster. Likely reasons, in order of how much evidence there is:

1. **Measurement noise.** Each column is a single Lighthouse run with simulated
   slow-4G throttling; run-to-run variation of 0.5–1 s in FCP/LCP is common.
   TBT and CLS, which do not depend on network timing, are unchanged.
2. **Deployment timing.** The after run was taken shortly after pushing; it
   must be confirmed that `/version.json` already reported the new commit.
3. **A real side effect of the change.** The telemetry chunk was requested
   immediately at startup, so on the throttled connection it competed with the
   main bundle for bandwidth before first paint.

**Follow-up:** telemetry is now loaded only after the `load` event
(`src/main.tsx`), so it can no longer compete with first paint. A fair
comparison takes the median of 3 runs per version, on a confirmed deploy.

**Field data:** Faro also reports real-user Web Vitals to Grafana
(Observability → Frontend → reservehub-web), for users without ad blockers.
