// Stubbed Calendarific integration: no network, fake clock, in-memory cache.
//
// Hand-predicted outcomes (provider calls in brackets):
//   success                        -> fresh, 2 unique holidays, sorted   [1]
//   repeat within 24 h             -> fresh from cache                   [0]
//   repeat after 24 h              -> refetch                            [1]
//   401 bad key                    -> unavailable, no retry              [1]
//   503 then success               -> fresh after one retry              [2]
//   timeout twice                  -> unavailable                        [2]
//   malformed body                 -> unavailable, no retry              [1]
//   old cache + provider down      -> stale, old data kept               [2]
//   failure, again after 30 s      -> cooldown, no call                  [0]
//   failure, again after 61 s      -> tries again                        [1]
//   two simultaneous requests      -> one shared provider call           [1]
//   no API key configured          -> unavailable                        [0]
//   any failure                    -> log never contains the API key

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CACHE_DURATION,
  FAILURE_COOLDOWN,
  openHolidayCache,
  createHolidayService,
} = require("../holidays.cjs");

const API_KEY = "test-key-SHOULD-NOT-APPEAR";
const YEAR = 2026;

const goodBody = {
  meta: { code: 200 },
  response: {
    holidays: [
      { name: "Christmas Day", date: { iso: "2026-12-25" }, type: ["National holiday"] },
      { name: "Thanksgiving Day", date: { iso: "2026-11-26" }, type: ["National holiday"] },
      // Duplicate entry, as providers sometimes return.
      { name: "Thanksgiving Day", date: { iso: "2026-11-26" }, type: ["National holiday"] },
    ],
  },
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timeoutError() {
  return Object.assign(new Error(`timeout fetching ?api_key=${API_KEY}`), {
    name: "TimeoutError",
  });
}

// `responses` is a list of functions, one per expected provider call.
function setup(responses, { apiKey = API_KEY } = {}) {
  let clock = 1_800_000_000_000;
  const calls = [];
  const logs = [];
  let sleeps = 0;

  const service = createHolidayService({
    cache: openHolidayCache(":memory:"),
    getApiKey: () => apiKey,
    now: () => clock,
    sleep: async () => {
      sleeps += 1;
    },
    log: { error: (message) => logs.push(message) },
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      const next = responses.shift();
      if (!next) throw new Error("Unexpected extra provider call.");
      return next();
    },
  });

  return {
    service,
    calls,
    logs,
    get sleeps() {
      return sleeps;
    },
    advance(ms) {
      clock += ms;
    },
    get now() {
      return clock;
    },
  };
}

test("success: fresh, deduplicated, sorted, correct request", async () => {
  const t = setup([() => jsonResponse(200, goodBody)]);
  const result = await t.service.getHolidays(YEAR);

  assert.equal(result.status, "fresh");
  assert.deepEqual(result.holidays, [
    { name: "Thanksgiving Day", date: "2026-11-26" },
    { name: "Christmas Day", date: "2026-12-25" },
  ]);
  assert.equal(result.fetchedAt, t.now);
  assert.equal(t.calls.length, 1);

  const { url, options } = t.calls[0];
  assert.equal(url.searchParams.get("country"), "US");
  assert.equal(url.searchParams.get("year"), "2026");
  assert.equal(url.searchParams.get("type"), "national");
  assert.ok(options.signal instanceof AbortSignal, "request has a timeout signal");
});

test("cache: served within 24 h, refetched after", async () => {
  const t = setup([
    () => jsonResponse(200, goodBody),
    () => jsonResponse(200, goodBody),
  ]);

  await t.service.getHolidays(YEAR);
  t.advance(CACHE_DURATION - 1);
  assert.equal((await t.service.getHolidays(YEAR)).status, "fresh");
  assert.equal(t.calls.length, 1);

  t.advance(2);
  assert.equal((await t.service.getHolidays(YEAR)).status, "fresh");
  assert.equal(t.calls.length, 2);
});

test("401 bad key: unavailable, not retried, status logged without key", async () => {
  const t = setup([() => jsonResponse(401, { meta: { code: 401 } })]);
  const result = await t.service.getHolidays(YEAR);

  assert.deepEqual(result, { holidays: [], fetchedAt: null, status: "unavailable" });
  assert.equal(t.calls.length, 1);
  assert.equal(t.sleeps, 0);
  assert.match(t.logs[0], /HTTP 401/);
  assert.ok(!t.logs.join("\n").includes(API_KEY));
});

test("503 then success: one bounded retry", async () => {
  const t = setup([
    () => jsonResponse(503, {}),
    () => jsonResponse(200, goodBody),
  ]);
  const result = await t.service.getHolidays(YEAR);

  assert.equal(result.status, "fresh");
  assert.equal(t.calls.length, 2);
  assert.equal(t.sleeps, 1);
});

test("timeouts: gives up after two attempts, key not leaked", async () => {
  const t = setup([
    () => Promise.reject(timeoutError()),
    () => Promise.reject(timeoutError()),
  ]);
  const result = await t.service.getHolidays(YEAR);

  assert.equal(result.status, "unavailable");
  assert.equal(t.calls.length, 2);
  assert.match(t.logs[0], /timed out/);
  assert.ok(!t.logs.join("\n").includes(API_KEY));
});

test("malformed provider bodies are rejected without retry", async () => {
  const bodies = [
    { meta: { code: 500 }, response: {} },
    { meta: { code: 200 }, response: { holidays: "nope" } },
    { meta: { code: 200 }, response: { holidays: [{ date: { iso: "2026-11-26" }, type: [] }] } },
    { meta: { code: 200 }, response: { holidays: [{ name: "X", date: { iso: "2026-02-30" }, type: [] }] } },
    // Holiday from the wrong year.
    { meta: { code: 200 }, response: { holidays: [{ name: "X", date: { iso: "2025-12-25" }, type: [] }] } },
  ];

  for (const body of bodies) {
    const t = setup([() => jsonResponse(200, body)]);
    const result = await t.service.getHolidays(YEAR);
    assert.equal(result.status, "unavailable", JSON.stringify(body));
    assert.equal(t.calls.length, 1);
  }
});

test("non-JSON response is treated as an outage", async () => {
  const t = setup([() => new Response("<html>gateway</html>", { status: 200 })]);
  assert.equal((await t.service.getHolidays(YEAR)).status, "unavailable");
  assert.equal(t.calls.length, 1);
});

test("old cache + provider down: serve stale data", async () => {
  const t = setup([
    () => jsonResponse(200, goodBody),
    () => jsonResponse(500, {}),
    () => jsonResponse(500, {}),
  ]);

  const first = await t.service.getHolidays(YEAR);
  t.advance(CACHE_DURATION + 1);
  const second = await t.service.getHolidays(YEAR);

  assert.equal(second.status, "stale");
  assert.deepEqual(second.holidays, first.holidays);
  assert.equal(second.fetchedAt, first.fetchedAt);
  assert.equal(t.calls.length, 3);
});

test("failure cooldown: no provider calls for 60 s", async () => {
  const t = setup([
    () => jsonResponse(500, {}),
    () => jsonResponse(500, {}),
    () => jsonResponse(200, goodBody),
  ]);

  await t.service.getHolidays(YEAR);
  assert.equal(t.calls.length, 2);

  t.advance(30_000);
  assert.equal((await t.service.getHolidays(YEAR)).status, "unavailable");
  assert.equal(t.calls.length, 2, "cooldown blocks the provider call");

  t.advance(FAILURE_COOLDOWN);
  assert.equal((await t.service.getHolidays(YEAR)).status, "fresh");
  assert.equal(t.calls.length, 3);
});

test("simultaneous requests share one provider call", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const t = setup([async () => {
    await gate;
    return jsonResponse(200, goodBody);
  }]);

  const a = t.service.getHolidays(YEAR);
  const b = t.service.getHolidays(YEAR);
  release();

  const [first, second] = await Promise.all([a, b]);
  assert.equal(t.calls.length, 1);
  assert.deepEqual(first, second);
});

test("missing API key: unavailable without calling the provider", async () => {
  const t = setup([], { apiKey: "" });
  assert.equal((await t.service.getHolidays(YEAR)).status, "unavailable");
  assert.equal(t.calls.length, 0);
  assert.match(t.logs[0], /not configured/);
});
