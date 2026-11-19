const express = require("express");
const path = require("node:path");
const {
  openHolidayCache,
  createHolidayService,
} = require("./holidays.cjs");
const { publicFor } = require("./http-headers.cjs");
const { db } = require("./database.cjs");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const router = express.Router();

// This database contains only replaceable holiday cache data.
const holidays = createHolidayService({
  cache: openHolidayCache(
    process.env.HOLIDAY_CACHE_PATH ||
      path.join(__dirname, "holiday-cache.sqlite")
  ),
  getApiKey: () => process.env.CALENDARIFIC_API_KEY,
});

router.get("/holidays", async (req, res, next) => {
  const year = Number(req.query.year);
  const currentYear = new Date().getUTCFullYear();

  if (
    !Number.isInteger(year) ||
    year < currentYear - 1 ||
    year > currentYear + 2
  ) {
    return res.status(400).json({
      error: {
        code: "INVALID_YEAR",
        message: "Choose a year from last year through two years ahead.",
      },
    });
  }

  try {
    const result = await holidays.getHolidays(year);

    // Cache good answers for an hour; never cache an outage answer.
    if (result.status === "fresh") {
      publicFor(res, 3600);
    } else {
      res.setHeader("Cache-Control", "no-store");
    }

    res.json({
      country: "US",
      year,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

// Revisions come from committed, append-only audit records.
// No reservation details or user identities are sent in this stream.
function currentRevision() {
  const reservations = db.prepare(`
    SELECT COALESCE(MAX(id), 0) AS revision FROM audit_events
  `).get().revision;

  const closures = db.prepare(`
    SELECT COALESCE(MAX(id), 0) AS revision FROM closure_audit
  `).get().revision;

  return `${reservations}-${closures}`;
}

router.get("/events", (req, res, next) => {
  let previous;

  try {
    previous = currentRevision();
  } catch (error) {
    return next(error);
  }

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.flushHeaders();
  res.write("retry: 3000\n\n");

  function sendRevision(revision) {
    res.write(`id: ${revision}\n`);
    res.write(`data: ${JSON.stringify({ revision })}\n\n`);
  }

  // Snapshot recovery: every new connection asks the browser
  // to fetch the current schedule, including after reconnecting.
  sendRevision(previous);

  const changes = setInterval(() => {
    try {
      const revision = currentRevision();

      if (revision !== previous) {
        previous = revision;
        sendRevision(revision);
      }
    } catch {
      res.end();
    }
  }, 2000);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  res.on("close", () => {
    clearInterval(changes);
    clearInterval(heartbeat);
  });
});

module.exports = router;