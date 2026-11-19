const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const { migrate } = require("./migrations.cjs");
const schedule = require("./schedule.cjs");

// DATABASE_PATH lets staging and production point at separate files
// (for example a mounted Render disk). Defaults to the local file.
const databasePath =
  process.env.DATABASE_PATH || path.join(__dirname, "reservehub.sqlite");

const db = new DatabaseSync(databasePath);

migrate(db);

function getRooms() {
  return schedule.getRooms(db);
}

module.exports = { db, getRooms };
