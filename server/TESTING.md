# Running the tests

From the `server` folder:

```
npm install
npm test
```

`npm test` runs every `tests/**/*.test.cjs` file with Node's built-in test runner
(Node 22.13 or newer; no extra test packages). No network, Auth0, or Calendarific
access is needed: the holiday provider is stubbed and the database tests use the
real migrations on an in-memory SQLite database.

| File | Requirement | What it proves |
|---|---|---|
| `validation.test.cjs` | Q1 validation | Field, weekday, hours, and past-time rules (fixed clock, Chicago time zone) |
| `authorization.test.cjs` | Q1 authorization, F9, F12 | Scope and role checks; read-only tokens cannot write; standard 403 shape |
| `holidays.test.cjs` | Q1 stubbed integration, F10 | Timeout, bounded retry, cache, cooldown, stale/unavailable outage policy, key redaction |
| `schedule.test.cjs` | Q1 core calculation, F4–F6 | Interval overlap, availability, closures, constraints, append-only audit |
| `reservation-migration.test.cjs` | F4 reversible migration | Existing migration up/down test |

Each test file starts with a comment listing the outcomes predicted by hand
before the tests were run.

To show a deliberate failure for your evidence, change one expected value
(for example `[2]` to `[1, 2]` in `schedule.test.cjs`), run `npm test`, save
the output, then revert.
