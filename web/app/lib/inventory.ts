/**
 * Inventory API helpers for the web app
 * (docs/05 Inventory Screens, docs/04 inventory/, TODO.md §4).
 * Presentation-only — stock totals and status authority live in the API.
 *
 * Inventory list/summary endpoints may land in parallel; callers should treat
 * missing routes (404) and network gaps as empty/unavailable, not crashes.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  BLOOD_GROUP_OPTIONS,
  type PublicBloodGroup,
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
} from "~/lib/donors";

export type InventoryStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "ISSUED"
  | "EXPIRED"
  | "DISCARDED";

export const INVENTORY_STATUSES = [
  "AVAILABLE",
  "RESERVED",
  "ISSUED",
  "EXPIRED",
  "DISCARDED",
] as const satisfies readonly InventoryStatus[];

export type PublicInventoryFacility = {
  id: number;
  name: string;
  region?: string;
  district?: string;
};

export type PublicInventoryUnit = {
  id: number;
  donationId: number | null;
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  collectionDate: string;
  expiryDate: string;
  status: InventoryStatus;
  facilityId: number | null;
  facility: PublicInventoryFacility | null;
  createdAt?: string;
  updatedAt?: string;
};

export type InventorySummaryRow = {
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  availableUnits: number;
  reservedUnits: number;
  expiringSoon: number;
  expired: number;
  lowStock: boolean;
};

export type ListInventoryParams = {
  bloodGroupId?: number;
  bloodGroup?: string;
  status?: InventoryStatus | "";
  facilityId?: number;
  donationId?: number;
  limit?: number;
  offset?: number;
};

export type ListInventoryResult = {
  units: PublicInventoryUnit[];
  total: number;
  limit: number;
  offset: number;
};

export type ListExpiringParams = {
  withinDays?: number;
  bloodGroupId?: number;
  limit?: number;
  offset?: number;
};

export type ListExpiringResult = {
  units: PublicInventoryUnit[];
  total: number;
  limit: number;
  offset: number;
};

export type ListLowStockResult = {
  rows: InventorySummaryRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toDateOnlyString(value: unknown): string {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match?.[1] ?? value.trim().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return "";
}

function toNonNegativeInt(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
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

function normalizeStatus(value: unknown): InventoryStatus {
  if (
    value === "AVAILABLE" ||
    value === "RESERVED" ||
    value === "ISSUED" ||
    value === "EXPIRED" ||
    value === "DISCARDED"
  ) {
    return value;
  }
  return "AVAILABLE";
}

function normalizeFacility(
  value: unknown,
): PublicInventoryFacility | null {
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

/** Normalize an inventory unit DTO from the API (defensive). */
export function normalizeInventoryUnit(
  value: unknown,
): PublicInventoryUnit | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const bloodGroupId =
    typeof value.bloodGroupId === "number" ? value.bloodGroupId : 0;
  if (!bloodGroupId) {
    return null;
  }

  const donationId =
    typeof value.donationId === "number" && value.donationId > 0
      ? value.donationId
      : null;
  const facilityId =
    typeof value.facilityId === "number" && value.facilityId > 0
      ? value.facilityId
      : null;

  return {
    id: value.id,
    donationId,
    bloodGroupId,
    bloodGroup: normalizeBloodGroup(value.bloodGroup),
    collectionDate: toDateOnlyString(value.collectionDate),
    expiryDate: toDateOnlyString(value.expiryDate),
    status: normalizeStatus(value.status),
    facilityId,
    facility: normalizeFacility(value.facility),
    createdAt: toOptionalString(value.createdAt),
    updatedAt: toOptionalString(value.updatedAt),
  };
}

export function normalizeInventorySummaryRow(
  value: unknown,
): InventorySummaryRow | null {
  if (!isRecord(value)) {
    return null;
  }

  let bloodGroupId =
    typeof value.bloodGroupId === "number" ? value.bloodGroupId : 0;
  const bloodGroup = normalizeBloodGroup(value.bloodGroup);
  if (!bloodGroupId && bloodGroup?.id) {
    bloodGroupId = bloodGroup.id;
  }
  if (!bloodGroupId) {
    return null;
  }

  return {
    bloodGroupId,
    bloodGroup,
    availableUnits: toNonNegativeInt(value.availableUnits),
    reservedUnits: toNonNegativeInt(value.reservedUnits),
    expiringSoon: toNonNegativeInt(
      value.expiringSoon ?? value.expiringSoonUnits,
    ),
    expired: toNonNegativeInt(value.expired ?? value.expiredUnits),
    lowStock:
      value.lowStock === true ||
      value.isLowStock === true ||
      String(value.lowStockStatus || "")
        .toUpperCase()
        .includes("LOW"),
  };
}

function extractUnitList(data: Record<string, unknown> | null | undefined): unknown[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data.units)) {
    return data.units;
  }
  if (Array.isArray(data.items)) {
    return data.items;
  }
  if (Array.isArray(data.inventory)) {
    return data.inventory;
  }
  return [];
}

function extractSummaryList(
  data: Record<string, unknown> | null | undefined,
): unknown[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data.summary)) {
    return data.summary;
  }
  if (Array.isArray(data.rows)) {
    return data.rows;
  }
  if (Array.isArray(data.groups)) {
    return data.groups;
  }
  if (Array.isArray(data.items)) {
    return data.items;
  }
  return [];
}

function buildInventoryQuery(params: ListInventoryParams = {}): string {
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
  const status = params.status?.trim() || "";
  if (
    status === "AVAILABLE" ||
    status === "RESERVED" ||
    status === "ISSUED" ||
    status === "EXPIRED" ||
    status === "DISCARDED"
  ) {
    search.set("status", status);
  }
  if (
    typeof params.facilityId === "number" &&
    Number.isFinite(params.facilityId) &&
    params.facilityId > 0
  ) {
    search.set("facilityId", String(params.facilityId));
  }
  if (
    typeof params.donationId === "number" &&
    Number.isFinite(params.donationId) &&
    params.donationId > 0
  ) {
    search.set("donationId", String(params.donationId));
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

function buildExpiringQuery(params: ListExpiringParams = {}): string {
  const search = new URLSearchParams();
  if (
    typeof params.withinDays === "number" &&
    Number.isFinite(params.withinDays) &&
    params.withinDays > 0
  ) {
    search.set("withinDays", String(params.withinDays));
  }
  if (
    typeof params.bloodGroupId === "number" &&
    Number.isFinite(params.bloodGroupId) &&
    params.bloodGroupId > 0
  ) {
    search.set("bloodGroupId", String(params.bloodGroupId));
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
 * True when inventory routes are missing or unreachable (not yet mounted).
 * Forbidden/validation errors are NOT treated as unavailable.
 * Note: HTTP 404 on detail may mean “unit not found” once the module exists —
 * list loaders should treat 404 as unavailable; detail loaders treat 404 as not found.
 */
export function isInventoryUnavailableError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (error.code === "NETWORK_ERROR" || error.status === 0) {
    return true;
  }
  // Some gateways return 501/503 while the module lands in parallel.
  if (error.status === 501 || error.status === 503) {
    return true;
  }
  return false;
}

/** List/summary paths: 404 usually means the inventory module is not mounted yet. */
export function isInventoryRouteMissingError(error: unknown): boolean {
  return (
    isInventoryUnavailableError(error) ||
    (error instanceof ApiRequestError &&
      (error.status === 404 || error.code === "NOT_FOUND"))
  );
}

/** GET /inventory */
export async function listInventory(
  params: ListInventoryParams = {},
): Promise<ListInventoryResult> {
  const data = await apiFetch<Record<string, unknown>>(
    "/inventory" + buildInventoryQuery(params),
    { method: "GET" },
  );

  const raw = extractUnitList(data);
  const units = raw
    .map(normalizeInventoryUnit)
    .filter((unit): unit is PublicInventoryUnit => unit !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : units.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { units, total, limit, offset };
}

/** GET /inventory/summary */
export async function getInventorySummary(): Promise<InventorySummaryRow[]> {
  const data = await apiFetch<Record<string, unknown>>("/inventory/summary", {
    method: "GET",
  });
  const raw = extractSummaryList(data);
  return raw
    .map(normalizeInventorySummaryRow)
    .filter((row): row is InventorySummaryRow => row !== null);
}

/** GET /inventory/expiring */
export async function listExpiringInventory(
  params: ListExpiringParams = {},
): Promise<ListExpiringResult> {
  const data = await apiFetch<Record<string, unknown>>(
    "/inventory/expiring" + buildExpiringQuery(params),
    { method: "GET" },
  );

  const raw = extractUnitList(data);
  const units = raw
    .map(normalizeInventoryUnit)
    .filter((unit): unit is PublicInventoryUnit => unit !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : units.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { units, total, limit, offset };
}

/** GET /inventory/low-stock */
export async function listLowStockInventory(): Promise<ListLowStockResult> {
  const data = await apiFetch<Record<string, unknown>>(
    "/inventory/low-stock",
    { method: "GET" },
  );
  const raw = extractSummaryList(data);
  const rows = raw
    .map(normalizeInventorySummaryRow)
    .filter((row): row is InventorySummaryRow => row !== null);
  return { rows };
}

/** GET /inventory/:id */
export async function getInventoryUnit(
  unitId: number,
): Promise<PublicInventoryUnit> {
  const data = await apiFetch<Record<string, unknown>>(
    `/inventory/${unitId}`,
    { method: "GET" },
  );

  const candidate =
    data?.unit ?? data?.inventory ?? data?.item ?? data;
  const unit = normalizeInventoryUnit(candidate);
  if (!unit) {
    throw new Error("Invalid inventory unit payload from API");
  }
  return unit;
}

export function formatInventoryStatus(
  status: InventoryStatus | string = "",
): string {
  const value = String(status || "").trim().toUpperCase();
  if (value === "AVAILABLE") return "Available";
  if (value === "RESERVED") return "Reserved";
  if (value === "ISSUED") return "Issued";
  if (value === "EXPIRED") return "Expired";
  if (value === "DISCARDED") return "Discarded";
  return status.trim() || "Unknown";
}

export function formatInventoryBloodGroup(
  unit: PublicInventoryUnit | InventorySummaryRow | null | undefined,
): string {
  const fromNested = unit?.bloodGroup?.code?.trim();
  if (fromNested) {
    return fromNested;
  }
  const match = BLOOD_GROUP_OPTIONS.find(
    (group) => group.id === unit?.bloodGroupId,
  );
  return match?.code || "—";
}

export function formatInventoryFacility(
  facility: PublicInventoryFacility | null | undefined,
): string {
  const name = facility?.name?.trim() || "";
  if (!name) {
    return "Unassigned";
  }
  const region = facility?.region?.trim() || "";
  const district = facility?.district?.trim() || "";
  const place = [district, region].filter(Boolean).join(", ");
  return place ? `${name} (${place})` : name;
}

export function formatDateOnly(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "—";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) {
    return raw;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseInventoryStatus(
  value: string | null | undefined,
): InventoryStatus | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (
    raw === "AVAILABLE" ||
    raw === "RESERVED" ||
    raw === "ISSUED" ||
    raw === "EXPIRED" ||
    raw === "DISCARDED"
  ) {
    return raw;
  }
  return "";
}

export {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
};
