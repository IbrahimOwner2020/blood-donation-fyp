/**
 * Donor API helpers for the web app (docs/05 Donor Screens, TODO.md §3).
 * Presentation-only — validation authority and RBAC live in the API.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";

export type DonorEligibilityStatus =
  | "POTENTIALLY_ELIGIBLE"
  | "TEMPORARILY_INELIGIBLE"
  | "INELIGIBLE"
  | "UNKNOWN";

export const DONOR_ELIGIBILITY_STATUSES = [
  "POTENTIALLY_ELIGIBLE",
  "TEMPORARILY_INELIGIBLE",
  "INELIGIBLE",
  "UNKNOWN",
] as const satisfies readonly DonorEligibilityStatus[];

export type PublicBloodGroup = {
  id: number;
  code: string;
  abo: string;
  rh: string;
};

export type PublicDonor = {
  id: number;
  userId: number | null;
  donorNumber: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  sex: "MALE" | "FEMALE" | null;
  address: string | null;
  weightKg: number | null;
  smsConsent: boolean;
  emailConsent: boolean;
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  /**
   * Operational flag only. POTENTIALLY_ELIGIBLE means registered / potentially
   * eligible for outreach — not a medical approval.
   */
  eligibilityStatus: DonorEligibilityStatus;
  active: boolean;
  donationCount: number;
  lastDonationDate: string | null;
  preliminaryEligibility: {
    status: string;
    reasons: string[];
    profileComplete: boolean;
    age: number | null;
    nextEligibleDate: string | null;
    daysUntilEligible: number | null;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type ListDonorsParams = {
  bloodGroup?: string;
  bloodGroupId?: number;
  /** Donors with ≥1 donation at this centre. */
  donationCentreId?: number;
  active?: boolean | "";
  eligibilityStatus?: DonorEligibilityStatus | "";
  q?: string;
  limit?: number;
  offset?: number;
};

export type ListDonorsResult = {
  donors: PublicDonor[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateDonorInput = {
  donorNumber?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  sex: "MALE" | "FEMALE";
  address: string;
  weightKg: number;
  smsConsent?: boolean;
  emailConsent?: boolean;
  bloodGroupId: number;
  eligibilityStatus?: DonorEligibilityStatus;
  active?: boolean;
};

export type UpdateDonorInput = {
  donorNumber?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string;
  sex?: "MALE" | "FEMALE";
  address?: string;
  weightKg?: number;
  smsConsent?: boolean;
  emailConsent?: boolean;
  bloodGroupId?: number;
  eligibilityStatus?: DonorEligibilityStatus;
  active?: boolean;
};

/**
 * Canonical ABO/Rh codes (docs/06). IDs match the standard seed insert order
 * on a fresh database (auto-increment starting at 1). Prefer `bloodGroup`
 * from API donor payloads when available.
 */
export const BLOOD_GROUP_OPTIONS: readonly PublicBloodGroup[] = [
  { id: 1, code: "A+", abo: "A", rh: "+" },
  { id: 2, code: "A-", abo: "A", rh: "-" },
  { id: 3, code: "B+", abo: "B", rh: "+" },
  { id: 4, code: "B-", abo: "B", rh: "-" },
  { id: 5, code: "AB+", abo: "AB", rh: "+" },
  { id: 6, code: "AB-", abo: "AB", rh: "-" },
  { id: 7, code: "O+", abo: "O", rh: "+" },
  { id: 8, code: "O-", abo: "O", rh: "-" },
] as const;

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

function normalizeEligibilityStatus(value: unknown): DonorEligibilityStatus {
  if (
    value === "POTENTIALLY_ELIGIBLE" ||
    value === "TEMPORARILY_INELIGIBLE" ||
    value === "INELIGIBLE" ||
    value === "UNKNOWN"
  ) {
    return value;
  }
  return "UNKNOWN";
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalize a donor DTO from the API (defensive). */
export function normalizeDonor(value: unknown): PublicDonor | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const bloodGroupId =
    typeof value.bloodGroupId === "number" ? value.bloodGroupId : 0;
  if (!bloodGroupId) {
    return null;
  }

  return {
    id: value.id,
    userId:
      typeof value.userId === "number" && Number.isFinite(value.userId)
        ? value.userId
        : null,
    donorNumber:
      typeof value.donorNumber === "string" ? value.donorNumber.trim() : "",
    firstName:
      typeof value.firstName === "string" ? value.firstName.trim() : "",
    lastName: typeof value.lastName === "string" ? value.lastName.trim() : "",
    phone: toNullableString(value.phone),
    email: toNullableString(value.email),
    dateOfBirth: toNullableString(value.dateOfBirth),
    sex: value.sex === "MALE" || value.sex === "FEMALE" ? value.sex : null,
    address: toNullableString(value.address),
    weightKg: toFiniteNumber(value.weightKg),
    smsConsent: value.smsConsent === true,
    emailConsent: value.emailConsent === true,
    bloodGroupId,
    bloodGroup: normalizeBloodGroup(value.bloodGroup),
    eligibilityStatus: normalizeEligibilityStatus(value.eligibilityStatus),
    active: value.active === true,
    donationCount: toFiniteNumber(value.donationCount) ?? 0,
    lastDonationDate: toNullableString(value.lastDonationDate),
    preliminaryEligibility: isRecord(value.preliminaryEligibility)
      ? {
          status:
            typeof value.preliminaryEligibility.status === "string"
              ? value.preliminaryEligibility.status
              : "PROFILE_INCOMPLETE",
          reasons: Array.isArray(value.preliminaryEligibility.reasons)
            ? value.preliminaryEligibility.reasons.filter(
                (reason): reason is string => typeof reason === "string",
              )
            : [],
          profileComplete: value.preliminaryEligibility.profileComplete === true,
          age: toFiniteNumber(value.preliminaryEligibility.age),
          nextEligibleDate: toNullableString(
            value.preliminaryEligibility.nextEligibleDate,
          ),
          daysUntilEligible: toFiniteNumber(
            value.preliminaryEligibility.daysUntilEligible,
          ),
        }
      : {
          status: "PROFILE_INCOMPLETE",
          reasons: ["Complete the donor profile"],
          profileComplete: false,
          age: null,
          nextEligibleDate: null,
          daysUntilEligible: null,
        },
    createdAt: toOptionalString(value.createdAt),
    updatedAt: toOptionalString(value.updatedAt),
  };
}

function buildDonorsQuery(params: ListDonorsParams = {}): string {
  const search = new URLSearchParams();
  const bloodGroup = params.bloodGroup?.trim() || "";
  if (bloodGroup) {
    search.set("bloodGroup", bloodGroup);
  }
  if (
    typeof params.bloodGroupId === "number" &&
    Number.isFinite(params.bloodGroupId) &&
    params.bloodGroupId > 0
  ) {
    search.set("bloodGroupId", String(params.bloodGroupId));
  }
  if (
    typeof params.donationCentreId === "number" &&
    Number.isFinite(params.donationCentreId) &&
    params.donationCentreId > 0
  ) {
    search.set("donationCentreId", String(params.donationCentreId));
  }
  if (params.active === true || params.active === false) {
    search.set("active", params.active ? "true" : "false");
  }
  const eligibility = params.eligibilityStatus?.trim() || "";
  if (
    eligibility === "POTENTIALLY_ELIGIBLE" ||
    eligibility === "TEMPORARILY_INELIGIBLE" ||
    eligibility === "INELIGIBLE" ||
    eligibility === "UNKNOWN"
  ) {
    search.set("eligibilityStatus", eligibility);
  }
  const q = params.q?.trim() || "";
  if (q) {
    search.set("q", q);
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

/** GET /donors */
export async function listDonors(
  params: ListDonorsParams = {},
): Promise<ListDonorsResult> {
  const data = await apiFetch<{
    donors?: unknown;
    total?: unknown;
    limit?: unknown;
    offset?: unknown;
  }>("/donors" + buildDonorsQuery(params), { method: "GET" });

  const raw = Array.isArray(data?.donors) ? data.donors : [];
  const donors = raw
    .map(normalizeDonor)
    .filter((donor): donor is PublicDonor => donor !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : donors.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { donors, total, limit, offset };
}

/** GET /donors/:id */
export async function getDonor(donorId: number): Promise<PublicDonor> {
  const data = await apiFetch<{ donor?: unknown }>(`/donors/${donorId}`, {
    method: "GET",
  });
  const donor = normalizeDonor(data?.donor);
  if (!donor) {
    throw new Error("Invalid donor payload from API");
  }
  return donor;
}

/** POST /donors */
export async function createDonor(
  input: CreateDonorInput,
): Promise<PublicDonor> {
  const body: Record<string, unknown> = {
    firstName: input.firstName?.trim() || "",
    lastName: input.lastName?.trim() || "",
    phone: input.phone.trim(),
    email: input.email.trim(),
    dateOfBirth: input.dateOfBirth,
    sex: input.sex,
    address: input.address.trim(),
    weightKg: input.weightKg,
    smsConsent: input.smsConsent === true,
    emailConsent: input.emailConsent === true,
    bloodGroupId: input.bloodGroupId,
  };

  if (input.donorNumber?.trim()) body.donorNumber = input.donorNumber.trim();

  if (input.phone !== undefined) {
    body.phone = input.phone?.trim() || null;
  }
  if (input.email !== undefined) {
    body.email = input.email?.trim() || null;
  }
  if (input.dateOfBirth !== undefined) body.dateOfBirth = input.dateOfBirth;
  if (input.sex !== undefined) body.sex = input.sex;
  if (input.address !== undefined) body.address = input.address.trim();
  if (input.weightKg !== undefined) body.weightKg = input.weightKg;
  if (input.smsConsent !== undefined) body.smsConsent = input.smsConsent;
  if (input.emailConsent !== undefined) body.emailConsent = input.emailConsent;
  if (input.eligibilityStatus) {
    body.eligibilityStatus = input.eligibilityStatus;
  }
  if (typeof input.active === "boolean") {
    body.active = input.active;
  }

  const data = await apiFetch<{ donor?: unknown }>("/donors", {
    method: "POST",
    json: body,
  });
  const donor = normalizeDonor(data?.donor);
  if (!donor) {
    throw new Error("Invalid donor payload from API");
  }
  return donor;
}

/** PATCH /donors/:id */
export async function updateDonor(
  donorId: number,
  input: UpdateDonorInput,
): Promise<PublicDonor> {
  const body: Record<string, unknown> = {};

  if (input.donorNumber !== undefined) {
    body.donorNumber = input.donorNumber.trim();
  }
  if (input.firstName !== undefined) {
    body.firstName = input.firstName.trim();
  }
  if (input.lastName !== undefined) {
    body.lastName = input.lastName.trim();
  }
  if (input.phone !== undefined) {
    body.phone = input.phone?.trim() || null;
  }
  if (input.email !== undefined) {
    body.email = input.email?.trim() || null;
  }
  if (input.bloodGroupId !== undefined) {
    body.bloodGroupId = input.bloodGroupId;
  }
  if (input.eligibilityStatus !== undefined) {
    body.eligibilityStatus = input.eligibilityStatus;
  }
  if (typeof input.active === "boolean") {
    body.active = input.active;
  }

  const data = await apiFetch<{ donor?: unknown }>(`/donors/${donorId}`, {
    method: "PATCH",
    json: body,
  });
  const donor = normalizeDonor(data?.donor);
  if (!donor) {
    throw new Error("Invalid donor payload from API");
  }
  return donor;
}

/** DELETE /donors/:id — soft-deactivate (active=false). */
export async function deactivateDonor(donorId: number): Promise<PublicDonor> {
  const data = await apiFetch<{ donor?: unknown }>(`/donors/${donorId}`, {
    method: "DELETE",
  });
  const donor = normalizeDonor(data?.donor);
  if (!donor) {
    throw new Error("Invalid donor payload from API");
  }
  return donor;
}

/**
 * Display label for eligibility — never implies medical clearance.
 */
export function formatEligibilityStatus(
  status: DonorEligibilityStatus | string = "",
): string {
  const value = String(status || "").trim().toUpperCase();
  if (value === "POTENTIALLY_ELIGIBLE") {
    return "Potentially eligible";
  }
  if (value === "TEMPORARILY_INELIGIBLE") {
    return "Temporarily ineligible";
  }
  if (value === "INELIGIBLE") {
    return "Ineligible";
  }
  if (value === "UNKNOWN") {
    return "Unknown";
  }
  return status.trim() || "Unknown";
}

export function formatDonorName(donor: PublicDonor | null | undefined): string {
  const first = donor?.firstName?.trim() || "";
  const last = donor?.lastName?.trim() || "";
  const full = `${first} ${last}`.trim();
  return full || donor?.donorNumber || "Donor";
}

export function formatBloodGroup(
  donor: PublicDonor | null | undefined,
): string {
  const fromNested = donor?.bloodGroup?.code?.trim();
  if (fromNested) {
    return fromNested;
  }
  const match = BLOOD_GROUP_OPTIONS.find(
    (group) => group.id === donor?.bloodGroupId,
  );
  return match?.code || "—";
}

export function formatActiveState(active: boolean = false): string {
  return active ? "Active" : "Inactive";
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

export function parseOptionalBoolean(
  value: string | null | undefined,
): boolean | "" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  return "";
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

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
