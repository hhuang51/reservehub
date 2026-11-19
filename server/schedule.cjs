// Room and availability queries. Each function takes the database so the
// same code runs against the real file and an in-memory test database.

function getRooms(db) {
  const rooms = db
    .prepare("SELECT id, name, capacity FROM rooms ORDER BY id")
    .all();

  const equipmentQuery = db.prepare(`
    SELECT name
    FROM room_equipment
    WHERE room_id = ?
    ORDER BY name
  `);

  return rooms.map((room) => ({
    ...room,
    equipment: equipmentQuery.all(room.id).map((item) => item.name),
  }));
}

// Two intervals [a, b) and [c, d) overlap when a < d and b > c.
// Touching intervals (10:00–11:00 and 11:00–12:00) do not overlap.
function unavailableRoomIds(db, date, startTime, endTime) {
  const rows = db.prepare(`
    SELECT room_id
    FROM reservations
    WHERE date = ?
      AND status = 'confirmed'
      AND start_time < ?
      AND end_time > ?

    UNION

    SELECT room_id
    FROM closures
    WHERE date = ?
      AND active = 1
      AND start_time < ?
      AND end_time > ?
  `).all(date, endTime, startTime, date, endTime, startTime);

  return new Set(rows.map((row) => row.room_id));
}

function availableRooms(db, date, startTime, endTime) {
  const unavailable = unavailableRoomIds(db, date, startTime, endTime);
  return getRooms(db).filter((room) => !unavailable.has(room.id));
}

module.exports = { getRooms, unavailableRoomIds, availableRooms };
