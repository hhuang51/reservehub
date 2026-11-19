// All schema migrations for reservehub.sqlite, in order.
// PRAGMA user_version records which migrations have run:
//   1 rooms + equipment   2 reservations (reversible, see reservation-migration.cjs)
//   3 audit_events        4 closures + closure_audit
// migrate(db) takes any database (file or ":memory:"), so tests can run the
// real migrations instead of a copy of the schema.

const { migrateReservations } = require("./reservation-migration.cjs");

const LATEST_VERSION = 4;

function userVersion(db) {
  return db.prepare("PRAGMA user_version").get().user_version;
}

function inTransaction(db, sql) {
  db.exec("BEGIN IMMEDIATE;");

  try {
    db.exec(sql);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function migrateRooms(db) {
  if (userVersion(db) !== 0) return;

  inTransaction(db, `
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL CHECK (capacity > 0)
    );

    CREATE TABLE room_equipment (
      room_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (room_id, name),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    INSERT INTO rooms (id, name, capacity) VALUES
      (1, 'Maple Room', 4),
      (2, 'Oak Room', 8),
      (3, 'Cedar Room', 12);

    INSERT INTO room_equipment (room_id, name) VALUES
      (1, 'Whiteboard'),
      (2, 'TV'),
      (2, 'Whiteboard'),
      (3, 'Projector'),
      (3, 'Whiteboard');

    PRAGMA user_version = 1;
  `);
}

function migrateAudit(db) {
  if (userVersion(db) >= 3) return;

  inTransaction(db, `
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      reservation_id INTEGER NOT NULL,
      before_json TEXT,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      FOREIGN KEY (reservation_id) REFERENCES reservations(id)
    );

    CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_IS_APPEND_ONLY');
    END;

    CREATE TRIGGER audit_events_no_delete
    BEFORE DELETE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_IS_APPEND_ONLY');
    END;

    PRAGMA user_version = 3;
  `);
}

function migrateClosures(db) {
  const version = userVersion(db);
  if (version === 4) return;
  if (version !== 3) throw new Error("Closure migration requires version 3.");

  const closureTriggers = ["INSERT", "UPDATE"]
    .map(
      (operation) => `
        CREATE TRIGGER closure_blocks_reservation_${operation}
        BEFORE ${operation} ON reservations
        WHEN NEW.status = 'confirmed'
        BEGIN
          SELECT RAISE(ABORT, 'ROOM_CLOSED')
          WHERE EXISTS (
            SELECT 1 FROM closures
            WHERE room_id = NEW.room_id AND date = NEW.date AND active = 1
              AND start_time < NEW.end_time AND end_time > NEW.start_time
          );
        END;
      `
    )
    .join("\n");

  inTransaction(db, `
    CREATE TABLE closures (
      id INTEGER PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 80),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      CHECK (start_time >= '09:00' AND start_time < end_time
             AND end_time <= '17:00')
    );

    CREATE INDEX closures_room_date_start
      ON closures(room_id, date, start_time) WHERE active = 1;

    CREATE TRIGGER check_new_closure BEFORE INSERT ON closures
    WHEN NEW.active = 1
    BEGIN
      SELECT RAISE(ABORT, 'BOOKING_EXISTS')
      WHERE EXISTS (
        SELECT 1 FROM reservations
        WHERE room_id = NEW.room_id AND date = NEW.date
          AND status = 'confirmed'
          AND start_time < NEW.end_time AND end_time > NEW.start_time
      );

      SELECT RAISE(ABORT, 'CLOSURE_EXISTS')
      WHERE EXISTS (
        SELECT 1 FROM closures
        WHERE room_id = NEW.room_id AND date = NEW.date AND active = 1
          AND start_time < NEW.end_time AND end_time > NEW.start_time
      );
    END;

    CREATE TABLE closure_audit (
      id INTEGER PRIMARY KEY,
      closure_id INTEGER NOT NULL REFERENCES closures(id),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER closure_audit_no_update BEFORE UPDATE ON closure_audit
    BEGIN SELECT RAISE(ABORT, 'AUDIT_IS_APPEND_ONLY'); END;

    CREATE TRIGGER closure_audit_no_delete BEFORE DELETE ON closure_audit
    BEGIN SELECT RAISE(ABORT, 'AUDIT_IS_APPEND_ONLY'); END;

    ${closureTriggers}

    PRAGMA user_version = 4;
  `);
}

function migrate(db) {
  db.exec("PRAGMA foreign_keys = ON;");

  if (userVersion(db) > LATEST_VERSION) {
    throw new Error("This database requires a newer server version.");
  }

  migrateRooms(db);
  migrateReservations(db);
  migrateAudit(db);
  migrateClosures(db);
}

module.exports = { migrate, userVersion, LATEST_VERSION };
