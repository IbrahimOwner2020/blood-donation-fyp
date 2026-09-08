/**
 * Typed API client for the web app.
 * Presentation layer only — business rules and auth authority live in the API.
 */

import { getApiBaseUrl } from "~/lib/env";

export type ApiErrorDetail = {
  path?: string;
  message: string;
  code?: string;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details: ApiErrorDetail[];
};

export type ApiSuccessEnvelope<T> = {
  data: T;
  error: null;
};

export type ApiErrorEnvelope = {
  data: null;
  error: ApiErrorBody;
};

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      details?: ApiErrorDetail[];
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ApiRequestError";
    this.status = options.status ?? 500;
    this.code = options.code ?? "INTERNAL_ERROR";
    this.details = options.details ?? [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEnvelope<T>(payload: unknown): ApiEnvelope<T> {
  if (!isRecord(payload)) {
    throw new ApiRequestError("Invalid API response", {
      status: 502,
      code: "BAD_GATEWAY",
    });
  }

  if (payload.error === null && "data" in payload) {
    return { data: payload.data as T, error: null };
  }

  const error = payload.error;
  if (isRecord(error) && typeof error.message === "string") {
    const details = Array.isArray(error.details)
      ? (error.details as ApiErrorDetail[])
      : [];
    return {
      data: null,
      error: {
        code: typeof error.code === "string" ? error.code : "INTERNAL_ERROR",
        message: error.message,
        details,
      },
    };
  }

  throw new ApiRequestError("Invalid API response envelope", {
    status: 502,
    code: "BAD_GATEWAY",
  });
}

export type ApiFetchOptions = Omit<RequestInit, "credentials" | "body"> & {
  /** JSON body — serialized automatically when provided */
  json?: unknown;
};

/**
 * Fetch JSON from the API with session cookies included.
 * Paths are relative to VITE_API_URL (e.g. `/auth/me`).
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { json, headers: initHeaders, ...rest } = options;
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${normalizedPath}`;

  const headers = new Headers(initHeaders);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (json !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers,
      credentials: "include",
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch (cause) {
    throw new ApiRequestError(
      "Unable to reach the API. Check that it is running and CORS allows this origin with credentials.",
      { status: 0, code: "NETWORK_ERROR", cause },
    );
  }

  let payload: unknown = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (cause) {
      throw new ApiRequestError("API returned invalid JSON", {
        status: response.status,
        code: "BAD_GATEWAY",
        cause,
      });
    }
  }

  if (payload !== null) {
    const envelope = parseEnvelope<T>(payload);
    if (envelope.error) {
      throw new ApiRequestError(envelope.error.message || "Request failed", {
        status: response.status,
        code: envelope.error.code,
        details: envelope.error.details,
      });
    }
    if (!response.ok) {
      throw new ApiRequestError("Request failed", {
        status: response.status,
        code: "HTTP_ERROR",
      });
    }
    return envelope.data;
  }

  if (!response.ok) {
    throw new ApiRequestError(response.statusText || "Request failed", {
      status: response.status,
      code: "HTTP_ERROR",
    });
  }

  throw new ApiRequestError("Empty API response", {
    status: response.status,
    code: "BAD_GATEWAY",
  });
}
