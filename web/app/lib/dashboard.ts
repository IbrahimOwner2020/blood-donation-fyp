/**
 * Dashboard API helpers for the web app (docs/05 Dashboard, docs/04 Dashboard).
 * Presentation-only — KPIs, trends, gaps, and severity are API-owned.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  formatApiErrorMessage,
  isForbiddenApiError,
  normalizeAlert,
  type PublicAlert,
} from "~/lib/alerts";
import { BLOOD_GROUP_OPTIONS } from "~/lib/donors";
import {
  normalizePrediction,
  type PublicPrediction,
} from "~/lib/predictions";

export type DashboardPeriod = {
  from: string;
  to: string;
};

export type DashboardKpis = {
  availableUnits: number;
  lowStockGroupCount: number;
  activeAlerts: number;
  donationsThisPeriod: number;
  donationUnitsThisPeriod: number;
  notificationsSentThisPeriod: number;
};

export type DashboardInventoryGroup = {
  bloodGroupId: number;
  bloodGroupCode: string | null;
  availableUnits: number;
  reservedUnits: number;
  issuedUnits: number;
  discardedUnits: number;
  expiredUnits: number;
  expiringSoonUnits: number;
  lowStock: boolean;
};

export type DashboardSummary = {
  period: DashboardPeriod;
  asOf: string;
  lowStockThreshold: number;
  facilityId: number | null;
  kpis: DashboardKpis;
  inventoryByBloodGroup: DashboardInventoryGroup[];
};

export type DashboardTrendPoint = {
  date: string;
  units: number;
};

export type DashboardTrend = {
  period: DashboardPeriod;
  facilityId: number | null;
  bloodGroupId: number | null;
  bloodGroupCode: string | null;
  points: DashboardTrendPoint[];
  totalUnits: number;
};

export type DashboardPredictions = {
  facilityId: number | null;
  predictions: PublicPrediction[];
};

export type DashboardAlerts = {
  alerts: PublicAlert[];
  total: number;
  limit: number;
  activeOnly: boolean;
};

export type DashboardQueryParams = {
  from?: string;
  to?: string;
  days?: number;
  bloodGroup?: string;
  facilityId?: number;
  asOf?: string;
  limit?: number;
  activeOnly?: boolean;
};

export type DashboardSectionStatus<T> =
  | { status: "ok"; data: T }
  | { status: "empty"; message?: string }
  | { status: "error"; message: string }
  | { status: "forbidden"; message?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const n = toFiniteNumber(value, fallback);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

export function isValidDateOnly(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  if (
    typeof y !== "number" ||
    typeof m !== "number" ||
    typeof d !== "number" ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isDashboardUnavailableError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (error.code === "NETWORK_ERROR" || error.status === 0) {
    return true;
  }
  if (error.status === 501 || error.status === 503) {
    return true;
  }
  return error.status === 404 || error.code === "NOT_FOUND";
}

function normalizePeriod(value: unknown): DashboardPeriod {
  if (!isRecord(value)) {
    return { from: "", to: "" };
  }
  return {
    from: typeof value.from === "string" ? value.from : "",
    to: typeof value.to === "string" ? value.to : "",
  };
}

function normalizeKpis(value: unknown): DashboardKpis {
  const raw = isRecord(value) ? value : {};
  return {
    availableUnits: toNonNegativeInt(raw.availableUnits),
    lowStockGroupCount: toNonNegativeInt(raw.lowStockGroupCount),
    activeAlerts: toNonNegativeInt(raw.activeAlerts),
    donationsThisPeriod: toNonNegativeInt(raw.donationsThisPeriod),
    donationUnitsThisPeriod: toNonNegativeInt(raw.donationUnitsThisPeriod),
    notificationsSentThisPeriod: toNonNegativeInt(
      raw.notificationsSentThisPeriod,
    ),
  };
}

function normalizeInventoryGroup(
  value: unknown,
): DashboardInventoryGroup | null {
  if (!isRecord(value)) {
    return null;
  }
  const bloodGroupId = toFiniteNumber(value.bloodGroupId, NaN);
  if (!Number.isFinite(bloodGroupId) || bloodGroupId <= 0) {
    return null;
  }
  const codeFromField =
    typeof value.bloodGroupCode === "string" ? value.bloodGroupCode.trim() : "";
  const nested = isRecord(value.bloodGroup) ? value.bloodGroup : null;
  const codeFromNested =
    nested && typeof nested.code === "string" ? nested.code.trim() : "";
  return {
    bloodGroupId,
    bloodGroupCode: codeFromField || codeFromNested || null,
    availableUnits: toNonNegativeInt(value.availableUnits),
    reservedUnits: toNonNegativeInt(value.reservedUnits),
    issuedUnits: toNonNegativeInt(value.issuedUnits),
    discardedUnits: toNonNegativeInt(value.discardedUnits),
    expiredUnits: toNonNegativeInt(value.expiredUnits),
    expiringSoonUnits: toNonNegativeInt(value.expiringSoonUnits),
    lowStock:
      value.lowStock === true ||
      value.isLowStock === true ||
      String(value.lowStockStatus || "")
        .toUpperCase()
        .includes("LOW"),
  };
}

export function normalizeDashboardSummary(
  data: unknown,
): DashboardSummary | null {
  if (!isRecord(data)) {
    return null;
  }
  const summary = isRecord(data.summary) ? data.summary : data;
  if (!isRecord(summary)) {
    return null;
  }
  const groupsRaw = Array.isArray(summary.inventoryByBloodGroup)
    ? summary.inventoryByBloodGroup
    : [];
  return {
    period: normalizePeriod(summary.period),
    asOf: typeof summary.asOf === "string" ? summary.asOf : "",
    lowStockThreshold: toNonNegativeInt(summary.lowStockThreshold),
    facilityId:
      typeof summary.facilityId === "number" && summary.facilityId > 0
        ? summary.facilityId
        : null,
    kpis: normalizeKpis(summary.kpis),
    inventoryByBloodGroup: groupsRaw
      .map(normalizeInventoryGroup)
      .filter((row): row is DashboardInventoryGroup => row !== null),
  };
}

function normalizeTrendPoint(value: unknown): DashboardTrendPoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const date =
    typeof value.date === "string"
      ? value.date.trim().slice(0, 10)
      : "";
  if (!date) {
    return null;
  }
  return {
    date,
    units: toNonNegativeInt(value.units),
  };
}

export function normalizeDashboardTrend(data: unknown): DashboardTrend | null {
  if (!isRecord(data)) {
    return null;
  }
  const trend = isRecord(data.trend) ? data.trend : data;
  if (!isRecord(trend)) {
    return null;
  }
  const pointsRaw = Array.isArray(trend.points) ? trend.points : [];
  return {
    period: normalizePeriod(trend.period),
    facilityId:
      typeof trend.facilityId === "number" && trend.facilityId > 0
        ? trend.facilityId
        : null,
    bloodGroupId:
      typeof trend.bloodGroupId === "number" && trend.bloodGroupId > 0
        ? trend.bloodGroupId
        : null,
    bloodGroupCode:
      typeof trend.bloodGroupCode === "string" && trend.bloodGroupCode.trim()
        ? trend.bloodGroupCode.trim()
        : null,
    points: pointsRaw
      .map(normalizeTrendPoint)
      .filter((point): point is DashboardTrendPoint => point !== null),
    totalUnits: toNonNegativeInt(trend.totalUnits),
  };
}

export function normalizeDashboardPredictions(
  data: unknown,
): DashboardPredictions | null {
  if (!isRecord(data)) {
    return null;
  }
  const raw = Array.isArray(data.predictions) ? data.predictions : [];
  const predictions = raw
    .map(normalizePrediction)
    .filter((row): row is PublicPrediction => row !== null);
  return {
    facilityId:
      typeof data.facilityId === "number" && data.facilityId > 0
        ? data.facilityId
        : null,
    predictions,
  };
}

export function normalizeDashboardAlerts(
  data: unknown,
): DashboardAlerts | null {
  if (!isRecord(data)) {
    return null;
  }
  const raw = Array.isArray(data.alerts) ? data.alerts : [];
  const alerts = raw
    .map(normalizeAlert)
    .filter((row): row is PublicAlert => row !== null);
  return {
    alerts,
    total: toNonNegativeInt(data.total, alerts.length),
    limit: toNonNegativeInt(data.limit, alerts.length || 10),
    activeOnly: data.activeOnly !== false,
  };
}

function buildDashboardQuery(params: DashboardQueryParams = {}): string {
  const search = new URLSearchParams();
  const from = (params.from || "").trim();
  const to = (params.to || "").trim();
  const asOf = (params.asOf || "").trim();
  const bloodGroup = (params.bloodGroup || "").trim();

  if (from && isValidDateOnly(from)) {
    search.set("from", from);
  }
  if (to && isValidDateOnly(to)) {
    search.set("to", to);
  }
  if (asOf && isValidDateOnly(asOf)) {
    search.set("asOf", asOf);
  }
  if (
    bloodGroup &&
    BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroup)
  ) {
    search.set("bloodGroup", bloodGroup);
  }
  if (
    typeof params.facilityId === "number" &&
    Number.isFinite(params.facilityId) &&
    params.facilityId > 0
  ) {
    search.set("facilityId", String(params.facilityId));
  }
  if (
    typeof params.days === "number" &&
    Number.isFinite(params.days) &&
    params.days >= 1
  ) {
    search.set("days", String(Math.floor(params.days)));
  }
  if (
    typeof params.limit === "number" &&
    Number.isFinite(params.limit) &&
    params.limit >= 1
  ) {
    search.set("limit", String(Math.floor(params.limit)));
  }
  if (typeof params.activeOnly === "boolean") {
    search.set("activeOnly", params.activeOnly ? "true" : "false");
  }

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function fetchDashboardSection<T>(
  path: string,
  normalize: (data: unknown) => T | null,
  emptyMessage: string,
): Promise<DashboardSectionStatus<T>> {
  try {
    const data = await apiFetch<unknown>(path, { method: "GET" });
    const normalized = normalize(data);
    if (!normalized) {
      return { status: "empty", message: emptyMessage };
    }
    return { status: "ok", data: normalized };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view this dashboard section.",
        ),
      };
    }
    if (isDashboardUnavailableError(error)) {
      return {
        status: "empty",
        message: emptyMessage,
      };
    }
    return {
      status: "error",
      message: formatApiErrorMessage(
        error,
        "Unable to load this dashboard section.",
      ),
    };
  }
}

/** GET /dashboard/summary */
export async function fetchDashboardSummary(
  params: DashboardQueryParams = {},
): Promise<DashboardSectionStatus<DashboardSummary>> {
  return fetchDashboardSection(
    `/dashboard/summary${buildDashboardQuery(params)}`,
    normalizeDashboardSummary,
    "Dashboard summary unavailable.",
  );
}

/** GET /dashboard/inventory-trend */
export async function fetchInventoryTrend(
  params: DashboardQueryParams = {},
): Promise<DashboardSectionStatus<DashboardTrend>> {
  return fetchDashboardSection(
    `/dashboard/inventory-trend${buildDashboardQuery(params)}`,
    normalizeDashboardTrend,
    "Inventory trend unavailable.",
  );
}

/** GET /dashboard/donation-trend */
export async function fetchDonationTrend(
  params: DashboardQueryParams = {},
): Promise<DashboardSectionStatus<DashboardTrend>> {
  return fetchDashboardSection(
    `/dashboard/donation-trend${buildDashboardQuery(params)}`,
    normalizeDashboardTrend,
    "Donation trend unavailable.",
  );
}

/** GET /dashboard/demand-trend */
export async function fetchDemandTrend(
  params: DashboardQueryParams = {},
): Promise<DashboardSectionStatus<DashboardTrend>> {
  return fetchDashboardSection(
    `/dashboard/demand-trend${buildDashboardQuery(params)}`,
    normalizeDashboardTrend,
    "Demand trend unavailable.",
  );
}

/** GET /dashboard/predictions */
export async function fetchDashboardPredictions(
  params: DashboardQueryParams = {},
): Promise<DashboardSectionStatus<DashboardPredictions>> {
  return fetchDashboardSection(
    `/dashboard/predictions${buildDashboardQuery({
      bloodGroup: params.bloodGroup,
      facilityId: params.facilityId,
      limit: params.limit ?? 16,
    })}`,
    normalizeDashboardPredictions,
    "Prediction snapshot unavailable.",
  );
}

/** GET /dashboard/alerts */
export async function fetchDashboardAlerts(
  params: DashboardQueryParams = {},
): Promise<DashboardSectionStatus<DashboardAlerts>> {
  return fetchDashboardSection(
    `/dashboard/alerts${buildDashboardQuery({
      bloodGroup: params.bloodGroup,
      facilityId: params.facilityId,
      limit: params.limit ?? 10,
      activeOnly: params.activeOnly ?? true,
    })}`,
    normalizeDashboardAlerts,
    "Dashboard alerts unavailable.",
  );
}

export function formatDashboardCount(
  value: number | null | undefined,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }
  return String(Math.round(value));
}

export function formatInventoryGroupLabel(
  group: DashboardInventoryGroup | null | undefined,
): string {
  const code = group?.bloodGroupCode?.trim();
  if (code) {
    return code;
  }
  const match = BLOOD_GROUP_OPTIONS.find(
    (option) => option.id === group?.bloodGroupId,
  );
  return match?.code || "—";
}

export {
  formatApiErrorMessage,
  formatAlertBloodGroup,
  formatAlertFacility,
  formatAlertSeverity,
  formatAlertStatus,
  formatUnits,
  isForbiddenApiError,
} from "~/lib/alerts";
