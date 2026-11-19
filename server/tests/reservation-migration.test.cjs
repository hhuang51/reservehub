const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  migrateReservations,
  rollbackReservations,
} = require("../reservation-migration.cjs");

test("reservation migration rolls back and restores overlap protection", () => {
  const db = new DatabaseSync(":memory:");

  try {
    // Start with the rooms table that exists before migration 2.
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE rooms (id INTEGER PRIMARY KEY);
      INSERT INTO rooms (id) VALUES (1);
      PRAGMA user_version = 1;
    `);

    function version() {
      return db.prepare("PRAGMA user_version").get().user_version;
    }

    migrateReservations(db);
    assert.equal(version(), 2);

    rollbackReservations(db);
    assert.equal(version(), 1);

    const table = db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name = 'reservations'
    `).get();

    assert.equal(table, undefined);
    assert.equal(db.prepare("SELECT id FROM rooms").get().id, 1);

    // Apply the migration again and check the actual booking behavior.
    migrateReservations(db);
    assert.equal(version(), 2);

    const book = db.prepare(`
      INSERT INTO reservations (room_id, label, date, start_time, end_time)
      VALUES (1, 'Test meeting', '2026-11-18', ?, ?)
    `);

    book.run("10:00", "11:00");

    assert.throws(
      () => book.run("10:30", "11:30"),
      /RESERVATION_CONFLICT/
    );

    book.run("11:00", "12:00");

    const count = db.prepare("SELECT COUNT(*) AS total FROM reservations").get();
    assert.equal(count.total, 2);
  } finally {
    db.close();
  }
});