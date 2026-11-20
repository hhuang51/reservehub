// Structured logging and business metrics.
//
// log(level, message, attributes) writes one JSON line to stdout (visible in
// Render's logs) and, when OpenTelemetry is enabled, sends the same record to
// Grafana. Records written inside a request carry its trace_id/span_id, so a
// log line links straight to its trace.
//
// Without OpenTelemetry (local development, tests) the OTel API calls are
// no-ops and only the JSON line is written.

const { trace, metrics } = require("@opentelemetry/api");
const { logs, SeverityNumber } = require("@opentelemetry/api-logs");

const otelLogger = logs.getLogger("reservehub-api");
const meter = metrics.getMeter("reservehub-api");

const SEVERITY = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function log(level, message, attributes = {}) {
  const context = trace.getActiveSpan()?.spanContext();
  const ids = context
    ? { trace_id: context.traceId, span_id: context.spanId }
    : {};

  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...attributes,
    ...ids,
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  otelLogger.emit({
    severityNumber: SEVERITY[level] ?? SeverityNumber.INFO,
    severityText: level.toUpperCase(),
    body: message,
    attributes,
  });
}

// Business metric: reservation changes, by action
// (created / updated / canceled). Exported as reservehub_reservation_changes_total.
const reservationChanges = meter.createCounter("reservehub.reservation.changes", {
  description: "Committed reservation changes, by action",
});

function recordReservationChange(action) {
  reservationChanges.add(1, { action });
}

// Express middleware: one log line per finished request.
function requestLogger(req, res, next) {
  if (req.path === "/healthz" || req.path === "/api/events") return next();

  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;

    log(res.statusCode >= 500 ? "error" : "info", "request", {
      method: req.method,
      route,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 10) / 10,
    });
  });

  next();
}

module.exports = { log, recordReservationChange, requestLogger };
