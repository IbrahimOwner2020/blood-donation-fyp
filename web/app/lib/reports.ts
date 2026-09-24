/**
 * Reports API helpers for the web app (docs/05 /reports, docs/04 Reports, TODO.md §9).
 * Presentation-only — aggregations and filters are computed by the API.
 * Missing report routes (404 / network) should render as empty sections, not crash.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  BLOOD_GROUP_OPTIONS,
  formatApiErrorMessage,
  isForbiddenApiError,
} from "~/lib/donors";

export type PublicBloodGroup = {
  id: number;
  code: string;
  abo: string;
  rh: string;
};

export type ReportFilters = {
  from?: string;
  to?: string;
  bloodGroup?: string;
  asOf?: string;
};

export type InventoryReportGroup = {
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  availableUnits: number;
  reservedUnits: number;
  issuedUnits: number;
  discardedUnits: number;
  expiredUnits: number;
  expiringSoonUnits: number;
  lowStock: boolean;
};

export type InventoryReport = {
  report: "inventory";
  asOf: string;
  groups: InventoryReportGroup[];
  totals: {
    availableUnits: number;
    reservedUnits: number;
    issuedUnits: number;
    discardedUnits: number;
    expiredUnits: number;
    expiringSoonUnits: number;
    lowStockGroupCount: number;
  };
};

export type DonationsReport = {
  report: "donations";
  totals: { donationCount: number; units: number };
  byBloodGroup: Array<{
    bloodGroupId: number;
    bloodGroup: PublicBloodGroup | null;
    donationCount: number;
    units: number;
  }>;
  byDate: Array<{ date: string; donationCount: number; units: number }>;
};

export type BloodRequestsReport = {
  report: "blood-requests";
  totals: {
    unitsRequested: number;
    fulfilledUnits: number;
    unfulfilledUnits: number;
    requestCount: number;
  };
  byBloodGroup: Array<{
    bloodGroupId: number;
    bloodGroup: PublicBloodGroup | null;
    unitsRequested: number;
    fulfilledUnits: number;
    unfulfilledUnits: number;
    requestCount: number;
  }>;
  byDate: Array<{
    date: string;
    unitsRequested: number;
    fulfilledUnits: number;
    unfulfilledUnits: number;
  }>;
};

export type DonorEligibilityReport = {
  report: "donor-eligibility";
  totals: { total: number; eligible: number; waitingPeriod: number; profileIncomplete: number; otherIneligible: number };
  donors: Array<{ donorId: number; donorNumber: string; name: string; bloodGroup: PublicBloodGroup | null; donationCount: number; lastDonationDate: string | null; nextEligibleDate: string | null; daysUntilEligible: number | null; status: string; reasons: string[] }>;
};

export type NotificationsReport = {
  report: "notifications";
  totals: { total: number };
  byStatus: Array<{ status: string; count: number }>;
  byChannel: Array<{ channel: string; count: number }>;
  byBloodGroup: Array<{
    bloodGroupId: number;
    bloodGroup: PublicBloodGroup | null;
    count: number;
  }>;
  byDate: Array<{ date: string; count: number }>;
};

export type ReportSectionStatus<T> =
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

function normalizeBloodGroup(value: unknown): PublicBloodGroup | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toFiniteNumber(value.id, NaN);
  const code = typeof value.code === "string" ? value.code : "";
  if (!Number.isFinite(id) || id <= 0 || !code) {
    return null;
  }
  return {
    id,
    code,
    abo: typeof value.abo === "string" ? value.abo : "",
    rh: typeof value.rh === "string" ? value.rh : "",
  };
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
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

export { isValidDateOnly, formatApiErrorMessage, isForbiddenApiError };

export function isReportUnavailableError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (error.code === "NETWORK_ERROR" || error.status === 0) {
    return true;
  }
  if (error.status === 501 || error.status === 503) {
    return true;
  }
  return (
    error.status === 404 ||
    error.code === "NOT_FOUND"
  );
}

function buildReportQuery(params: ReportFilters = {}): string {
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

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function normalizeInventoryReport(data: unknown): InventoryReport | null {
  if (!isRecord(data)) {
    return null;
  }
  const groupsRaw = Array.isArray(data.groups) ? data.groups : [];
  const totals = isRecord(data.totals) ? data.totals : {};
  return {
    report: "inventory",
    asOf: typeof data.asOf === "string" ? data.asOf : "",
    groups: groupsRaw
      .map((row): InventoryReportGroup | null => {
        if (!isRecord(row)) {
          return null;
        }
        const bloodGroupId = toFiniteNumber(row.bloodGroupId, NaN);
        if (!Number.isFinite(bloodGroupId) || bloodGroupId <= 0) {
          return null;
        }
        return {
          bloodGroupId,
          bloodGroup: normalizeBloodGroup(row.bloodGroup),
          availableUnits: toFiniteNumber(row.availableUnits),
          reservedUnits: toFiniteNumber(row.reservedUnits),
          issuedUnits: toFiniteNumber(row.issuedUnits),
          discardedUnits: toFiniteNumber(row.discardedUnits),
          expiredUnits: toFiniteNumber(row.expiredUnits),
          expiringSoonUnits: toFiniteNumber(row.expiringSoonUnits),
          lowStock: Boolean(row.lowStock),
        };
      })
      .filter((row): row is InventoryReportGroup => row !== null),
    totals: {
      availableUnits: toFiniteNumber(totals.availableUnits),
      reservedUnits: toFiniteNumber(totals.reservedUnits),
      issuedUnits: toFiniteNumber(totals.issuedUnits),
      discardedUnits: toFiniteNumber(totals.discardedUnits),
      expiredUnits: toFiniteNumber(totals.expiredUnits),
      expiringSoonUnits: toFiniteNumber(totals.expiringSoonUnits),
      lowStockGroupCount: toFiniteNumber(totals.lowStockGroupCount),
    },
  };
}

function normalizeDonationsReport(data: unknown): DonationsReport | null {
  if (!isRecord(data)) {
    return null;
  }
  const totals = isRecord(data.totals) ? data.totals : {};
  const byBloodGroup = Array.isArray(data.byBloodGroup)
    ? data.byBloodGroup
    : [];
  const byDate = Array.isArray(data.byDate) ? data.byDate : [];
  return {
    report: "donations",
    totals: {
      donationCount: toFiniteNumber(totals.donationCount),
      units: toFiniteNumber(totals.units),
    },
    byBloodGroup: byBloodGroup
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const bloodGroupId = toFiniteNumber(row.bloodGroupId, NaN);
        if (!Number.isFinite(bloodGroupId) || bloodGroupId <= 0) {
          return null;
        }
        return {
          bloodGroupId,
          bloodGroup: normalizeBloodGroup(row.bloodGroup),
          donationCount: toFiniteNumber(row.donationCount),
          units: toFiniteNumber(row.units),
        };
      })
      .filter(
        (
          row,
        ): row is DonationsReport["byBloodGroup"][number] => row !== null,
      ),
    byDate: byDate
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const date = typeof row.date === "string" ? row.date : "";
        if (!date) {
          return null;
        }
        return {
          date,
          donationCount: toFiniteNumber(row.donationCount),
          units: toFiniteNumber(row.units),
        };
      })
      .filter(
        (row): row is DonationsReport["byDate"][number] => row !== null,
      ),
  };
}

function normalizeBloodRequestsReport(data: unknown): BloodRequestsReport | null {
  if (!isRecord(data)) {
    return null;
  }
  const totals = isRecord(data.totals) ? data.totals : {};
  const byBloodGroup = Array.isArray(data.byBloodGroup)
    ? data.byBloodGroup
    : [];
  const byDate = Array.isArray(data.byDate) ? data.byDate : [];
  return {
    report: "blood-requests",
    totals: {
      unitsRequested: toFiniteNumber(totals.unitsRequested),
      fulfilledUnits: toFiniteNumber(totals.fulfilledUnits),
      unfulfilledUnits: toFiniteNumber(totals.unfulfilledUnits),
      requestCount: toFiniteNumber(totals.requestCount),
    },
    byBloodGroup: byBloodGroup
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const bloodGroupId = toFiniteNumber(row.bloodGroupId, NaN);
        if (!Number.isFinite(bloodGroupId) || bloodGroupId <= 0) {
          return null;
        }
        return {
          bloodGroupId,
          bloodGroup: normalizeBloodGroup(row.bloodGroup),
          unitsRequested: toFiniteNumber(row.unitsRequested),
          fulfilledUnits: toFiniteNumber(row.fulfilledUnits),
          unfulfilledUnits: toFiniteNumber(row.unfulfilledUnits),
          requestCount: toFiniteNumber(row.requestCount),
        };
      })
      .filter(
        (row): row is BloodRequestsReport["byBloodGroup"][number] => row !== null,
      ),
    byDate: byDate
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const date = typeof row.date === "string" ? row.date : "";
        if (!date) {
          return null;
        }
        return {
          date,
          unitsRequested: toFiniteNumber(row.unitsRequested),
          fulfilledUnits: toFiniteNumber(row.fulfilledUnits),
          unfulfilledUnits: toFiniteNumber(row.unfulfilledUnits),
        };
      })
      .filter((row): row is BloodRequestsReport["byDate"][number] => row !== null),
  };
}

function normalizeDonorEligibilityReport(data: unknown): DonorEligibilityReport | null {
  if (!isRecord(data) || !isRecord(data.totals) || !Array.isArray(data.donors)) return null;
  const totals = data.totals;
  return {
    report: "donor-eligibility",
    totals: { total: toFiniteNumber(totals.total), eligible: toFiniteNumber(totals.eligible), waitingPeriod: toFiniteNumber(totals.waitingPeriod), profileIncomplete: toFiniteNumber(totals.profileIncomplete), otherIneligible: toFiniteNumber(totals.otherIneligible) },
    donors: data.donors.filter(isRecord).map((row) => ({ donorId: toFiniteNumber(row.donorId), donorNumber: String(row.donorNumber || ""), name: String(row.name || ""), bloodGroup: normalizeBloodGroup(row.bloodGroup), donationCount: toFiniteNumber(row.donationCount), lastDonationDate: typeof row.lastDonationDate === "string" ? row.lastDonationDate : null, nextEligibleDate: typeof row.nextEligibleDate === "string" ? row.nextEligibleDate : null, daysUntilEligible: row.daysUntilEligible === null ? null : toFiniteNumber(row.daysUntilEligible), status: String(row.status || ""), reasons: Array.isArray(row.reasons) ? row.reasons.filter((reason): reason is string => typeof reason === "string") : [] })),
  };
}

function normalizeNotificationsReport(
  data: unknown,
): NotificationsReport | null {
  if (!isRecord(data)) {
    return null;
  }
  const totals = isRecord(data.totals) ? data.totals : {};
  const byStatus = Array.isArray(data.byStatus) ? data.byStatus : [];
  const byChannel = Array.isArray(data.byChannel) ? data.byChannel : [];
  const byBloodGroup = Array.isArray(data.byBloodGroup)
    ? data.byBloodGroup
    : [];
  const byDate = Array.isArray(data.byDate) ? data.byDate : [];

  return {
    report: "notifications",
    totals: { total: toFiniteNumber(totals.total) },
    byStatus: byStatus
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const status = typeof row.status === "string" ? row.status : "";
        if (!status) {
          return null;
        }
        return { status, count: toFiniteNumber(row.count) };
      })
      .filter(
        (
          row,
        ): row is NotificationsReport["byStatus"][number] => row !== null,
      ),
    byChannel: byChannel
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const channel = typeof row.channel === "string" ? row.channel : "";
        if (!channel) {
          return null;
        }
        return { channel, count: toFiniteNumber(row.count) };
      })
      .filter(
        (
          row,
        ): row is NotificationsReport["byChannel"][number] => row !== null,
      ),
    byBloodGroup: byBloodGroup
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const bloodGroupId = toFiniteNumber(row.bloodGroupId, NaN);
        if (!Number.isFinite(bloodGroupId) || bloodGroupId <= 0) {
          return null;
        }
        return {
          bloodGroupId,
          bloodGroup: normalizeBloodGroup(row.bloodGroup),
          count: toFiniteNumber(row.count),
        };
      })
      .filter(
        (
          row,
        ): row is NotificationsReport["byBloodGroup"][number] =>
          row !== null,
      ),
    byDate: byDate
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }
        const date = typeof row.date === "string" ? row.date : "";
        if (!date) {
          return null;
        }
        return { date, count: toFiniteNumber(row.count) };
      })
      .filter(
        (row): row is NotificationsReport["byDate"][number] => row !== null,
      ),
  };
}

async function fetchReportSection<T>(
  path: string,
  normalize: (data: unknown) => T | null,
  emptyMessage: string,
): Promise<ReportSectionStatus<T>> {
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
          "You do not have permission to view this report.",
        ),
      };
    }
    if (isReportUnavailableError(error)) {
      return {
        status: "empty",
        message: emptyMessage,
      };
    }
    return {
      status: "error",
      message: formatApiErrorMessage(error, "Unable to load this report."),
    };
  }
}

/** GET /reports/inventory */
export async function fetchInventoryReport(
  params: ReportFilters = {},
): Promise<ReportSectionStatus<InventoryReport>> {
  const qs = buildReportQuery({
    asOf: params.asOf || params.to,
    bloodGroup: params.bloodGroup,
  });
  return fetchReportSection(
    `/reports/inventory${qs}`,
    normalizeInventoryReport,
    "Inventory report unavailable.",
  );
}

/** GET /reports/donations */
export async function fetchDonationsReport(
  params: ReportFilters = {},
): Promise<ReportSectionStatus<DonationsReport>> {
  return fetchReportSection(
    `/reports/donations${buildReportQuery(params)}`,
    normalizeDonationsReport,
    "Donations report unavailable.",
  );
}

/** GET /reports/blood-requests */
export async function fetchBloodRequestsReport(
  params: ReportFilters = {},
): Promise<ReportSectionStatus<BloodRequestsReport>> {
  return fetchReportSection(
    `/reports/blood-requests${buildReportQuery(params)}`,
    normalizeBloodRequestsReport,
    "Blood requests report unavailable.",
  );
}

export async function fetchDonorEligibilityReport(params: ReportFilters = {}): Promise<ReportSectionStatus<DonorEligibilityReport>> {
  return fetchReportSection(`/reports/donor-eligibility${buildReportQuery({ bloodGroup: params.bloodGroup })}`, normalizeDonorEligibilityReport, "Donor eligibility report unavailable.");
}

/** GET /reports/notifications */
export async function fetchNotificationsReport(
  params: ReportFilters = {},
): Promise<ReportSectionStatus<NotificationsReport>> {
  return fetchReportSection(
    `/reports/notifications${buildReportQuery(params)}`,
    normalizeNotificationsReport,
    "Notifications report unavailable.",
  );
}

export function formatBloodGroupLabel(
  group: PublicBloodGroup | null | undefined,
): string {
  return group?.code || "—";
}

export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }
  return String(Math.round(value));
}
