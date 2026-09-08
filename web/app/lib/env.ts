/**
 * Frontend env helpers (docs/15).
 * Browser calls the API at VITE_API_URL; session cookies stay on the API origin.
 */

const DEFAULT_API_BASE_URL = "http://localhost:3000/api/v1";

/** Absolute API v1 base URL, no trailing slash. */
export function getApiBaseUrl(): string {
  const raw =
    typeof import.meta !== "undefined"
      ? import.meta.env?.VITE_API_URL
      : undefined;
  const value = (typeof raw === "string" ? raw : "").trim();
  const base = value || DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, "");
}
