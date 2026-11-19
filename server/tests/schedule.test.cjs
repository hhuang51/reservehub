// Core calculation: interval overlap, availability, and closures, run against
// the real migrations on an in-memory SQLite database.
//
// Existing booking: room 1, Fri 2026-11-20, 10:00–11:00. Hand-predicted:
//   09:00–10:00  allowed   (ends exactly when it starts)
//   11:00–12:00  allowed   (starts exactly when it ends)
//   09:30–10:30  conflict  (overlaps the start)
//   10:30–11:30  conflict  (overlaps the end)
//   10:15–10:45  conflict  (inside)
//   09:00–12:00  conflict  (contains it)
//   10:00–11:00  conflict  (identical)
//   room 2 or another date, same time -> allowed
//   a canceled booking never blocks anything

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

const { migrate, userVersion, LATEST_VERSION } = require("../migrations.cjs");
const { availableRooms, unavailableRoomIds } = require("../schedule.cjs");

const DATE = "2026-11-20";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

function book(db, roomId, startTime, endTime, { date = DATE, status = "confirmed" } = {}) {
  return db.prepare(`
    INSERT INTO reservations (room_id, label, date, start_time, end_time, status)
    VALUES (?, 'Test booking', ?, ?, ?, ?)
  `).run(roomId, date, startTime, endTime, status).lastInsertRowid;
}

function close(db, roomId, startTime, endTime, date = DATE) {
  return db.prepare(`
    INSERT INTO closures (room_id, date, start_time, end_time, reason)
    VALUES (?, ?, ?, ?, 'Maintenance')
  `).run(roomId, date, startTime, endTime).lastInsertRowid;
}

function ids(rooms) {
  return rooms.map((room) => room.id);
}

test("migrations reach the latest version and are safe to re-run", () => {
  const db = freshDb();
  assert.equal(userVersion(db), LATEST_VERSION);
  assert.doesNotThrow(() => migrate(db));
  assert.equal(userVersion(db), LATEST_VERSION);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rooms").get().n, 3);
});

test("overlap rule for new bookings matches the hand-predicted table", () => {
  const cases = [
    ["09:00", "10:00", true],
    ["11:00", "12:00", true],
    ["09:30", "10:30", false],
    ["10:30", "11:30", false],
    ["10:15", "10:45", false],
    ["09:00", "12:00", false],
    ["10:00", "11:00", false],
  ];

  for (const [start, end, allowed] of cases) {
    const db = freshDb();
    book(db, 1, "10:00", "11:00");

    const attempt = () => book(db, 1, start, end);

    if (allowed) {
      assert.doesNotThrow(attempt, `${start}–${end} should be allowed`);
    } else {
      assert.throws(attempt, /RESERVATION_CONFLICT/, `${start}–${end} should conflict`);
    }
  }
});

test("other rooms, other dates, and canceled bookings do not conflict", () => {
  const db = freshDb();
  book(db, 1, "10:00", "11:00");

  assert.doesNotThrow(() => book(db, 2, "10:00", "11:00"));
  assert.doesNotThrow(() => book(db, 1, "10:00", "11:00", { date: "2026-11-23" }));

  book(db, 1, "13:00", "14:00", { status: "canceled" });
  assert.doesNotThrow(() => book(db, 1, "13:00", "14:00"));
});

test("editing: a booking may keep its own slot but not move onto another", () => {
  const db = freshDb();
  const first = book(db, 1, "10:00", "11:00");
  const second = book(db, 1, "12:00", "13:00");

  assert.doesNotThrow(() =>
    db.prepare("UPDATE reservations SET label = 'Renamed' WHERE id = ?").run(first)
  );

  assert.throws(
    () =>
      db.prepare(
        "UPDATE reservations SET start_time = '10:30', end_time = '11:30' WHERE id = ?"
      ).run(second),
    /RESERVATION_CONFLICT/
  );
});

test("closures block bookings, and bookings block closures", () => {
  const db = freshDb();

  const closure = close(db, 1, "14:00", "15:00");
  assert.throws(() => book(db, 1, "14:30", "15:30"), /ROOM_CLOSED/);
  assert.doesNotThrow(() => book(db, 1, "15:00", "16:00"));

  // A closure cannot be placed over a confirmed booking or another closure.
  assert.throws(() => close(db, 1, "15:30", "16:30"), /BOOKING_EXISTS/);
  assert.throws(() => close(db, 1, "14:30", "14:45"), /CLOSURE_EXISTS/);

  // Reopening the slot allows bookings again.
  db.prepare("UPDATE closures SET active = 0 WHERE id = ?").run(closure);
  assert.doesNotThrow(() => book(db, 1, "14:00", "15:00"));
});

test("availability excludes booked and closed rooms only when they overlap", () => {
  const db = freshDb();
  book(db, 1, "10:00", "11:00");
  close(db, 3, "10:30", "12:00");
  book(db, 2, "10:00", "11:00", { status: "canceled" });

  // 10:30–11:00: room 1 booked, room 3 closed, room 2's booking canceled.
  assert.deepEqual(ids(availableRooms(db, DATE, "10:30", "11:00")), [2]);

  // 11:00–12:00: room 1 is free again (touching), room 3 still closed.
  assert.deepEqual(ids(availableRooms(db, DATE, "11:00", "12:00")), [1, 2]);

  // 12:00–13:00: everything free.
  assert.deepEqual(ids(availableRooms(db, DATE, "12:00", "13:00")), [1, 2, 3]);

  // A different day is unaffected.
  assert.deepEqual([...unavailableRoomIds(db, "2026-11-23", "10:00", "11:00")], []);
});

test("database constraints back up the API validation", () => {
  const db = freshDb();
  assert.throws(() => book(db, 1, "08:00", "09:00"), /CHECK constraint/);
  assert.throws(() => book(db, 1, "11:00", "10:00"), /CHECK constraint/);
  assert.throws(() => book(db, 99, "10:00", "11:00"), /FOREIGN KEY/);
});

test("audit history is append-only", () => {
  const db = freshDb();
  const id = book(db, 1, "10:00", "11:00");

  db.prepare(`
    INSERT INTO audit_events (actor, action, reservation_id, after_json)
    VALUES ('{"subject":"test"}', 'reservation.created', ?, '{}')
  `).run(id);

  assert.throws(
    () => db.exec("UPDATE audit_events SET action = 'tampered'"),
    /AUDIT_IS_APPEND_ONLY/
  );
  assert.throws(() => db.exec("DELETE FROM audit_events"), /AUDIT_IS_APPEND_ONLY/);
});
