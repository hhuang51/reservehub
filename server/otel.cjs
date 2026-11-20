// OpenTelemetry bootstrap. Loaded before the app with:
//   node --require ./otel.cjs index.cjs      (see "start" in package.json)
//
// Telemetry is only enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set (on
// Render). Locally nothing is exported and the app runs exactly as before.
//
// Uses OpenTelemetry's zero-code Node.js setup: it traces incoming HTTP
// requests, Express routes, and outgoing fetch() calls (Calendarific, MCP ->
// REST), exports metrics such as http.server.request.duration, and sends log
// records written with telemetry.cjs. Endpoint, auth header, and service name
// come from environment variables, so no credentials are in the code.

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const defaults = {
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_NODE_RESOURCE_DETECTORS: "env,host,os",
    // Only what this app uses; avoids noise and startup cost.
    OTEL_NODE_ENABLED_INSTRUMENTATIONS: "http,express,undici",
    // Stable HTTP metric names: http.server.request.duration (seconds).
    OTEL_SEMCONV_STABILITY_OPT_IN: "http",
    OTEL_METRIC_EXPORT_INTERVAL: "15000",
  };

  for (const [name, value] of Object.entries(defaults)) {
    if (!process.env[name]) process.env[name] = value;
  }

  require("@opentelemetry/auto-instrumentations-node/register");
}
