import { apiFetch } from "~/lib/api";
import { normalizeDonation, type PublicDonation } from "~/lib/donations";
import { normalizeDonor, type PublicDonor } from "~/lib/donors";

export type UpdateOwnDonorInput = {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  bloodGroupId?: number;
};

export type OwnDonorDonationsResult = {
  donor: PublicDonor;
  donations: PublicDonation[];
  total: number;
};

export async function getOwnDonor(): Promise<PublicDonor> {
  const data = await apiFetch<{ donor?: unknown }>("/me/donor", {
    method: "GET",
  });
  const donor = normalizeDonor(data?.donor);
  if (!donor) {
    throw new Error("Invalid donor payload from API");
  }
  return donor;
}

export async function updateOwnDonor(
  input: UpdateOwnDonorInput,
): Promise<PublicDonor> {
  const body: Record<string, unknown> = {};
  if (input.firstName !== undefined) body.firstName = input.firstName.trim();
  if (input.lastName !== undefined) body.lastName = input.lastName.trim();
  if (input.phone !== undefined) body.phone = input.phone?.trim() || null;
  if (input.bloodGroupId !== undefined) body.bloodGroupId = input.bloodGroupId;

  const data = await apiFetch<{ donor?: unknown }>("/me/donor", {
    method: "PATCH",
    json: body,
  });
  const donor = normalizeDonor(data?.donor);
  if (!donor) {
    throw new Error("Invalid donor payload from API");
  }
  return donor;
}

export async function listOwnDonorDonations(): Promise<OwnDonorDonationsResult> {
  const data = await apiFetch<{
    donor?: unknown;
    donations?: unknown;
    total?: unknown;
  }>("/me/donor/donations", { method: "GET" });
  const donor = normalizeDonor(data?.donor);
  if (!donor) {
    throw new Error("Invalid donor payload from API");
  }
  const raw = Array.isArray(data?.donations) ? data.donations : [];
  const donations = raw
    .map(normalizeDonation)
    .filter((item): item is PublicDonation => item !== null);
  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : donations.length;
  return { donor, donations, total };
}
