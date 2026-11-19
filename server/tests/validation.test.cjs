// Validation rules. Expected results were predicted by hand before running.
//
// Fixed clock: 2026-11-19T01:00:00Z = Wed 2026-11-18 19:00 in Chicago (CST, UTC-6).
// 2026-11-20 is a Friday, 2026-11-21 a Saturday, 2026-02-29 does not exist,
// 2028-02-29 exists and is a Tuesday.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateReservation,
  validSlot,
  chicagoNow,
  hasStarted,
} = require("../validation.cjs");

const NOW = new Date("2026-11-19T01:00:00Z");

const valid = {
  roomId: 1,
  label: "Team Maple Meeting",
  date: "2026-11-20",
  startTime: "10:00",
  endTime: "11:00",
};

function check(changes, now = NOW) {
  return validateReservation({ ...valid, ...changes }, now);
}

test("a valid future weekday reservation passes", () => {
  assert.equal(check({}), null);
});

test("whole opening day 09:00–17:00 is allowed (boundaries inclusive)", () => {
  assert.equal(check({ startTime: "09:00", endTime: "17:00" }), null);
});

test("leap day in a leap year is a valid date", () => {
  assert.equal(check({ date: "2028-02-29" }), null);
});

test("rejects bodies that are not objects", () => {
  assert.equal(validateReservation(null, NOW), "A reservation object is required.");
  assert.equal(validateReservation([], NOW), "A reservation object is required.");
});

test("room ID must be a positive safe integer", () => {
  const message = "Room ID must be a positive whole number.";
  assert.equal(check({ roomId: 0 }), message);
  assert.equal(check({ roomId: -1 }), message);
  assert.equal(check({ roomId: 1.5 }), message);
  assert.equal(check({ roomId: "1" }), message);
});

test("label must be 1–80 characters after trimming", () => {
  const message = "Enter a fictional reservation label of 1–80 characters.";
  assert.equal(check({ label: "   " }), message);
  assert.equal(check({ label: "x".repeat(81) }), message);
  assert.equal(check({ label: 42 }), message);
  assert.equal(check({ label: "x".repeat(80) }), null);
  assert.equal(check({ label: `  ${"x".repeat(80)}  ` }), null);
});

test("date format and real calendar dates", () => {
  assert.equal(check({ date: "11/20/2026" }), "Date must use YYYY-MM-DD.");
  assert.equal(check({ date: "2026-02-29" }), "Enter a valid calendar date.");
  assert.equal(check({ date: "2026-13-01" }), "Enter a valid calendar date.");
});

test("weekends are rejected", () => {
  const message = "Rooms can only be reserved Monday through Friday.";
  assert.equal(check({ date: "2026-11-21" }), message);
  assert.equal(check({ date: "2026-11-22" }), message);
});

test("times must be 24-hour HH:MM", () => {
  const message = "Times must use 24-hour HH:MM format.";
  assert.equal(check({ startTime: "9:00" }), message);
  assert.equal(check({ endTime: "10:60" }), message);
  assert.equal(check({ endTime: "24:00" }), message);
});

test("end must be after start", () => {
  const message = "End time must be after start time.";
  assert.equal(check({ startTime: "10:00", endTime: "10:00" }), message);
  assert.equal(check({ startTime: "11:00", endTime: "10:00" }), message);
});

test("outside 9:00–17:00 is rejected", () => {
  const message = "Reservations must be between 9:00 AM and 5:00 PM.";
  assert.equal(check({ startTime: "08:30", endTime: "09:30" }), message);
  assert.equal(check({ startTime: "16:30", endTime: "17:30" }), message);
});

test("past dates and already-started slots are rejected", () => {
  const message = "Choose a time that has not started yet (Chicago time).";
  assert.equal(check({ date: "2026-11-17" }), message);

  // Same day, 09:30 Chicago: 09:00 has started, 10:00 has not.
  const morning = new Date("2026-11-18T15:30:00Z");
  assert.equal(check({ date: "2026-11-18", startTime: "09:00" }, morning), message);
  assert.equal(check({ date: "2026-11-18", startTime: "10:00" }, morning), null);
});

test("chicagoNow uses Chicago time, not UTC or the server zone", () => {
  // UTC date is already the 19th; Chicago is still the 18th.
  assert.deepEqual(chicagoNow(NOW), { date: "2026-11-18", time: "19:00" });
  // Summer: CDT is UTC-5.
  assert.deepEqual(
    chicagoNow(new Date("2026-07-01T12:00:00Z")),
    { date: "2026-07-01", time: "07:00" }
  );
});

test("hasStarted compares date then time", () => {
  assert.equal(hasStarted("2026-11-18", "18:59", NOW), true);
  assert.equal(hasStarted("2026-11-18", "19:00", NOW), true);
  assert.equal(hasStarted("2026-11-19", "09:00", NOW), false);
});

test("validSlot (availability search and closures)", () => {
  assert.equal(validSlot("2026-11-20", "10:00", "11:00"), true);
  assert.equal(validSlot("2026-11-21", "10:00", "11:00"), false);
  assert.equal(validSlot("2026-11-20", "11:00", "10:00"), false);
  assert.equal(validSlot("2026-11-20", "08:00", "10:00"), false);
  assert.equal(validSlot("2026-11-20", "10:00", "17:01"), false);
  assert.equal(validSlot(undefined, "10:00", "11:00"), false);
  assert.equal(validSlot(["2026-11-20"], "10:00", "11:00"), false);
});
