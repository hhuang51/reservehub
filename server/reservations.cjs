const express = require("express");
const { db } = require("./database.cjs");
const {
  checkJwt,
  checkWriteReservations,
  requireScheduler,
} = require("./auth.cjs");

const { validateReservation } = require("./validation.cjs");
const { recordReservationChange } = require("./telemetry.cjs");

const router = express.Router();


router.post(
  "/",
  checkJwt,
  checkWriteReservations,
  requireScheduler,
  (req, res, next) => {
    const validationError = validateReservation(req.body);

    if (validationError) {
      return res.status(400).json({
        error: {
          code: "INVALID_RESERVATION",
          message: validationError,
        },
      });
    }

    const { roomId, date, startTime, endTime } = req.body;
    const label = req.body.label.trim();

    const room = db
      .prepare("SELECT id FROM rooms WHERE id = ?")
      .get(roomId);

    if (!room) {
      return res.status(404).json({
        error: {
          code: "ROOM_NOT_FOUND",
          message: "The requested room does not exist.",
        },
      });
    }

    const { sub, iss } = req.auth.payload;

    if (typeof sub !== "string" || typeof iss !== "string") {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "A token identifying the user is required.",
        },
      });
    }

    let transactionStarted = false;

    try {
      db.exec("BEGIN IMMEDIATE;");
      transactionStarted = true;

      const result = db.prepare(`
        INSERT INTO reservations (
          room_id, label, date, start_time, end_time
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(roomId, label, date, startTime, endTime);

      const reservation = db.prepare(`
        SELECT
          id,
          room_id AS roomId,
          label,
          date,
          start_time AS startTime,
          end_time AS endTime,
          status
        FROM reservations
        WHERE id = ?
      `).get(result.lastInsertRowid);

      db.prepare(`
        INSERT INTO audit_events (
          actor,
          action,
          reservation_id,
          before_json,
          after_json
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        JSON.stringify({ issuer: iss, subject: sub }),
        "reservation.created",
        reservation.id,
        null,
        JSON.stringify(reservation)
      );

      db.exec("COMMIT;");
      transactionStarted = false;
      recordReservationChange("created");

      return res.status(201).json(reservation);
    } catch (error) {
      if (transactionStarted) {
        db.exec("ROLLBACK;");
      }

      if (error.message.includes("ROOM_CLOSED")) {
        return res.status(409).json({
          error: {
            code: "ROOM_CLOSED",
            message: "This room is closed during that time. Choose another slot.",
          },
        });
      }

      if (error.message.includes("RESERVATION_CONFLICT")) {
        return res.status(409).json({
          error: {
            code: "RESERVATION_CONFLICT",
            message: "This room is already reserved during that time.",
          },
        });
      }

      next(error);
    }
  }
);


router.patch(
  "/:id/cancel",
  checkJwt,
  checkWriteReservations,
  requireScheduler,
  (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: {
          code: "INVALID_RESERVATION_ID",
          message: "Reservation ID must be a positive whole number.",
        },
      });
    }

    const { iss, sub } = req.auth.payload;

    if (typeof iss !== "string" || typeof sub !== "string") {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "A token identifying the user is required.",
        },
      });
    }

    let transactionStarted = false;

    try {
      db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;

      const before = db.prepare(`
        SELECT id, room_id AS roomId, label, date,
               start_time AS startTime, end_time AS endTime, status
        FROM reservations
        WHERE id = ?
      `).get(id);

      if (!before) {
        db.exec("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          error: {
            code: "RESERVATION_NOT_FOUND",
            message: "Reservation not found.",
          },
        });
      }

      // A repeated request should not create a second cancellation event.
      if (before.status === "canceled") {
        db.exec("COMMIT");
        transactionStarted = false;
        return res.json(before);
      }

      db.prepare(`
        UPDATE reservations SET status = 'canceled' WHERE id = ?
      `).run(id);

      const after = { ...before, status: "canceled" };

      db.prepare(`
        INSERT INTO audit_events
          (actor, action, reservation_id, before_json, after_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        JSON.stringify({ issuer: iss, subject: sub }),
        "reservation.canceled",
        id,
        JSON.stringify(before),
        JSON.stringify(after)
      );

      db.exec("COMMIT");
      transactionStarted = false;
      recordReservationChange("canceled");
      return res.json(after);
    } catch (error) {
      if (transactionStarted) db.exec("ROLLBACK");
      next(error);
    }
  }
);
router.patch(
  "/:id",
  checkJwt,
  checkWriteReservations,
  requireScheduler,
  (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: {
          code: "INVALID_RESERVATION_ID",
          message: "Reservation ID must be a positive whole number.",
        },
      });
    }

    const validationError = validateReservation(req.body);

    if (validationError) {
      return res.status(400).json({
        error: {
          code: "INVALID_RESERVATION",
          message: validationError,
        },
      });
    }

    const { iss, sub } = req.auth.payload;

    if (typeof iss !== "string" || typeof sub !== "string") {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "A token identifying the user is required.",
        },
      });
    }

    let transactionStarted = false;

    try {
      db.exec("BEGIN IMMEDIATE");
      transactionStarted = true;

      const before = db.prepare(`
        SELECT id, room_id AS roomId, label, date,
               start_time AS startTime, end_time AS endTime, status
        FROM reservations
        WHERE id = ?
      `).get(id);

      if (!before || before.status !== "confirmed") {
        db.exec("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          error: {
            code: "RESERVATION_NOT_FOUND",
            message: "This reservation is no longer on the schedule.",
          },
        });
      }

      const { roomId, date, startTime, endTime } = req.body;
      const label = req.body.label.trim();

      // This form edits a booking within its current room.
      if (roomId !== before.roomId) {
        db.exec("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          error: {
            code: "ROOM_MISMATCH",
            message: "Choose a reservation in the current room.",
          },
        });
      }

      db.prepare(`
        UPDATE reservations
        SET label = ?, date = ?, start_time = ?, end_time = ?
        WHERE id = ?
      `).run(label, date, startTime, endTime, id);

      const after = { ...before, label, date, startTime, endTime };

      db.prepare(`
        INSERT INTO audit_events
          (actor, action, reservation_id, before_json, after_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        JSON.stringify({ issuer: iss, subject: sub }),
        "reservation.updated",
        id,
        JSON.stringify(before),
        JSON.stringify(after)
      );

      db.exec("COMMIT");
      transactionStarted = false;
      recordReservationChange("updated");
      return res.json(after);
    } catch (error) {
      if (transactionStarted) db.exec("ROLLBACK");


      if (error.message.includes("ROOM_CLOSED")) {
        return res.status(409).json({
          error: {
            code: "ROOM_CLOSED",
            message: "This room is closed during that time. Choose another slot.",
          },
        });
      }

      if (error.message.includes("RESERVATION_CONFLICT")) {
        return res.status(409).json({
          error: {
            code: "RESERVATION_CONFLICT",
            message: "This room is already booked during that time.",
          },
        });
      }

      next(error);
    }
  }
);
module.exports = router;