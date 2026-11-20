import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import App from "./App";
import "./index.css";

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;

if (!domain || !clientId) {
  throw new Error("Missing Auth0 settings in .env.local");
}

// Browser telemetry (Faro + OpenTelemetry web) loads as a separate chunk in
// parallel, so it never delays the first render (D8). Web Vitals are still
// captured because the browser buffers those performance entries.
void import("./observability");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: "openid read:reservations write:reservations",
      }}
    >
      <App />
    </Auth0Provider>
  </StrictMode>
);