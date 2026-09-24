import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useState } from "react";

import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import { listFacilities, type PublicFacility } from "~/lib/blood-requests";
import {
  BLOOD_GROUP_OPTIONS,
  emptyToNull,
  formatDonorName,
  listDonors,
  type PublicDonor,
} from "~/lib/donors";
import {
  createDonation,
  formatApiErrorMessage,
  formatDonationCentreLabel,
  isForbiddenApiError,
  isValidDateOnly,
  listDonationCentres,
  parsePositiveInt,
  todayDateOnly,
  type PublicDonationCentre,
} from "~/lib/donations";

export const meta: MetaFunction = () => [
  { title: "Record donation · Blood Donation Management System" },
];

type DonationNewLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      donors: PublicDonor[];
      centres: PublicDonationCentre[];
      facilities: PublicFacility[];
      defaultDate: string;
      prefills: {
        donorId: string;
        bloodGroupId: string;
      };
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
    };

type DonationNewActionData = {
  error?: string;
};

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<DonationNewLoaderData> {
  const url = new URL(request.url);
  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.donationsCreate)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include donations:create. The server remains the access authority.",
    };
  }

  const donorPrefill = parsePositiveInt(url.searchParams.get("donorId"));
  const bloodGroupPrefill = parsePositiveInt(
    url.searchParams.get("bloodGroupId"),
  );

  try {
    const canListDonors = hasUiPermission(session, UI_PERMISSIONS.donorsRead);
    const [donorsResult, centres, facilities] = await Promise.all([
      canListDonors
        ? listDonors({ active: true, limit: 100, offset: 0 })
        : Promise.resolve({ donors: [] as PublicDonor[] }),
      listDonationCentres({ active: true }),
      listFacilities({ active: true }).catch(() => [] as PublicFacility[]),
    ]);

    return {
      status: "ok",
      session,
      donors:
        donorsResult.donors?.length || !Number.isFinite(donorPrefill)
          ? (donorsResult.donors ?? [])
          : [
              {
                id: donorPrefill,
                userId: null,
                donorNumber: "",
                firstName: "Selected",
                lastName: "donor",
                phone: null,
                email: null,
                dateOfBirth: null,
                sex: null,
                address: null,
                weightKg: null,
                smsConsent: false,
                emailConsent: false,
                bloodGroupId: Number.isFinite(bloodGroupPrefill)
                  ? bloodGroupPrefill
                  : 0,
                bloodGroup: null,
                eligibilityStatus: "UNKNOWN",
                active: true,
                donationCount: 0,
                lastDonationDate: null,
                preliminaryEligibility: { status: "PROFILE_INCOMPLETE", reasons: [], profileComplete: false, age: null, nextEligibleDate: null, daysUntilEligible: null },
              } satisfies PublicDonor,
            ],
      centres: centres ?? [],
      facilities: facilities ?? [],
      defaultDate: todayDateOnly(),
      prefills: {
        donorId: Number.isFinite(donorPrefill) ? String(donorPrefill) : "",
        bloodGroupId: Number.isFinite(bloodGroupPrefill)
          ? String(bloodGroupPrefill)
          : "",
      },
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to record donations.",
        ),
      };
    }
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(
        error,
        "Unable to load donation form options.",
      ),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading donation form…" />;
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect("/login?next=/donations/new");
  }
  if (!hasUiPermission(session, UI_PERMISSIONS.donationsCreate)) {
    return {
      error:
        "You do not have permission to record donations (donations:create).",
    } satisfies DonationNewActionData;
  }

  const formData = await request.formData();
  const donorMode = String(formData.get("donorMode") || "existing");
  const donorId = parsePositiveInt(String(formData.get("donorId") || ""));
  const donationCentreId = parsePositiveInt(
    String(formData.get("donationCentreId") || ""),
  );
  const bloodGroupId = parsePositiveInt(
    String(formData.get("bloodGroupId") || ""),
  );
  const donationDate = String(formData.get("donationDate") || "").trim();
  const category = String(formData.get("category") || "VOLUNTARY");
  const weightKgAtDonation = Number(formData.get("weightKgAtDonation"));
  const unitsRaw = Number.parseInt(
    String(formData.get("units") || "1").trim(),
    10,
  );
  const units =
    Number.isFinite(unitsRaw) && unitsRaw > 0 ? Math.min(unitsRaw, 50) : 1;
  const notes = emptyToNull(String(formData.get("notes") || ""));
  const facilityRaw = String(formData.get("facilityId") || "").trim();
  const facilityId =
    facilityRaw === ""
      ? null
      : parsePositiveInt(facilityRaw);

  if (
    (donorMode === "existing" && !Number.isFinite(donorId)) ||
    !Number.isFinite(donationCentreId) ||
    !Number.isFinite(bloodGroupId) ||
    !isValidDateOnly(donationDate) ||
    !Number.isFinite(weightKgAtDonation) || weightKgAtDonation <= 0 ||
    (category !== "VOLUNTARY" && category !== "FAMILY_REPLACEMENT")
  ) {
    return {
      error:
        "Donor, donation centre, blood group, category, weight, and a valid donation date are required.",
    } satisfies DonationNewActionData;
  }

  if (facilityRaw !== "" && !Number.isFinite(facilityId)) {
    return {
      error: "Facility id is invalid.",
    } satisfies DonationNewActionData;
  }

  try {
    let newDonor;
    if (donorMode === "new") {
      const sex = String(formData.get("newSex") || "");
      const newWeightKg = Number(formData.get("newWeightKg"));
      newDonor = {
        firstName: String(formData.get("newFirstName") || "").trim(),
        lastName: String(formData.get("newLastName") || "").trim(),
        phone: String(formData.get("newPhone") || "").trim(),
        email: String(formData.get("newEmail") || "").trim(),
        dateOfBirth: String(formData.get("newDateOfBirth") || "").trim(),
        sex: sex as "MALE" | "FEMALE",
        address: String(formData.get("newAddress") || "").trim(),
        weightKg: newWeightKg,
        smsConsent: formData.get("newSmsConsent") === "true",
        emailConsent: formData.get("newEmailConsent") === "true",
        bloodGroupId,
      };
      if (!newDonor.firstName || !newDonor.lastName || !newDonor.phone || !newDonor.email || !newDonor.dateOfBirth || !newDonor.address || !Number.isFinite(newWeightKg) || (sex !== "MALE" && sex !== "FEMALE")) {
        return { error: "Complete every required field for the new donor." } satisfies DonationNewActionData;
      }
    }
    const donation = await createDonation({
      donorId: donorMode === "existing" ? donorId : undefined,
      newDonor,
      donationCentreId,
      bloodGroupId,
      donationDate,
      category: category as "VOLUNTARY" | "FAMILY_REPLACEMENT",
      weightKgAtDonation,
      units,
      notes,
      facilityId: Number.isFinite(facilityId) ? facilityId : null,
    });
    throw redirect(`/donations/${donation.id}`);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    if (isForbiddenApiError(error)) {
      return {
        error: formatApiErrorMessage(
          error,
          "You do not have permission to record donations.",
        ),
      } satisfies DonationNewActionData;
    }
    return {
      error: formatApiErrorMessage(error, "Unable to record donation."),
    } satisfies DonationNewActionData;
  }
}

const fieldClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

export default function DonationNewPage() {
  const data = useLoaderData<DonationNewLoaderData>();
  const actionData = useActionData<DonationNewActionData>();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" || navigation.state === "loading";
  const [donorMode, setDonorMode] = useState<"existing" | "new">("existing");

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Record donation"
          description="Create a donation record. Linked inventory units are created by the server."
        />
        <ForbiddenState
          title="Create access restricted"
          message={
            data.message ||
            "You do not have permission to record donations (donations:create)."
          }
          detail="UI gate only — the server enforces authorization."
          action={
            <Link
              to="/donations"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to donations
            </Link>
          }
        />
      </div>
    );
  }

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader
          title="Record donation"
          description="Create a donation record. Linked inventory units are created by the server."
        />
        <ErrorState
          title="Could not load form"
          message={data.message || "Unable to load donation form options."}
        />
        <div className="mt-4">
          <Link
            to="/donations"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to donations
          </Link>
        </div>
      </div>
    );
  }

  const donors = data?.donors ?? [];
  const centres = data?.centres ?? [];
  const facilities = data?.facilities ?? [];
  const defaultDonorId = data?.prefills?.donorId || "";
  const defaultBloodGroupId = data?.prefills?.bloodGroupId || "";

  return (
    <div>
      <PageHeader
        title="Record donation"
        description="Select an existing donor or register a new donor as part of the donation. Eligibility is checked before the record is saved."
        actions={
          <Link
            to="/donations"
            className="inline-flex rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Cancel
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState
            title="Could not record donation"
            message={actionData.error}
          />
        </div>
      ) : null}

      {(donors.length === 0 || centres.length === 0) && (
        <div className="mb-4">
          <ErrorState
            title="Missing prerequisites"
            message={
              donors.length === 0 && centres.length === 0
                ? "No active donors or donation centres were returned. Register those first."
                : donors.length === 0
                  ? "No active donors were returned. Register a donor before recording a donation."
                  : "No active donation centres were returned. Centres are required to record a donation."
            }
          />
        </div>
      )}

      <Form
        method="post"
        className="max-w-2xl rounded-lg border border-nbts-border bg-nbts-panel p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="flex gap-4 sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-nbts-ink">Donor source</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="donorMode" value="existing" checked={donorMode === "existing"} onChange={() => setDonorMode("existing")} /> Existing donor</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="donorMode" value="new" checked={donorMode === "new"} onChange={() => setDonorMode("new")} /> New donor</label>
          </fieldset>
          {donorMode === "existing" ? (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-nbts-ink">Donor</span>
            <select
              name="donorId"
              required
              defaultValue={defaultDonorId}
              className={fieldClass}
              disabled={donors.length === 0}
            >
              <option value="">Select donor</option>
              {donors.map((donor) => (
                <option key={donor.id} value={donor.id}>
                  {formatDonorName(donor)}
                  {donor.donorNumber ? ` · ${donor.donorNumber}` : ""}
                  {donor.bloodGroup?.code
                    ? ` · ${donor.bloodGroup.code}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          ) : (
            <fieldset className="grid gap-4 rounded border border-nbts-border p-4 sm:col-span-2 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold">New donor details</legend>
              <input name="newFirstName" required className={fieldClass} placeholder="First name" />
              <input name="newLastName" required className={fieldClass} placeholder="Last name" />
              <input name="newPhone" required className={fieldClass} placeholder="Phone, e.g. 0712345678" />
              <input name="newEmail" required type="email" className={fieldClass} placeholder="Email" />
              <input name="newDateOfBirth" required type="date" className={fieldClass} aria-label="Date of birth" />
              <select name="newSex" required className={fieldClass} defaultValue=""><option value="" disabled>Sex</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select>
              <input name="newWeightKg" required type="number" min={1} max={300} step="0.1" className={fieldClass} placeholder="Current weight (kg)" />
              <input name="newAddress" required className={fieldClass} placeholder="Address" />
              <label className="flex items-center gap-2 text-sm"><input name="newSmsConsent" type="checkbox" value="true" /> SMS reminders</label>
              <label className="flex items-center gap-2 text-sm"><input name="newEmailConsent" type="checkbox" value="true" /> Email reminders</label>
            </fieldset>
          )}

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-nbts-ink">Donation centre</span>
            <select
              name="donationCentreId"
              required
              defaultValue=""
              className={fieldClass}
              disabled={centres.length === 0}
            >
              <option value="">Select centre</option>
              {centres.map((centre) => (
                <option key={centre.id} value={centre.id}>
                  {formatDonationCentreLabel(centre)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Blood group</span>
            <select
              name="bloodGroupId"
              required
              defaultValue={defaultBloodGroupId}
              className={fieldClass}
            >
              <option value="">Select group</option>
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.code}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Donation category</span>
            <select name="category" required defaultValue="VOLUNTARY" className={fieldClass}>
              <option value="VOLUNTARY">Voluntary</option>
              <option value="FAMILY_REPLACEMENT">Family replacement</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Weight at donation (kg)</span>
            <input name="weightKgAtDonation" type="number" min={1} max={300} step="0.1" required className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Donation date</span>
            <input
              name="donationDate"
              type="date"
              required
              defaultValue={data?.defaultDate || todayDateOnly()}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Units</span>
            <input
              name="units"
              type="number"
              min={1}
              max={50}
              defaultValue={1}
              required
              className={fieldClass}
            />
            <span className="text-xs text-nbts-muted">
              Each unit creates a linked inventory row (server).
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">
              Facility assignment (optional)
            </span>
            <select name="facilityId" defaultValue="" className={fieldClass}>
              <option value="">Unassigned stock</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                  {facility.region ? ` · ${facility.region}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-nbts-ink">Notes</span>
            <textarea
              name="notes"
              rows={3}
              maxLength={5000}
              className={fieldClass}
              placeholder="Optional operational notes"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || (donorMode === "existing" && donors.length === 0) || centres.length === 0}
            className="rounded bg-nbts-blood px-4 py-2.5 text-sm font-semibold text-white hover:bg-nbts-blood-dark disabled:opacity-60"
          >
            {busy ? "Saving…" : "Record donation"}
          </button>
          <Link
            to="/donations"
            className="rounded border border-nbts-border px-4 py-2.5 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  );
}
