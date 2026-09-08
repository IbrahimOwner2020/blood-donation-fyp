/**
 * Donation + donation-centre API helpers for the web app
 * (docs/05 Inventory/Donation screens, docs/04 donations/, TODO.md §4).
 * Presentation-only — validation and RBAC authority live in the API.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  BLOOD_GROUP_OPTIONS,
  type PublicBloodGroup,
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
} from "~/lib/donors";

export type PublicDonationDonor = {
  id: number;
  donorNumber: string;
  firstName: string;
  lastName: string;
};

export type PublicDonationCentreSummary = {
  id: number;
  name: string;
  region: string;
};

export type PublicDonationCentre = {
  id: number;
  name: string;
  region: string;
  address: string | null;
  active: boolean;
};

export type PublicDonation = {
  id: number;
  donorId: number;
  donor: PublicDonationDonor | null;
  donationCentreId: number;
  donationCentre: PublicDonationCentreSummary | null;
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  /** Calendar date YYYY-MM-DD */
  donationDate: string;
  units: number;
  notes: string | null;
  createdBy: number;
  createdAt?: string;
  inventoryUnitCount?: number;
  inventoryUnitIds?: number[];
};

export type ListDonationsParams = {
  donorId?: number;
  donationCentreId?: number;
  bloodGroupId?: number;
  bloodGroup?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type ListDonationsResult = {
  donations: PublicDonation[];
  total: number;
  limit: number;
  offset: number;
};

export type ListDonationCentresParams = {
  region?: string;
  active?: boolean | "";
};

export type CreateDonationInput = {
  donorId: number;
  donationCentreId: number;
  bloodGroupId: number;
  donationDate: string;
  units?: number;
  notes?: string | null;
  facilityId?: number | null;
};

export type UpdateDonationInput = {
  notes?: string | null;
  donationCentreId?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
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

function normalizeDonationDonor(value: unknown): PublicDonationDonor | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  return {
    id: value.id,
    donorNumber:
      typeof value.donorNumber === "string" ? value.donorNumber.trim() : "",
    firstName:
      typeof value.firstName === "string" ? value.firstName.trim() : "",
    lastName: typeof value.lastName === "string" ? value.lastName.trim() : "",
  };
}

function normalizeCentreSummary(
  value: unknown,
): PublicDonationCentreSummary | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name.trim() : "",
    region: typeof value.region === "string" ? value.region.trim() : "",
  };
}

export function normalizeDonationCentre(
  value: unknown,
): PublicDonationCentre | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name.trim() : "",
    region: typeof value.region === "string" ? value.region.trim() : "",
    address: toNullableString(value.address),
    active: value.active === true,
  };
}

function normalizeIdList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ids = value.filter(
    (item): item is number =>
      typeof item === "number" && Number.isFinite(item) && item > 0,
  );
  return ids;
}

/** Normalize a donation DTO from the API (defensive). */
export function normalizeDonation(value: unknown): PublicDonation | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const donorId = typeof value.donorId === "number" ? value.donorId : 0;
  const donationCentreId =
    typeof value.donationCentreId === "number" ? value.donationCentreId : 0;
  const bloodGroupId =
    typeof value.bloodGroupId === "number" ? value.bloodGroupId : 0;
  if (!donorId || !donationCentreId || !bloodGroupId) {
    return null;
  }

  const units =
    typeof value.units === "number" &&
    Number.isFinite(value.units) &&
    value.units > 0
      ? value.units
      : 1;
  const createdBy =
    typeof value.createdBy === "number" && Number.isFinite(value.createdBy)
      ? value.createdBy
      : 0;

  const inventoryUnitCount =
    typeof value.inventoryUnitCount === "number" &&
    Number.isFinite(value.inventoryUnitCount)
      ? value.inventoryUnitCount
      : undefined;
  const inventoryUnitIds = normalizeIdList(value.inventoryUnitIds);

  const donation: PublicDonation = {
    id: value.id,
    donorId,
    donor: normalizeDonationDonor(value.donor),
    donationCentreId,
    donationCentre: normalizeCentreSummary(value.donationCentre),
    bloodGroupId,
    bloodGroup: normalizeBloodGroup(value.bloodGroup),
    donationDate: toDateOnlyString(value.donationDate),
    units,
    notes: toNullableString(value.notes),
    createdBy,
    createdAt: toOptionalString(value.createdAt),
  };

  if (inventoryUnitCount !== undefined) {
    donation.inventoryUnitCount = inventoryUnitCount;
  }
  if (inventoryUnitIds) {
    donation.inventoryUnitIds = inventoryUnitIds;
  }

  return donation;
}

function buildDonationsQuery(params: ListDonationsParams = {}): string {
  const search = new URLSearchParams();
  if (
    typeof params.donorId === "number" &&
    Number.isFinite(params.donorId) &&
    params.donorId > 0
  ) {
    search.set("donorId", String(params.donorId));
  }
  if (
    typeof params.donationCentreId === "number" &&
    Number.isFinite(params.donationCentreId) &&
    params.donationCentreId > 0
  ) {
    search.set("donationCentreId", String(params.donationCentreId));
  }
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
  const from = params.from?.trim() || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    search.set("from", from);
  }
  const to = params.to?.trim() || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    search.set("to", to);
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

function buildCentresQuery(params: ListDonationCentresParams = {}): string {
  const search = new URLSearchParams();
  const region = params.region?.trim() || "";
  if (region) {
    search.set("region", region);
  }
  if (params.active === true || params.active === false) {
    search.set("active", params.active ? "true" : "false");
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** GET /donations */
export async function listDonations(
  params: ListDonationsParams = {},
): Promise<ListDonationsResult> {
  const data = await apiFetch<{
    donations?: unknown;
    total?: unknown;
    limit?: unknown;
    offset?: unknown;
  }>("/donations" + buildDonationsQuery(params), { method: "GET" });

  const raw = Array.isArray(data?.donations) ? data.donations : [];
  const donations = raw
    .map(normalizeDonation)
    .filter((item): item is PublicDonation => item !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : donations.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { donations, total, limit, offset };
}

/** GET /donations/:id */
export async function getDonation(donationId: number): Promise<PublicDonation> {
  const data = await apiFetch<{ donation?: unknown }>(
    `/donations/${donationId}`,
    { method: "GET" },
  );
  const donation = normalizeDonation(data?.donation);
  if (!donation) {
    throw new Error("Invalid donation payload from API");
  }
  return donation;
}

/** POST /donations */
export async function createDonation(
  input: CreateDonationInput,
): Promise<PublicDonation> {
  const body: Record<string, unknown> = {
    donorId: input.donorId,
    donationCentreId: input.donationCentreId,
    bloodGroupId: input.bloodGroupId,
    donationDate: input.donationDate?.trim() || "",
  };

  if (typeof input.units === "number" && Number.isFinite(input.units)) {
    body.units = input.units;
  }
  if (input.notes !== undefined) {
    body.notes = input.notes?.trim() || null;
  }
  if (input.facilityId !== undefined) {
    body.facilityId =
      typeof input.facilityId === "number" && input.facilityId > 0
        ? input.facilityId
        : null;
  }

  const data = await apiFetch<{ donation?: unknown }>("/donations", {
    method: "POST",
    json: body,
  });
  const donation = normalizeDonation(data?.donation);
  if (!donation) {
    throw new Error("Invalid donation payload from API");
  }
  return donation;
}

/** PATCH /donations/:id — notes and/or centre correction. */
export async function updateDonation(
  donationId: number,
  input: UpdateDonationInput,
): Promise<PublicDonation> {
  const body: Record<string, unknown> = {};
  if (input.notes !== undefined) {
    body.notes = input.notes?.trim() || null;
  }
  if (typeof input.donationCentreId === "number") {
    body.donationCentreId = input.donationCentreId;
  }

  const data = await apiFetch<{ donation?: unknown }>(
    `/donations/${donationId}`,
    { method: "PATCH", json: body },
  );
  const donation = normalizeDonation(data?.donation);
  if (!donation) {
    throw new Error("Invalid donation payload from API");
  }
  return donation;
}

/** GET /donation-centres */
export async function listDonationCentres(
  params: ListDonationCentresParams = {},
): Promise<PublicDonationCentre[]> {
  const data = await apiFetch<{ centres?: unknown }>(
    "/donation-centres" + buildCentresQuery(params),
    { method: "GET" },
  );
  const raw = Array.isArray(data?.centres) ? data.centres : [];
  return raw
    .map(normalizeDonationCentre)
    .filter((centre): centre is PublicDonationCentre => centre !== null);
}

export function formatDonationDonorName(
  donor: PublicDonationDonor | null | undefined,
): string {
  const first = donor?.firstName?.trim() || "";
  const last = donor?.lastName?.trim() || "";
  const full = `${first} ${last}`.trim();
  return full || donor?.donorNumber || "Donor";
}

export function formatDonationBloodGroup(
  donation: PublicDonation | null | undefined,
): string {
  const fromNested = donation?.bloodGroup?.code?.trim();
  if (fromNested) {
    return fromNested;
  }
  const match = BLOOD_GROUP_OPTIONS.find(
    (group) => group.id === donation?.bloodGroupId,
  );
  return match?.code || "—";
}

export function formatDonationCentreLabel(
  centre:
    | PublicDonationCentre
    | PublicDonationCentreSummary
    | null
    | undefined,
): string {
  const name = centre?.name?.trim() || "";
  const region = centre?.region?.trim() || "";
  if (name && region) {
    return `${name} (${region})`;
  }
  return name || region || "—";
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

export function todayDateOnly(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidDateOnly(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return false;
  }
  const [y, m, d] = raw.split("-").map(Number);
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

export {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
};

export function isNotFoundApiError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 404 || error.code === "NOT_FOUND")
  );
}
