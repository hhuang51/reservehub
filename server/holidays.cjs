// US national holidays from Calendarific, cached in SQLite.
//
// Outage policy:
//   fresh cache (< 24 h)        -> serve it, no provider call
//   provider OK                 -> store and serve "fresh"
//   provider fails, old cache   -> serve "stale" (shown as possibly out of date)
//   provider fails, no cache    -> serve "unavailable"; booking still allowed
//   after a failure             -> no provider calls for 60 s (cooldown)
//
// createHolidayService() takes its dependencies (fetch, clock, sleep, log)
// so tests can stub the provider without network access.

const { DatabaseSync } = require("node:sqlite");
const { isValidDate } = require("./validation.cjs");

const CACHE_DURATION = 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN = 60 * 1000;
const REQUEST_TIMEOUT = 5000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY = 300;

function openHolidayCache(filename) {
  const cache = new DatabaseSync(filename);
  const version = cache.prepare("PRAGMA user_version").get().user_version;

  if (version > 1) {
    throw new Error("The holiday cache requires a newer server version.");
  }

  if (version === 0) {
    cache.exec("BEGIN IMMEDIATE;");

    try {
      cache.exec(`
        CREATE TABLE holiday_cache (
          country TEXT NOT NULL,
          year INTEGER NOT NULL,
          holidays_json TEXT NOT NULL,
          fetched_at INTEGER NOT NULL,
          PRIMARY KEY (country, year)
        );

        PRAGMA user_version = 1;
      `);
      cache.exec("COMMIT;");
    } catch (error) {
      cache.exec("ROLLBACK;");
      throw error;
    }
  }

  return cache;
}

class ProviderError extends Error {
  constructor(message, { status = null, retry = true } = {}) {
    super(message);
    this.status = status;
    this.retry = retry;
  }
}

// Validate and normalize the provider body. Throws on anything unexpected.
function parseHolidays(body, year) {
  const items = body?.response?.holidays;

  if (body?.meta?.code !== 200 || !Array.isArray(items)) {
    throw new ProviderError("Unexpected holiday provider response.", {
      retry: false,
    });
  }

  const holidays = items.map((item) => {
    const date = item?.date?.iso;

    if (
      typeof item?.name !== "string" ||
      !item.name.trim() ||
      !isValidDate(date) ||
      Number(date.slice(0, 4)) !== year ||
      !Array.isArray(item.type) ||
      !item.type.every((type) => typeof type === "string")
    ) {
      throw new ProviderError("Invalid holiday data.", { retry: false });
    }

    return { name: item.name.trim(), date };
  });

  return Array.from(
    new Map(
      holidays.map((holiday) => [`${holiday.date}:${holiday.name}`, holiday])
    ).values()
  ).sort((a, b) => a.date.localeCompare(b.date));
}

function createHolidayService({
  cache,
  getApiKey,
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console,
}) {
  const pendingRequests = new Map();
  const retryAfter = new Map();

  function readCache(year) {
    const row = cache.prepare(`
      SELECT holidays_json, fetched_at
      FROM holiday_cache
      WHERE country = 'US' AND year = ?
    `).get(year);

    if (!row) return null;

    try {
      return {
        holidays: JSON.parse(row.holidays_json),
        fetchedAt: row.fetched_at,
      };
    } catch {
      return null;
    }
  }

  async function fetchHolidays(year) {
    const apiKey = getApiKey();

    if (!apiKey) {
      throw new ProviderError("Holiday provider is not configured.", {
        retry: false,
      });
    }

    const url = new URL("https://calendarific.com/api/v2/holidays");
    url.search = new URLSearchParams({
      api_key: apiKey,
      country: "US",
      year: String(year),
      type: "national",
    }).toString();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        let response;

        try {
          response = await fetchImpl(url, {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
          });
        } catch (error) {
          // Never include `url` or the original error text: both can
          // contain the API key.
          throw new ProviderError(
            error?.name === "TimeoutError"
              ? "Holiday provider timed out."
              : "Holiday provider could not be reached."
          );
        }

        if (!response.ok) {
          // 4xx (bad key, quota) will not succeed on retry; 5xx might.
          throw new ProviderError("Holiday provider request failed.", {
            status: response.status,
            retry: response.status >= 500,
          });
        }

        let body;

        try {
          body = await response.json();
        } catch {
          throw new ProviderError("Holiday provider returned invalid JSON.", {
            retry: false,
          });
        }

        const holidays = parseHolidays(body, year);
        const fetchedAt = now();

        cache.prepare(`
          INSERT INTO holiday_cache (country, year, holidays_json, fetched_at)
          VALUES ('US', ?, ?, ?)
          ON CONFLICT(country, year) DO UPDATE SET
            holidays_json = excluded.holidays_json,
            fetched_at = excluded.fetched_at
        `).run(year, JSON.stringify(holidays), fetchedAt);

        return { holidays, fetchedAt };
      } catch (error) {
        const retry = error instanceof ProviderError ? error.retry : false;

        if (attempt === MAX_ATTEMPTS || !retry) throw error;

        await sleep(RETRY_DELAY);
      }
    }
  }

  function fallback(saved) {
    return {
      holidays: saved?.holidays ?? [],
      fetchedAt: saved?.fetchedAt ?? null,
      status: saved ? "stale" : "unavailable",
    };
  }

  async function getHolidays(year) {
    const saved = readCache(year);

    if (saved && now() - saved.fetchedAt < CACHE_DURATION) {
      return { ...saved, status: "fresh" };
    }

    if ((retryAfter.get(year) ?? 0) > now()) {
      return fallback(saved);
    }

    if (!pendingRequests.has(year)) {
      const request = fetchHolidays(year)
        .then((result) => {
          retryAfter.delete(year);
          return { ...result, status: "fresh" };
        })
        .catch((error) => {
          retryAfter.set(year, now() + FAILURE_COOLDOWN);

          // Safe to log: message and status only, never the URL or key.
          const status = error?.status ? ` (HTTP ${error.status})` : "";
          log.error(
            `Holiday lookup for ${year} failed: ` +
              `${error?.message ?? "unknown error"}${status}`
          );

          return fallback(saved);
        })
        .finally(() => {
          pendingRequests.delete(year);
        });

      pendingRequests.set(year, request);
    }

    return pendingRequests.get(year);
  }

  return { getHolidays, fetchHolidays };
}

module.exports = {
  CACHE_DURATION,
  FAILURE_COOLDOWN,
  MAX_ATTEMPTS,
  openHolidayCache,
  parseHolidays,
  createHolidayService,
};
