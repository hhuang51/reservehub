// Pure validation rules shared by REST, closures, and MCP.
// No database or network access, so these can be unit tested directly.

const TIME_ZONE = "America/Chicago";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;

  const parsed = new Date(`${value}T12:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isWeekend(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isValidTime(value) {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

// Current date and HH:MM in Chicago, independent of the server's time zone.
function chicagoNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// True when the slot starts at or before the current Chicago time.
function hasStarted(date, startTime, now = new Date()) {
  const current = chicagoNow(now);

  return (
    date < current.date ||
    (date === current.date && startTime <= current.time)
  );
}

// Weekday, valid times, 09:00–17:00, start before end.
function validSlot(date, startTime, endTime) {
  return (
    isValidDate(date) &&
    !isWeekend(date) &&
    isValidTime(startTime) &&
    isValidTime(endTime) &&
    startTime >= "09:00" &&
    startTime < endTime &&
    endTime <= "17:00"
  );
}

// Returns an error message, or null when the reservation is valid.
function validateReservation(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "A reservation object is required.";
  }

  const { roomId, label, date, startTime, endTime } = body;

  if (!Number.isSafeInteger(roomId) || roomId < 1) {
    return "Room ID must be a positive whole number.";
  }

  if (
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.trim().length > 80
  ) {
    return "Enter a fictional reservation label of 1–80 characters.";
  }

  if (typeof date !== "string" || !DATE_PATTERN.test(date)) {
    return "Date must use YYYY-MM-DD.";
  }

  if (!isValidDate(date)) {
    return "Enter a valid calendar date.";
  }

  if (isWeekend(date)) {
    return "Rooms can only be reserved Monday through Friday.";
  }

  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return "Times must use 24-hour HH:MM format.";
  }

  if (startTime >= endTime) {
    return "End time must be after start time.";
  }

  if (startTime < "09:00" || endTime > "17:00") {
    return "Reservations must be between 9:00 AM and 5:00 PM.";
  }

  if (hasStarted(date, startTime, now)) {
    return "Choose a time that has not started yet (Chicago time).";
  }

  return null;
}

module.exports = {
  TIME_ZONE,
  isValidDate,
  isValidTime,
  isWeekend,
  chicagoNow,
  hasStarted,
  validSlot,
  validateReservation,
};
