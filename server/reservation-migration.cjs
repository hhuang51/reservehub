function migrateReservations(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;

  if (version >= 2) {
    return;
  }

  db.exec("BEGIN IMMEDIATE;");

  try {
    db.exec(`
      CREATE TABLE reservations (
        id INTEGER PRIMARY KEY,
        room_id INTEGER NOT NULL,
        label TEXT NOT NULL CHECK (
          length(trim(label)) BETWEEN 1 AND 80
        ),
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed'
          CHECK (status IN ('confirmed', 'canceled')),
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        CHECK (start_time < end_time),
        CHECK (start_time >= '09:00' AND end_time <= '17:00')
      );

      CREATE INDEX reservations_room_date_start
      ON reservations (room_id, date, start_time);

      CREATE TRIGGER prevent_reservation_overlap_insert
      BEFORE INSERT ON reservations
      WHEN NEW.status = 'confirmed'
      BEGIN
        SELECT RAISE(ABORT, 'RESERVATION_CONFLICT')
        WHERE EXISTS (
          SELECT 1
          FROM reservations
          WHERE room_id = NEW.room_id
            AND date = NEW.date
            AND status = 'confirmed'
            AND start_time < NEW.end_time
            AND end_time > NEW.start_time
        );
      END;

      CREATE TRIGGER prevent_reservation_overlap_update
      BEFORE UPDATE ON reservations
      WHEN NEW.status = 'confirmed'
      BEGIN
        SELECT RAISE(ABORT, 'RESERVATION_CONFLICT')
        WHERE EXISTS (
          SELECT 1
          FROM reservations
          WHERE room_id = NEW.room_id
            AND date = NEW.date
            AND status = 'confirmed'
            AND id != NEW.id
            AND start_time < NEW.end_time
            AND end_time > NEW.start_time
        );
      END;

      PRAGMA user_version = 2;
    `);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function rollbackReservations(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;

  if (version !== 2) {
    throw new Error("Reservation rollback requires database version 2.");
  }

  db.exec("BEGIN IMMEDIATE");

  try {
    db.exec(`
      DROP TABLE reservations;
      PRAGMA user_version = 1;
      COMMIT;
    `);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { migrateReservations, rollbackReservations };