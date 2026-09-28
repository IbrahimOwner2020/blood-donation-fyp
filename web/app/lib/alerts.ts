/**
 * Shortage alert API helpers for the web app.
 * Presentation-only — recalculation and RBAC authority live in the API.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
} from "~/lib/donors";

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

export type PublicAlertFacility = {
  id: number;
  name: string;
  region?: string;
  district?: string;
};

export type PublicAlertBloodGroup = {
  id: number;
  code: string;
  abo?: string;
  rh?: string;
};

export type PublicAlert = {
  id: number;
  bloodGroupId: number;
  bloodGroup: PublicAlertBloodGroup | null;
  facilityId: number | null;
  facility: PublicAlertFacility | null;
  predictionId: number;
  availableUnits: number;
  predictedUnits: number;
  projectedGap: number;
  severity: AlertSeverity;
  status: AlertStatus;
  createdAt?: string;
  resolvedAt?: string | null;
};

export type ListAlertsParams = {
  bloodGroupId?: number;
  facilityId?: number;
  status?: AlertStatus | "";
  severity?: AlertSeverity | "";
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
};

export type ListAlertsResult = {
  alerts: PublicAlert[];
  total: number;
  limit: number;
  offset: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeBloodGroup(value: unknown): PublicAlertBloodGroup | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  const id = toNumber(row.id, NaN);
  const code = toOptionalString(row.code);
  if (!Number.isFinite(id) || !code) {
    return null;
  }
  return {
    id,
    code,
    abo: toOptionalString(row.abo) ?? undefined,
    rh: toOptionalString(row.rh) ?? undefined,
  };
}

function normalizeFacility(value: unknown): PublicAlertFacility | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  const id = toNumber(row.id, NaN);
  const name = toOptionalString(row.name);
  if (!Number.isFinite(id) || !name) {
    return null;
  }
  return {
    id,
    name,
    region: toOptionalString(row.region) ?? undefined,
    district: toOptionalString(row.district) ?? undefined,
  };
}

function normalizeAlert(value: unknown): PublicAlert | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  const id = toNumber(row.id, NaN);
  const bloodGroupId = toNumber(row.bloodGroupId, NaN);
  if (!Number.isFinite(id) || !Number.isFinite(bloodGroupId)) {
    return null;
  }
  const severity = toOptionalString(row.severity) as AlertSeverity | null;
  const status = toOptionalString(row.status) as AlertStatus | null;
  return {
    id,
    bloodGroupId,
    bloodGroup: normalizeBloodGroup(row.bloodGroup),
    facilityId:
      row.facilityId == null ? null : toNumber(row.facilityId, NaN) || null,
    facility: normalizeFacility(row.facility),
    predictionId: toNumber(row.predictionId, 0),
    availableUnits: toNumber(row.availableUnits, 0),
    predictedUnits: toNumber(row.predictedUnits, 0),
    projectedGap: toNumber(row.projectedGap, 0),
    severity: severity ?? "LOW",
    status: status ?? "OPEN",
    createdAt: toOptionalString(row.createdAt) ?? undefined,
    resolvedAt: toOptionalString(row.resolvedAt),
  };
}

export async function listAlerts(
  params: ListAlertsParams = {},
): Promise<ListAlertsResult> {
  const search = new URLSearchParams();
  if (typeof params.bloodGroupId === "number") {
    search.set("bloodGroupId", String(params.bloodGroupId));
  }
  if (typeof params.facilityId === "number") {
    search.set("facilityId", String(params.facilityId));
  }
  if (params.status) {
    search.set("status", params.status);
  }
  if (params.severity) {
    search.set("severity", params.severity);
  }
  if (params.activeOnly) {
    search.set("activeOnly", "true");
  }
  if (typeof params.limit === "number") {
    search.set("limit", String(params.limit));
  }
  if (typeof params.offset === "number") {
    search.set("offset", String(params.offset));
  }
  const query = search.toString();
  const path = query ? `/alerts?${query}` : "/alerts";

  try {
    const payload = await apiFetch<{
      alerts?: unknown[];
      total?: number;
      limit?: number;
      offset?: number;
    }>(path);
    const alerts = (payload?.alerts ?? [])
      .map(normalizeAlert)
      .filter((row): row is PublicAlert => row != null);
    return {
      alerts,
      total: toNumber(payload?.total, alerts.length),
      limit: toNumber(payload?.limit, params.limit ?? 50),
      offset: toNumber(payload?.offset, params.offset ?? 0),
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      throw error;
    }
    if (error instanceof ApiRequestError && error.status === 404) {
      return {
        alerts: [],
        total: 0,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      };
    }
    throw new ApiRequestError(
      formatApiErrorMessage(error, "Unable to load alerts."),
      {
        status: error instanceof ApiRequestError ? error.status : 500,
        code: error instanceof ApiRequestError ? error.code : "INTERNAL_ERROR",
        cause: error,
      },
    );
  }
}

export function formatAlertSeverity(severity: AlertSeverity): string {
  return severity;
}

export function formatAlertStatus(status: AlertStatus): string {
  return status;
}

export { parsePositiveInt, formatApiErrorMessage };
