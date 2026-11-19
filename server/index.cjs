const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const express = require("express");
const cors = require("cors");

const { db, getRooms } = require("./database.cjs");
const schedule = require("./schedule.cjs");
const { validSlot } = require("./validation.cjs");
const {
  securityHeaders,
  defaultCachePolicy,
  publicRevalidate,
} = require("./http-headers.cjs");
const {
  writeLimiter,
  mcpLimiter,
  holidayLimiter,
  onlyWrites,
} = require("./rate-limits.cjs");

const {
  checkJwt,
  checkReadReservations,
  checkWriteReservations,
  requireScheduler,
} = require("./auth.cjs");

// Migrations run once in database.cjs before any route module loads.
const reservationRoutes = require("./reservations.cjs");
const closureRoutes = require("./closures.cjs");
const integrationRoutes = require("./integrations.cjs");
const mcpRoutes = require("./mcp.cjs");

const app = express();
const STARTED_AT = new Date().toISOString();

// Behind Render's proxy, trust one hop so req.ip is the real client IP
// (needed for per-IP rate limits). Leave unset when running locally.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
}

const PORT = Number(process.env.PORT || 3001);
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  })
);

app.use(securityHeaders);
app.use(defaultCachePolicy);
app.use(express.json({ limit: "16kb" }));

// Rate limits run before the routes they protect. Reads of the public
// schedule are not limited; writes, MCP calls, and the endpoint that can
// trigger a paid third-party request are.
app.use("/api/reservations", onlyWrites(writeLimiter));
app.use("/api/closures", onlyWrites(writeLimiter));
app.use("/mcp", mcpLimiter);
app.use("/api/holidays", holidayLimiter);

// Reservation, closure, holiday, and live-update endpoints.
app.use("/api/reservations", reservationRoutes);
app.use("/api", closureRoutes);
app.use("/api", integrationRoutes);
app.use("/mcp", mcpRoutes);

// Health check.
app.get("/healthz", (req, res, next) => {
  try {
    db.prepare("SELECT 1").get();

    res.setHeader("Cache-Control", "no-store");
    res.json({
      status: "ok",
      database: "connected",
      // Lets the pipeline confirm which build is live.
      commit: process.env.RENDER_GIT_COMMIT || "local",
      service: process.env.RENDER_SERVICE_NAME || "local",
      environment: process.env.APP_ENV || "development",
      startedAt: STARTED_AT,
    });
  } catch (error) {
    next(error);
  }
});

// Public room list, optionally filtered by availability.
app.get("/api/rooms", (req, res, next) => {
  try {
    publicRevalidate(res);

    const { date, startTime, endTime } = req.query;

    if (
      date === undefined &&
      startTime === undefined &&
      endTime === undefined
    ) {
      return res.json(getRooms());
    }

    if (!validSlot(date, startTime, endTime)) {
      return res.status(400).json({
        error: {
          code: "INVALID_AVAILABILITY",
          message:
            "Choose a valid weekday and a time between 9:00 AM and 5:00 PM. End time must be after start time.",
        },
      });
    }

    const availableRooms = schedule.availableRooms(
      db,
      date,
      startTime,
      endTime
    );

    return res.json(availableRooms);
  } catch (error) {
    next(error);
  }
});

// Public schedule containing confirmed reservations.
app.get("/api/rooms/:roomId/reservations", (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId);

    if (!Number.isSafeInteger(roomId) || roomId < 1) {
      return res.status(400).json({
        error: {
          code: "INVALID_ROOM_ID",
          message: "Invalid room ID.",
        },
      });
    }

    const room = db.prepare(
      "SELECT id FROM rooms WHERE id = ?"
    ).get(roomId);

    if (!room) {
      return res.status(404).json({
        error: {
          code: "ROOM_NOT_FOUND",
          message: "Room not found.",
        },
      });
    }

    const reservations = db.prepare(`
      SELECT
        id,
        room_id AS roomId,
        label,
        date,
        start_time AS startTime,
        end_time AS endTime,
        status
      FROM reservations
      WHERE room_id = ?
        AND status = 'confirmed'
      ORDER BY date, start_time, id
    `).all(roomId);

    publicRevalidate(res);
    return res.json(reservations);
  } catch (error) {
    next(error);
  }
});

// Verify access-token validity and read permission.
app.get(
  "/api/auth-check",
  checkJwt,
  checkReadReservations,
  (req, res) => {
    res.json({
      message: "Authentication successful.",
    });
  }
);

// Verify scheduler role and write permission.
app.get(
  "/api/scheduler-check",
  checkJwt,
  checkWriteReservations,
  requireScheduler,
  (req, res) => {
    res.json({
      message: "Scheduler access confirmed.",
      role: "scheduler",
    });
  }
);

// This must stay after every endpoint.
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested endpoint does not exist.",
    },
  });
});

// Central error handler.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.status || error.statusCode;

  if (status === 401 || status === 403) {
    if (error.headers) {
      for (const [name, value] of Object.entries(error.headers)) {
        res.setHeader(name, value);
      }
    }

    return res.status(status).json({
      error: {
        code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        message:
          status === 401
            ? "A valid access token is required."
            : "You do not have permission to perform this action.",
      },
    });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "The request body must contain valid JSON.",
      },
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: {
        code: "REQUEST_TOO_LARGE",
        message: "The request body is too large.",
      },
    });
  }

  console.error("Server error:", error.message);

  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected server error occurred. Please try again.",
    },
  });
});

app.listen(PORT, () => {
  // On Render the public address is the service URL, not localhost.
  console.log(
    process.env.RENDER === "true"
      ? `ReserveHub API listening on port ${PORT} (${process.env.APP_ENV || "unknown"})`
      : `ReserveHub API running at http://localhost:${PORT}`
  );
});