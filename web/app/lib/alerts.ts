/**
 * Shortage alerts API helpers for the web app
 * (docs/05 Alert Table, docs/08 lifecycle, docs/04 alerts/).
 * Presentation-only — severity and status transitions are API-owned.
 *
 * Alerts routes may land in parallel with predictions; callers should treat
 * missing routes (404) and network gaps as empty/unavailable, not crashes.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  BLOOD_GROUP_OPTIONS,
  normalizeDonor,
  type PublicBloodGroup,
  type PublicDonor,
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
} from "~/lib/donors";

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const ALERT_SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const satisfies readonly AlertSeverity[];

export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

export const ALERT_STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DISMISSED",
] as const satisfies readonly AlertStatus[];

/** Presentation hints only — API enforces allowed transitions. */
const ALERT_STATUS_TRANSITIONS: Record<AlertStatus, readonly AlertStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "DISMISSED"],
  ACKNOWLEDGED: ["RESOLVED", "DISMISSED"],
  RESOLVED: [],
  DISMISSED: [],
};

export type PublicAlertFacility = {
  id: number;
  name: string;
  region?: string;
  district?: string;
};

export type PublicAlert = {
  id: number;
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  facilityId: number | null;
  facility: PublicAlertFacility | null;
  predictionId: number;
  availableUnits: number;
  predictedUnits: number;
  projectedGap: number;
  severity: AlertSeverity;
  status: AlertStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type ListAlertsParams = {
  bloodGroupId?: number;
  bloodGroup?: string;
  facilityId?: number;
  status?: AlertStatus | "";
  severity?: AlertSeverity | "";
  limit?: number;
  offset?: number;
};

export type ListAlertsResult = {
  alerts: PublicAlert[];
  total: number;
  limit: number;
  offset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDateOnlyOrIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return "";
}

function toFiniteNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeBloodGroup(value: unknown): PublicBloodGroup | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  const code = typeof value.code === "string" ? value.code.trim() : "";
  if (!code) {
    return null;
  }
  return {
    id: value.id,
    code,
    abo: typeof value.abo === "string" ? value.abo : "",
    rh: typeof value.rh === "string" ? value.rh : "",
  };
}

function normalizeFacility(value: unknown): PublicAlertFacility | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name.trim() : "",
    region:
      typeof value.region === "string" ? value.region.trim() : undefined,
    district:
      typeof value.district === "string" ? value.district.trim() : undefined,
  };
}

function normalizeSeverity(value: unknown): AlertSeverity {
  if (
    value === "LOW" ||
    value === "MEDIUM" ||
    value === "HIGH" ||
    value === "CRITICAL"
  ) {
    return value;
  }
  return "LOW";
}

function normalizeStatus(value: unknown): AlertStatus {
  if (
    value === "OPEN" ||
    value === "ACKNOWLEDGED" ||
    value === "RESOLVED" ||
    value === "DISMISSED"
  ) {
    return value;
  }
  return "OPEN";
}

/** Normalize an alert DTO from the API (defensive). */
export function normalizeAlert(value: unknown): PublicAlert | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const bloodGroupId =
    typeof value.bloodGroupId === "number" ? value.bloodGroupId : 0;
  if (!bloodGroupId) {
    return null;
  }

  const predictionId =
    typeof value.predictionId === "number" ? value.predictionId : 0;
  if (!predictionId) {
    return null;
  }

  const facilityId =
    typeof value.facilityId === "number" && value.facilityId > 0
      ? value.facilityId
      : null;

  const resolvedRaw = value.resolvedAt;
  const resolvedAt =
    resolvedRaw === null || resolvedRaw === undefined
      ? null
      : toDateOnlyOrIso(resolvedRaw) || null;

  return {
    id: value.id,
    bloodGroupId,
    bloodGroup: normalizeBloodGroup(value.bloodGroup),
    facilityId,
    facility: normalizeFacility(value.facility),
    predictionId,
    availableUnits: toFiniteNumber(
      value.availableUnits ?? value.currentSupply,
    ),
    predictedUnits: toFiniteNumber(
      value.predictedUnits ?? value.predictedDemand,
    ),
    projectedGap: toFiniteNumber(
      value.projectedGap ?? value.gap,
    ),
    severity: normalizeSeverity(value.severity),
    status: normalizeStatus(value.status),
    createdAt: toDateOnlyOrIso(value.createdAt),
    resolvedAt,
  };
}

function extractAlertList(
  data: Record<string, unknown> | null | undefined,
): unknown[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data.alerts)) {
    return data.alerts;
  }
  if (Array.isArray(data.items)) {
    return data.items;
  }
  return [];
}

function buildListQuery(params: ListAlertsParams = {}): string {
  const search = new URLSearchParams();
  if (
    typeof params.bloodGroupId === "number" &&
    Number.isFinite(params.bloodGroupId) &&
    params.bloodGroupId > 0
  ) {
    search.set("bloodGroupId", String(params.bloodGroupId));
  }
  const bloodGroup = params.bloodGroup?.trim() || "";
  if (bloodGroup) {
    search.set("bloodGroup", bloodGroup);
  }
  if (
    typeof params.facilityId === "number" &&
    Number.isFinite(params.facilityId) &&
    params.facilityId > 0
  ) {
    search.set("facilityId", String(params.facilityId));
  }
  const status = params.status?.trim() || "";
  if (
    status === "OPEN" ||
    status === "ACKNOWLEDGED" ||
    status === "RESOLVED" ||
    status === "DISMISSED"
  ) {
    search.set("status", status);
  }
  const severity = params.severity?.trim() || "";
  if (
    severity === "LOW" ||
    severity === "MEDIUM" ||
    severity === "HIGH" ||
    severity === "CRITICAL"
  ) {
    search.set("severity", severity);
  }
  if (
    typeof params.limit === "number" &&
    Number.isFinite(params.limit) &&
    params.limit > 0
  ) {
    search.set("limit", String(params.limit));
  }
  if (
    typeof params.offset === "number" &&
    Number.isFinite(params.offset) &&
    params.offset >= 0
  ) {
    search.set("offset", String(params.offset));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * True when alerts routes are missing or unreachable (not yet mounted).
 * Forbidden/validation errors are NOT treated as unavailable.
 */
export function isAlertsUnavailableError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (error.code === "NETWORK_ERROR" || error.status === 0) {
    return true;
  }
  if (error.status === 501 || error.status === 503) {
    return true;
  }
  return false;
}

/** List paths: 404 usually means the alerts module is not mounted yet. */
export function isAlertsRouteMissingError(error: unknown): boolean {
  return (
    isAlertsUnavailableError(error) ||
    (error instanceof ApiRequestError &&
      (error.status === 404 || error.code === "NOT_FOUND"))
  );
}

/** GET /alerts */
export async function listAlerts(
  params: ListAlertsParams = {},
): Promise<ListAlertsResult> {
  const data = await apiFetch<Record<string, unknown>>(
    "/alerts" + buildListQuery(params),
    { method: "GET" },
  );

  const raw = extractAlertList(data);
  const alerts = raw
    .map(normalizeAlert)
    .filter((alert): alert is PublicAlert => alert !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : alerts.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { alerts, total, limit, offset };
}

/** GET /alerts/:id */
export async function getAlert(alertId: number): Promise<PublicAlert> {
  const data = await apiFetch<Record<string, unknown>>(`/alerts/${alertId}`, {
    method: "GET",
  });

  const candidate = data?.alert ?? data?.item ?? data;
  const alert = normalizeAlert(candidate);
  if (!alert) {
    throw new Error("Invalid alert payload from API");
  }
  return alert;
}

/** PATCH /alerts/:id/status */
export async function patchAlertStatus(
  alertId: number,
  status: AlertStatus,
): Promise<PublicAlert> {
  const data = await apiFetch<Record<string, unknown>>(
    `/alerts/${alertId}/status`,
    {
      method: "PATCH",
      json: { status },
    },
  );

  const candidate = data?.alert ?? data?.item ?? data;
  const alert = normalizeAlert(candidate);
  if (!alert) {
    throw new Error("Invalid alert status payload from API");
  }
  return alert;
}

/** POST /alerts/recalculate — optional; may 404 until module lands. */
export async function recalculateAlerts(): Promise<{ ok: boolean }> {
  const data = await apiFetch<Record<string, unknown>>("/alerts/recalculate", {
    method: "POST",
    json: {},
  });
  if (data?.ok === true) {
    return { ok: true };
  }
  return { ok: true };
}

export type ListAlertMatchesParams = {
  limit?: number;
  offset?: number;
};

export type ListAlertMatchesResult = {
  alert: PublicAlert | null;
  matches: PublicDonor[];
  total: number;
  limit: number;
  offset: number;
  disclaimer: string;
};

/**
 * GET /alerts/:id/matches — on-demand donor matches (docs/08).
 * Never sends notifications; UI must require explicit user review.
 */
export async function listAlertMatches(
  alertId: number,
  params: ListAlertMatchesParams = {},
): Promise<ListAlertMatchesResult> {
  const search = new URLSearchParams();
  if (
    typeof params.limit === "number" &&
    Number.isFinite(params.limit) &&
    params.limit > 0
  ) {
    search.set("limit", String(params.limit));
  }
  if (
    typeof params.offset === "number" &&
    Number.isFinite(params.offset) &&
    params.offset >= 0
  ) {
    search.set("offset", String(params.offset));
  }
  const qs = search.toString();
  const data = await apiFetch<Record<string, unknown>>(
    `/alerts/${alertId}/matches${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );

  const rawMatches = Array.isArray(data?.matches)
    ? data.matches
    : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.donors)
        ? data.donors
        : [];
  const matches = rawMatches
    .map(normalizeDonor)
    .filter((donor): donor is PublicDonor => donor !== null);

  const alertCandidate = data?.alert ?? null;
  const alert = alertCandidate ? normalizeAlert(alertCandidate) : null;

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : matches.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;
  const disclaimer =
    typeof data?.disclaimer === "string" && data.disclaimer.trim()
      ? data.disclaimer.trim()
      : "Matches are potentially eligible registered donors for review — not a medical approval. Notifications are never sent automatically.";

  return { alert, matches, total, limit, offset, disclaimer };
}

export function allowedNextAlertStatuses(
  status: AlertStatus,
): readonly AlertStatus[] {
  return ALERT_STATUS_TRANSITIONS[status] ?? [];
}

export function isTerminalAlertStatus(status: AlertStatus): boolean {
  return (ALERT_STATUS_TRANSITIONS[status] ?? []).length === 0;
}

export function parseAlertStatus(
  value: string | null | undefined,
): AlertStatus | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (
    raw === "OPEN" ||
    raw === "ACKNOWLEDGED" ||
    raw === "RESOLVED" ||
    raw === "DISMISSED"
  ) {
    return raw;
  }
  return "";
}

export function parseAlertSeverity(
  value: string | null | undefined,
): AlertSeverity | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (
    raw === "LOW" ||
    raw === "MEDIUM" ||
    raw === "HIGH" ||
    raw === "CRITICAL"
  ) {
    return raw;
  }
  return "";
}

export function formatAlertStatus(status: AlertStatus | string = ""): string {
  const value = String(status || "").trim().toUpperCase();
  if (value === "OPEN") return "Open";
  if (value === "ACKNOWLEDGED") return "Acknowledged";
  if (value === "RESOLVED") return "Resolved";
  if (value === "DISMISSED") return "Dismissed";
  return status.trim() || "Unknown";
}

export function formatAlertSeverity(
  severity: AlertSeverity | string = "",
): string {
  const value = String(severity || "").trim().toUpperCase();
  if (value === "LOW") return "Low";
  if (value === "MEDIUM") return "Medium";
  if (value === "HIGH") return "High";
  if (value === "CRITICAL") return "Critical";
  return severity.trim() || "Unknown";
}

export function formatAlertBloodGroup(
  alert: PublicAlert | null | undefined,
): string {
  const fromNested = alert?.bloodGroup?.code?.trim();
  if (fromNested) {
    return fromNested;
  }
  const match = BLOOD_GROUP_OPTIONS.find(
    (group) => group.id === alert?.bloodGroupId,
  );
  return match?.code || "—";
}

export function formatAlertFacility(
  facility: PublicAlertFacility | null | undefined,
  facilityId: number = 0,
): string {
  const name = facility?.name?.trim() || "";
  if (!name) {
    return facilityId > 0 ? `Facility #${facilityId}` : "—";
  }
  const region = facility?.region?.trim() || "";
  const district = facility?.district?.trim() || "";
  const place = [district, region].filter(Boolean).join(", ");
  return place ? `${name} (${place})` : name;
}

export function formatUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatDateTime(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "—";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleString();
}

export {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
  BLOOD_GROUP_OPTIONS,
};

export { ApiRequestError };
