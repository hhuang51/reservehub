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
const { SeverityNumber } = require("@opentelemetry/api-logs");

// Logs get their own exporter pipeline (rather than relying on the automatic
// setup in otel.cjs), so log export does not depend on SDK startup timing.
// It uses the same endpoint and auth header environment variables. If
// anything goes wrong, logging falls back to stdout only and the API keeps
// running.
let otelLogger = null;
let logSetupDone = false;

function parseResourceAttributes(text = "") {
  const attributes = {};

  for (const pair of text.split(",")) {
    const index = pair.indexOf("=");
    if (index > 0) {
      attributes[pair.slice(0, index).trim()] = decodeURIComponent(
        pair.slice(index + 1).trim()
      );
    }
  }

  return attributes;
}

function getOtelLogger() {
  if (logSetupDone) return otelLogger;
  logSetupDone = true;

  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;

  try {
    const sdkLogs = require("@opentelemetry/sdk-logs");
    const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-proto");
    const resources = require("@opentelemetry/resources");

    const attributes = {
      ...parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES),
      "service.name": process.env.OTEL_SERVICE_NAME || "reservehub-api",
    };

    const resource = resources.resourceFromAttributes
      ? resources.resourceFromAttributes(attributes)
      : new resources.Resource(attributes);

    // Reads OTEL_EXPORTER_OTLP_ENDPOINT (+ /v1/logs) and
    // OTEL_EXPORTER_OTLP_HEADERS from the environment.
    const processor = new sdkLogs.BatchLogRecordProcessor(new OTLPLogExporter());
    const provider = new sdkLogs.LoggerProvider({
      resource,
      processors: [processor],
    });

    // Older SDK versions take processors through a method instead.
    if (typeof provider.addLogRecordProcessor === "function") {
      provider.addLogRecordProcessor(processor);
    }

    otelLogger = provider.getLogger("reservehub-api");
  } catch (error) {
    console.warn(
      JSON.stringify({
        time: new Date().toISOString(),
        level: "warn",
        message: "log export disabled",
        reason: error?.message,
      })
    );
    otelLogger = null;
  }

  return otelLogger;
}

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

  try {
    getOtelLogger()?.emit({
      severityNumber: SEVERITY[level] ?? SeverityNumber.INFO,
      severityText: level.toUpperCase(),
      body: message,
      attributes: { ...attributes, ...ids },
    });
  } catch {
    // Never let telemetry break a request.
  }
}

// Business metric: reservation changes, by action
// (created / updated / canceled). Exported as reservehub_reservation_changes_total.
// Created on first use (the first reservation change happens long after
// startup, when the SDK is ready).
let reservationChanges = null;

function recordReservationChange(action) {
  if (!reservationChanges) {
    reservationChanges = metrics
      .getMeter("reservehub-api")
      .createCounter("reservehub.reservation.changes", {
        description: "Committed reservation changes, by action",
      });
  }

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
