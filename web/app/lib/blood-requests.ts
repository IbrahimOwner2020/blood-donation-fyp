/**
 * Blood request + facility API helpers for the web app
 * (docs/05 Request screens, docs/04 blood-requests/, TODO.md §5).
 * Presentation-only — status machine and RBAC authority live in the API.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import { BLOOD_GROUP_OPTIONS, type PublicBloodGroup } from "~/lib/donors";

export type BloodRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "PARTIAL"
  | "FULFILLED"
  | "CANCELLED";

export type BloodRequestPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export const BLOOD_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "PARTIAL",
  "FULFILLED",
  "CANCELLED",
] as const satisfies readonly BloodRequestStatus[];

export const BLOOD_REQUEST_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
] as const satisfies readonly BloodRequestPriority[];

/**
 * UI mirror of API transitions (api blood-requests/status-machine).
 * Display/constraint only — API rejects illegal transitions.
 */
export const BLOOD_REQUEST_TRANSITIONS: Record<
  BloodRequestStatus,
  readonly BloodRequestStatus[]
> = {
  PENDING: ["APPROVED", "CANCELLED"],
  APPROVED: ["PARTIAL", "FULFILLED", "CANCELLED"],
  PARTIAL: ["PARTIAL", "FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export type PublicFacility = {
  id: number;
  name: string;
  region: string;
  district: string;
  active: boolean;
};

export type PublicBloodRequest = {
  id: number;
  facilityId: number;
  facility: PublicFacility | null;
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  unitsRequested: number;
  priority: BloodRequestPriority;
  requestedAt: string;
  requiredAt: string | null;
  status: BloodRequestStatus;
  fulfilledUnits: number;
  createdBy: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ListBloodRequestsParams = {
  facilityId?: number;
  bloodGroupId?: number;
  status?: BloodRequestStatus | "";
  priority?: BloodRequestPriority | "";
  limit?: number;
  offset?: number;
};

export type ListBloodRequestsResult = {
  bloodRequests: PublicBloodRequest[];
  total: number;
  limit: number;
  offset: number;
};

export type ListFacilitiesParams = {
  region?: string;
  district?: string;
  active?: boolean | "";
  q?: string;
};

export type CreateBloodRequestInput = {
  facilityId: number;
  bloodGroupId: number;
  unitsRequested: number;
  priority?: BloodRequestPriority;
  requestedAt?: string;
  requiredAt?: string | null;
};

export type PatchBloodRequestInput = {
  status: BloodRequestStatus;
  fulfilledUnits?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toDateString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return "";
}

function toNullableDateString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const asString = toDateString(value);
  return asString || null;
}

function normalizeStatus(value: unknown): BloodRequestStatus {
  if (
    value === "PENDING" ||
    value === "APPROVED" ||
    value === "PARTIAL" ||
    value === "FULFILLED" ||
    value === "CANCELLED"
  ) {
    return value;
  }
  return "PENDING";
}

function normalizePriority(value: unknown): BloodRequestPriority {
  if (
    value === "LOW" ||
    value === "MEDIUM" ||
    value === "HIGH" ||
    value === "URGENT"
  ) {
    return value;
  }
  return "MEDIUM";
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

export function normalizeFacility(value: unknown): PublicFacility | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name.trim() : "",
    region: typeof value.region === "string" ? value.region.trim() : "",
    district: typeof value.district === "string" ? value.district.trim() : "",
    active: value.active === true,
  };
}

/** Normalize a blood-request DTO from the API (defensive). */
export function normalizeBloodRequest(
  value: unknown,
): PublicBloodRequest | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const facilityId =
    typeof value.facilityId === "number" ? value.facilityId : 0;
  const bloodGroupId =
    typeof value.bloodGroupId === "number" ? value.bloodGroupId : 0;
  const unitsRequested =
    typeof value.unitsRequested === "number" ? value.unitsRequested : 0;
  if (!facilityId || !bloodGroupId || unitsRequested < 1) {
    return null;
  }

  const fulfilledUnits =
    typeof value.fulfilledUnits === "number" &&
    Number.isFinite(value.fulfilledUnits)
      ? value.fulfilledUnits
      : 0;
  const createdBy =
    typeof value.createdBy === "number" && Number.isFinite(value.createdBy)
      ? value.createdBy
      : 0;

  return {
    id: value.id,
    facilityId,
    facility: normalizeFacility(value.facility),
    bloodGroupId,
    bloodGroup: normalizeBloodGroup(value.bloodGroup),
    unitsRequested,
    priority: normalizePriority(value.priority),
    requestedAt: toDateString(value.requestedAt),
    requiredAt: toNullableDateString(value.requiredAt),
    status: normalizeStatus(value.status),
    fulfilledUnits,
    createdBy,
    createdAt: toOptionalString(value.createdAt),
    updatedAt: toOptionalString(value.updatedAt),
  };
}

function buildBloodRequestsQuery(params: ListBloodRequestsParams = {}): string {
  const search = new URLSearchParams();
  if (
    typeof params.facilityId === "number" &&
    Number.isFinite(params.facilityId) &&
    params.facilityId > 0
  ) {
    search.set("facilityId", String(params.facilityId));
  }
  if (
    typeof params.bloodGroupId === "number" &&
    Number.isFinite(params.bloodGroupId) &&
    params.bloodGroupId > 0
  ) {
    search.set("bloodGroupId", String(params.bloodGroupId));
  }
  const status = params.status?.trim() || "";
  if (
    status === "PENDING" ||
    status === "APPROVED" ||
    status === "PARTIAL" ||
    status === "FULFILLED" ||
    status === "CANCELLED"
  ) {
    search.set("status", status);
  }
  const priority = params.priority?.trim() || "";
  if (
    priority === "LOW" ||
    priority === "MEDIUM" ||
    priority === "HIGH" ||
    priority === "URGENT"
  ) {
    search.set("priority", priority);
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

function buildFacilitiesQuery(params: ListFacilitiesParams = {}): string {
  const search = new URLSearchParams();
  const region = params.region?.trim() || "";
  if (region) {
    search.set("region", region);
  }
  const district = params.district?.trim() || "";
  if (district) {
    search.set("district", district);
  }
  if (params.active === true || params.active === false) {
    search.set("active", params.active ? "true" : "false");
  }
  const q = params.q?.trim() || "";
  if (q) {
    search.set("q", q);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** GET /blood-requests */
export async function listBloodRequests(
  params: ListBloodRequestsParams = {},
): Promise<ListBloodRequestsResult> {
  const data = await apiFetch<{
    bloodRequests?: unknown;
    total?: unknown;
    limit?: unknown;
    offset?: unknown;
  }>("/blood-requests" + buildBloodRequestsQuery(params), { method: "GET" });

  const raw = Array.isArray(data?.bloodRequests) ? data.bloodRequests : [];
  const bloodRequests = raw
    .map(normalizeBloodRequest)
    .filter((item): item is PublicBloodRequest => item !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : bloodRequests.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { bloodRequests, total, limit, offset };
}

/** GET /blood-requests/:id */
export async function getBloodRequest(
  requestId: number,
): Promise<PublicBloodRequest> {
  const data = await apiFetch<{ bloodRequest?: unknown }>(
    `/blood-requests/${requestId}`,
    { method: "GET" },
  );
  const bloodRequest = normalizeBloodRequest(data?.bloodRequest);
  if (!bloodRequest) {
    throw new Error("Invalid blood request payload from API");
  }
  return bloodRequest;
}

/** POST /blood-requests */
export async function createBloodRequest(
  input: CreateBloodRequestInput,
): Promise<PublicBloodRequest> {
  const body: Record<string, unknown> = {
    facilityId: input.facilityId,
    bloodGroupId: input.bloodGroupId,
    unitsRequested: input.unitsRequested,
  };
  if (input.priority) {
    body.priority = input.priority;
  }
  if (input.requestedAt?.trim()) {
    body.requestedAt = input.requestedAt.trim();
  }
  if (input.requiredAt !== undefined) {
    body.requiredAt = input.requiredAt?.trim() || null;
  }

  const data = await apiFetch<{ bloodRequest?: unknown }>("/blood-requests", {
    method: "POST",
    json: body,
  });
  const bloodRequest = normalizeBloodRequest(data?.bloodRequest);
  if (!bloodRequest) {
    throw new Error("Invalid blood request payload from API");
  }
  return bloodRequest;
}

/** PATCH /blood-requests/:id — status / fulfilment (API enforces machine). */
export async function patchBloodRequest(
  requestId: number,
  input: PatchBloodRequestInput,
): Promise<PublicBloodRequest> {
  const body: Record<string, unknown> = {
    status: input.status,
  };
  if (typeof input.fulfilledUnits === "number") {
    body.fulfilledUnits = input.fulfilledUnits;
  }

  const data = await apiFetch<{ bloodRequest?: unknown }>(
    `/blood-requests/${requestId}`,
    { method: "PATCH", json: body },
  );
  const bloodRequest = normalizeBloodRequest(data?.bloodRequest);
  if (!bloodRequest) {
    throw new Error("Invalid blood request payload from API");
  }
  return bloodRequest;
}

/** GET /facilities */
export async function listFacilities(
  params: ListFacilitiesParams = {},
): Promise<PublicFacility[]> {
  const data = await apiFetch<{ facilities?: unknown }>(
    "/facilities" + buildFacilitiesQuery(params),
    { method: "GET" },
  );
  const raw = Array.isArray(data?.facilities) ? data.facilities : [];
  return raw
    .map(normalizeFacility)
    .filter((facility): facility is PublicFacility => facility !== null);
}

export function allowedNextStatuses(
  status: BloodRequestStatus,
): readonly BloodRequestStatus[] {
  return BLOOD_REQUEST_TRANSITIONS[status] ?? [];
}

export function isTerminalRequestStatus(status: BloodRequestStatus): boolean {
  return (BLOOD_REQUEST_TRANSITIONS[status] ?? []).length === 0;
}

export function statusNeedsFulfilledUnits(
  status: BloodRequestStatus,
): boolean {
  return status === "PARTIAL";
}

export function formatRequestStatus(
  status: BloodRequestStatus | string = "",
): string {
  const value = String(status || "").trim().toUpperCase();
  if (value === "PENDING") return "Pending";
  if (value === "APPROVED") return "Approved";
  if (value === "PARTIAL") return "Partial";
  if (value === "FULFILLED") return "Fulfilled";
  if (value === "CANCELLED") return "Cancelled";
  return status.trim() || "Unknown";
}

export function formatRequestPriority(
  priority: BloodRequestPriority | string = "",
): string {
  const value = String(priority || "").trim().toUpperCase();
  if (value === "LOW") return "Low";
  if (value === "MEDIUM") return "Medium";
  if (value === "HIGH") return "High";
  if (value === "URGENT") return "Urgent";
  return priority.trim() || "—";
}

export function formatFacilityLabel(
  facility: PublicFacility | null | undefined,
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

export function formatBloodGroupCode(
  bloodGroup: PublicBloodGroup | null | undefined,
  bloodGroupId: number = 0,
): string {
  const fromNested = bloodGroup?.code?.trim();
  if (fromNested) {
    return fromNested;
  }
  const match = BLOOD_GROUP_OPTIONS.find((group) => group.id === bloodGroupId);
  return match?.code || (bloodGroupId > 0 ? `#${bloodGroupId}` : "—");
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

/** Convert datetime-local form value → ISO-8601 for the API. */
export function datetimeLocalToIso(
  value: string | null | undefined,
): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

export function parseBloodRequestStatus(
  value: string | null | undefined,
): BloodRequestStatus | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (
    raw === "PENDING" ||
    raw === "APPROVED" ||
    raw === "PARTIAL" ||
    raw === "FULFILLED" ||
    raw === "CANCELLED"
  ) {
    return raw;
  }
  return "";
}

export function parseBloodRequestPriority(
  value: string | null | undefined,
): BloodRequestPriority | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (
    raw === "LOW" ||
    raw === "MEDIUM" ||
    raw === "HIGH" ||
    raw === "URGENT"
  ) {
    return raw;
  }
  return "";
}

export function parsePositiveInt(
  value: string | null | undefined,
  fallback: number = NaN,
): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function parseNonNegativeInt(
  value: string | null | undefined,
  fallback: number = NaN,
): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function isForbiddenApiError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 403 ||
      error.code === "FORBIDDEN" ||
      error.code === "PERMISSION_DENIED")
  );
}

export function formatApiErrorMessage(
  error: unknown,
  fallback: string = "Request failed.",
): string {
  if (error instanceof ApiRequestError) {
    const detailMessages = (error.details ?? [])
      .map((detail) => detail?.message?.trim() || "")
      .filter(Boolean);
    if (detailMessages.length > 0) {
      return `${error.message || fallback} (${detailMessages.join("; ")})`;
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function transitionMachineSummary(): string {
  return [
    "PENDING → APPROVED | CANCELLED",
    "APPROVED → PARTIAL | FULFILLED | CANCELLED",
    "PARTIAL → PARTIAL | FULFILLED | CANCELLED",
    "FULFILLED / CANCELLED → (terminal)",
  ].join(" · ");
}

export { BLOOD_GROUP_OPTIONS };
