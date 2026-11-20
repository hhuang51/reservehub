// Browser observability with Grafana Faro (D10).
//
// Records page loads, errors, and Web Vitals, and traces every fetch() to the
// ReserveHub API. Each API request carries a W3C `traceparent` header, so the
// API's spans join the browser's trace: one trace across two components
// (reservehub-web -> reservehub-api).
//
// Only active when VITE_FARO_URL is set (Render static sites). The collector
// URL is public by design; it is not a secret.

import { getWebInstrumentations, initializeFaro } from "@grafana/faro-web-sdk";
import { TracingInstrumentation } from "@grafana/faro-web-tracing";

import { API_ORIGIN } from "./config";

const faroUrl: unknown = import.meta.env.VITE_FARO_URL;
const environment: unknown = import.meta.env.VITE_APP_ENV;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (typeof faroUrl === "string" && faroUrl.trim()) {
  initializeFaro({
    url: faroUrl.trim(),
    app: {
      name: "reservehub-web",
      environment:
        typeof environment === "string" && environment ? environment : "development",
    },
    instrumentations: [
      ...getWebInstrumentations(),
      new TracingInstrumentation({
        instrumentationOptions: {
          // Send trace headers only to our own API, never to third parties.
          propagateTraceHeaderCorsUrls: [
            new RegExp(`^${escapeRegExp(API_ORIGIN)}/`),
          ],
        },
      }),
    ],
  });
}
