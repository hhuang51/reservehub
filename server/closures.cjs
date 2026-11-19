const express = require("express");
const { db } = require("./database.cjs");
const {
  checkJwt,
  checkWriteReservations,
  requireScheduler,
} = require("./auth.cjs");

const { validSlot, hasStarted } = require("./validation.cjs");
const { publicRevalidate } = require("./http-headers.cjs");

const router = express.Router();
const schedulerOnly = [checkJwt, checkWriteReservations, requireScheduler];

const closureFields = `
  id, room_id AS roomId, date, start_time AS startTime,
  end_time AS endTime, reason, active
`;

function fail(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

// Commit the closure change and its audit entry together.
function writeClosure(req, res, next, operation) {
  const { iss, sub } = req.auth.payload;
  if (typeof iss !== "string" || typeof sub !== "string") {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "A user token is required." },
    });
  }

  let started = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    started = true;
    const { before, after, action, status } = operation();

    if (action) {
      db.prepare(`
        INSERT INTO closure_audit
          (closure_id, actor, action, before_json, after_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        after.id, JSON.stringify({ issuer: iss, subject: sub }), action,
        before ? JSON.stringify(before) : null, JSON.stringify(after)
      );
    }

    db.exec("COMMIT");
    started = false;
    return res.status(status).json(after);
  } catch (error) {
    if (started) db.exec("ROLLBACK");

    if (error.message.includes("BOOKING_EXISTS")) {
      return res.status(409).json({
        error: {
          code: "BOOKING_EXISTS",
          message: "Move or cancel the existing booking before closing this slot.",
        },
      });
    }
    if (error.message.includes("CLOSURE_EXISTS")) {
      return res.status(409).json({
        error: { code: "CLOSURE_EXISTS", message: "This slot already has a closure." },
      });
    }
    if (error.status === 404) {
      return res.status(404).json({
        error: { code: error.code, message: error.message },
      });
    }
    next(error);
  }
}

router.get("/rooms/:roomId/closures", (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isSafeInteger(roomId) || roomId < 1) {
    return res.status(400).json({
      error: { code: "INVALID_ROOM_ID", message: "Invalid room ID." },
    });
  }
  if (!db.prepare("SELECT id FROM rooms WHERE id = ?").get(roomId)) {
    return res.status(404).json({
      error: { code: "ROOM_NOT_FOUND", message: "Room not found." },
    });
  }
  publicRevalidate(res);
  res.json(db.prepare(`
    SELECT ${closureFields} FROM closures
    WHERE room_id = ? AND active = 1 ORDER BY date, start_time
  `).all(roomId));
});

router.post("/closures", ...schedulerOnly, (req, res, next) => {
  const { roomId, date, startTime, endTime, reason } = req.body ?? {};

  if (
    !Number.isSafeInteger(roomId) || roomId < 1 ||
    !validSlot(date, startTime, endTime) ||
    typeof reason !== "string" || !reason.trim() || reason.trim().length > 80
  ) {
    return res.status(400).json({
      error: {
        code: "INVALID_CLOSURE",
        message: "Choose a weekday slot between 9 AM and 5 PM and enter a reason of 1–80 characters.",
      },
    });
  }

  if (hasStarted(date, startTime)) {
    return res.status(400).json({
      error: {
        code: "INVALID_CLOSURE",
        message: "Choose a closure time that has not started yet (Chicago time).",
      },
    });
  }

  writeClosure(req, res, next, () => {
    if (!db.prepare("SELECT id FROM rooms WHERE id = ?").get(roomId)) {
      throw fail(404, "ROOM_NOT_FOUND", "Room not found.");
    }
    const result = db.prepare(`
      INSERT INTO closures (room_id, date, start_time, end_time, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, date, startTime, endTime, reason.trim());

    const after = db.prepare(
      `SELECT ${closureFields} FROM closures WHERE id = ?`
    ).get(result.lastInsertRowid);

    return { before: null, after, action: "closure.created", status: 201 };
  });
});

router.patch("/closures/:id/reopen", ...schedulerOnly, (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({
      error: { code: "INVALID_CLOSURE_ID", message: "Invalid closure ID." },
    });
  }

  writeClosure(req, res, next, () => {
    const before = db.prepare(
      `SELECT ${closureFields} FROM closures WHERE id = ?`
    ).get(id);

    if (!before) throw fail(404, "CLOSURE_NOT_FOUND", "Closure not found.");
    if (!before.active) return { after: before, status: 200 };

    db.prepare("UPDATE closures SET active = 0 WHERE id = ?").run(id);
    return {
      before,
      after: { ...before, active: 0 },
      action: "closure.reopened",
      status: 200,
    };
  });
});

module.exports = router;
module.exports.validSlot = validSlot;