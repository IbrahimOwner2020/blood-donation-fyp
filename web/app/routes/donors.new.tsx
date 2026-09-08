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
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import {
  fetchAuthSession,
  hasUiPermission,
  UI_PERMISSIONS,
  type AuthSession,
} from "~/lib/auth";
import {
  createDonor,
  emptyToNull,
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
  type DonorEligibilityStatus,
} from "~/lib/donors";

export const meta: MetaFunction = () => [
  { title: "New donor · NBTS Blood AI" },
];

type DonorNewLoaderData =
  | { status: "ok"; session: AuthSession }
  | { status: "forbidden"; session: AuthSession; message?: string };

type DonorNewActionData = {
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
}: ClientLoaderFunctionArgs): Promise<DonorNewLoaderData> {
  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.donorsCreate)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include donors:create. The API remains the access authority.",
    };
  }

  return { status: "ok", session };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading register form…" />;
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect("/login?next=/donors/new");
  }
  if (!hasUiPermission(session, UI_PERMISSIONS.donorsCreate)) {
    return {
      error: "You do not have permission to register donors (donors:create).",
    } satisfies DonorNewActionData;
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

  if (!donorNumber || !firstName || !lastName || !Number.isFinite(bloodGroupId)) {
    return {
      error: "Donor number, names, and blood group are required.",
    } satisfies DonorNewActionData;
  }

  try {
    const donor = await createDonor({
      donorNumber,
      firstName,
      lastName,
      phone,
      email,
      bloodGroupId,
      eligibilityStatus,
      active: true,
    });
    throw redirect(`/donors/${donor.id}`);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    if (isForbiddenApiError(error)) {
      return {
        error: formatApiErrorMessage(
          error,
          "You do not have permission to register donors.",
        ),
      } satisfies DonorNewActionData;
    }
    return {
      error: formatApiErrorMessage(error, "Unable to register donor."),
    } satisfies DonorNewActionData;
  }
}

export default function DonorNewPage() {
  const data = useLoaderData<DonorNewLoaderData>();
  const actionData = useActionData<DonorNewActionData>();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" || navigation.state === "loading";

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Register donor"
          description="Create a donor record. Eligibility is operational only."
        />
        <ForbiddenState
          title="Create access restricted"
          message={
            data.message ||
            "You do not have permission to register donors (donors:create)."
          }
          detail="UI gate only — the API enforces authorization."
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

  return (
    <div>
      <PageHeader
        title="Register donor"
        description="Fields bind to the donors API. “Potentially eligible” means outreach-ready — not medical clearance."
        actions={
          <Link
            to="/donors"
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
        <DonorFormFields idPrefix="new-donor" />
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-nbts-blood px-4 py-2.5 text-sm font-semibold text-white hover:bg-nbts-blood-dark disabled:opacity-60"
          >
            {busy ? "Saving…" : "Register donor"}
          </button>
          <Link
            to="/donors"
            className="rounded border border-nbts-border px-4 py-2.5 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  );
}
