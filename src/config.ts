// API origin for this build. Set VITE_API_URL per environment
// (Render static site env var, or .env.local for development).
const configured: unknown = import.meta.env.VITE_API_URL;

export const API_ORIGIN = (
  typeof configured === "string" && configured.trim()
    ? configured.trim()
    : "http://localhost:3001"
).replace(/\/+$/, "");

export const API_URL = `${API_ORIGIN}/api`;
