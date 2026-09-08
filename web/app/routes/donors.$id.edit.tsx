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

import { DonorFormFields } from "~/components/donors/DonorFormFields";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { ApiRequestError } from "~/lib/api";
import {
  fetchAuthSession,
  hasUiPermission,
  UI_PERMISSIONS,
  type AuthSession,
} from "~/lib/auth";
import {
  emptyToNull,
  formatApiErrorMessage,
  formatDonorName,
  getDonor,
  isForbiddenApiError,
  parsePositiveInt,
  updateDonor,
  type DonorEligibilityStatus,
  type PublicDonor,
} from "~/lib/donors";

export const meta: MetaFunction = () => [
  { title: "Edit donor · NBTS Blood AI" },
];

type DonorEditLoaderData =
  | { status: "ok"; session: AuthSession; donor: PublicDonor }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      donorId: string;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      donorId: string;
    }
  | {
      status: "not_found";
      session: AuthSession;
      message: string;
      donorId: string;
    };

type DonorEditActionData = {
  error?: string;
};

function parseEligibility(
  value: FormDataEntryValue | null,
): DonorEligibilityStatus {
  const raw = String(value ?? "").trim();
  if (
    raw === "POTENTIALLY_ELIGIBLE" ||
    raw === "TEMPORARILY_INELIGIBLE" ||
    raw === "INELIGIBLE" ||
    raw === "UNKNOWN"
  ) {
    return raw;
  }
  return "UNKNOWN";
}

export async function clientLoader({
  request,
  params,
}: ClientLoaderFunctionArgs): Promise<DonorEditLoaderData> {
  const donorIdParam = params?.id || "";
  const donorId = parsePositiveInt(donorIdParam);

  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // Need update to edit; also need read to load the record.
  if (!hasUiPermission(session, UI_PERMISSIONS.donorsUpdate)) {
    return {
      status: "forbidden",
      session,
      donorId: donorIdParam,
      message:
        "Your session does not include donors:update. The API remains the access authority.",
    };
  }

  if (!Number.isFinite(donorId)) {
    return {
      status: "not_found",
      session,
      donorId: donorIdParam,
      message: "Invalid donor id.",
    };
  }

  try {
    const donor = await getDonor(donorId);
    return { status: "ok", session, donor };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        donorId: donorIdParam,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to edit this donor.",
        ),
      };
    }
    const message = formatApiErrorMessage(error, "Unable to load donor.");
    if (error instanceof ApiRequestError && error.status === 404) {
      return {
        status: "not_found",
        session,
        donorId: donorIdParam,
        message,
      };
    }

    return {
      status: "error",
      session,
      donorId: donorIdParam,
      message,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading donor form…" />;
}

export async function clientAction({
  request,
  params,
}: ClientActionFunctionArgs) {
  const donorId = parsePositiveInt(params?.id);
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect(`/login?next=/donors/${params?.id || ""}/edit`);
  }
  if (!hasUiPermission(session, UI_PERMISSIONS.donorsUpdate)) {
    return {
      error: "You do not have permission to update donors (donors:update).",
    } satisfies DonorEditActionData;
  }
  if (!Number.isFinite(donorId)) {
    return { error: "Invalid donor id." } satisfies DonorEditActionData;
  }

  const formData = await request.formData();
  const donorNumber = String(formData.get("donorNumber") || "").trim();
  const firstName = String(formData.get("firstName") || "").trim();
  const lastName = String(formData.get("lastName") || "").trim();
  const phone = emptyToNull(String(formData.get("phone") || ""));
  const email = emptyToNull(String(formData.get("email") || ""));
  const bloodGroupId = parsePositiveInt(
    String(formData.get("bloodGroupId") || ""),
  );
  const eligibilityStatus = parseEligibility(
    formData.get("eligibilityStatus"),
  );
  const active = formData.get("active") === "true";

  if (!donorNumber || !firstName || !lastName || !Number.isFinite(bloodGroupId)) {
    return {
      error: "Donor number, names, and blood group are required.",
    } satisfies DonorEditActionData;
  }

  try {
    await updateDonor(donorId, {
      donorNumber,
      firstName,
      lastName,
      phone,
      email,
      bloodGroupId,
      eligibilityStatus,
      active,
    });
    throw redirect(`/donors/${donorId}`);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    if (isForbiddenApiError(error)) {
      return {
        error: formatApiErrorMessage(
          error,
          "You do not have permission to update donors.",
        ),
      } satisfies DonorEditActionData;
    }
    return {
      error: formatApiErrorMessage(error, "Unable to update donor."),
    } satisfies DonorEditActionData;
  }
}

export default function DonorEditPage() {
  const data = useLoaderData<DonorEditLoaderData>();
  const actionData = useActionData<DonorEditActionData>();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" || navigation.state === "loading";

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Edit donor" />
        <ForbiddenState
          title="Update access restricted"
          message={
            data.message ||
            "You do not have permission to edit donors (donors:update)."
          }
          detail="UI gate only — the API enforces authorization."
          action={
            <Link
              to={data.donorId ? `/donors/${data.donorId}` : "/donors"}
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back
            </Link>
          }
        />
      </div>
    );
  }

  if (data?.status === "not_found") {
    return (
      <div>
        <PageHeader title="Edit donor" />
        <EmptyState
          title="Donor not found"
          description={data.message || "No donor matched this id."}
          action={
            <Link
              to="/donors"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to donors
            </Link>
          }
        />
      </div>
    );
  }

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader title="Edit donor" />
        <ErrorState
          title="Could not load donor"
          message={data.message || "Unable to load donor from the API."}
        />
      </div>
    );
  }

  if (data?.status !== "ok" || !data.donor) {
    return <LoadingState label="Loading donor form…" />;
  }

  const donor = data.donor;

  return (
    <div>
      <PageHeader
        title={`Edit ${formatDonorName(donor)}`}
        description="Mutations post to the donors API. No client-side eligibility decisions."
        actions={
          <Link
            to={`/donors/${donor.id}`}
            className="inline-flex rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Cancel
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState title="Could not save donor" message={actionData.error} />
        </div>
      ) : null}

      <Form
        method="post"
        className="max-w-2xl rounded-lg border border-nbts-border bg-nbts-panel p-5"
      >
        <DonorFormFields
          idPrefix="edit-donor"
          defaults={donor}
          showActive
        />
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-nbts-blood px-4 py-2.5 text-sm font-semibold text-white hover:bg-nbts-blood-dark disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          <Link
            to={`/donors/${donor.id}`}
            className="rounded border border-nbts-border px-4 py-2.5 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  );
}
