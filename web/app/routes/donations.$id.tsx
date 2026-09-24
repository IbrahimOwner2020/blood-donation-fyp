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

import { ProtectedUi } from "~/components/auth/ProtectedUi";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import { emptyToNull } from "~/lib/donors";
import {
  formatApiErrorMessage,
  formatDateOnly,
  formatDonationBloodGroup,
  formatDonationCentreLabel,
  formatDonationDonorName,
  getDonation,
  isForbiddenApiError,
  isNotFoundApiError,
  listDonationCentres,
  parsePositiveInt,
  updateDonation,
  type PublicDonation,
  type PublicDonationCentre,
} from "~/lib/donations";

export const meta: MetaFunction = () => [
  { title: "Donation detail · Blood Donation Management System" },
];

type DonationDetailLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      donation: PublicDonation;
      centres: PublicDonationCentre[];
      canUpdate: boolean;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      donationId: string;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      donationId: string;
    }
  | {
      status: "not_found";
      session: AuthSession;
      message: string;
      donationId: string;
    };

type DonationDetailActionData = {
  error?: string;
};

export async function clientLoader({
  request,
  params,
}: ClientLoaderFunctionArgs): Promise<DonationDetailLoaderData> {
  const donationIdParam = params?.id || "";
  const donationId = parsePositiveInt(donationIdParam);

  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.donationsRead)) {
    return {
      status: "forbidden",
      session,
      donationId: donationIdParam,
      message:
        "Your session does not include donations:read. The server remains the access authority.",
    };
  }

  if (!Number.isFinite(donationId)) {
    return {
      status: "not_found",
      session,
      donationId: donationIdParam,
      message: "Invalid donation id.",
    };
  }

  try {
    const [donation, centres] = await Promise.all([
      getDonation(donationId),
      listDonationCentres({ active: true }).catch(
        () => [] as PublicDonationCentre[],
      ),
    ]);

    return {
      status: "ok",
      session,
      donation,
      centres: centres ?? [],
      canUpdate: hasUiPermission(session, UI_PERMISSIONS.donationsCreate),
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        donationId: donationIdParam,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view this donation.",
        ),
      };
    }
    if (isNotFoundApiError(error)) {
      return {
        status: "not_found",
        session,
        donationId: donationIdParam,
        message: formatApiErrorMessage(error, "Donation not found."),
      };
    }
    return {
      status: "error",
      session,
      donationId: donationIdParam,
      message: formatApiErrorMessage(error, "Unable to load donation."),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading donation…" />;
}

export async function clientAction({
  request,
  params,
}: ClientActionFunctionArgs) {
  const donationId = parsePositiveInt(params?.id || "");
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect(
      `/login?next=${encodeURIComponent(`/donations/${params?.id || ""}`)}`,
    );
  }
  if (!hasUiPermission(session, UI_PERMISSIONS.donationsCreate)) {
    return {
      error:
        "You do not have permission to update donations (donations:create).",
    } satisfies DonationDetailActionData;
  }
  if (!Number.isFinite(donationId)) {
    return { error: "Invalid donation id." } satisfies DonationDetailActionData;
  }

  const formData = await request.formData();
  const notes = emptyToNull(String(formData.get("notes") || ""));
  const centreRaw = String(formData.get("donationCentreId") || "").trim();
  const donationCentreId =
    centreRaw === "" ? undefined : parsePositiveInt(centreRaw);

  if (centreRaw !== "" && !Number.isFinite(donationCentreId)) {
    return {
      error: "Donation centre is invalid.",
    } satisfies DonationDetailActionData;
  }

  try {
    await updateDonation(donationId, {
      notes,
      ...(typeof donationCentreId === "number"
        ? { donationCentreId }
        : {}),
    });
    throw redirect(`/donations/${donationId}`);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    if (isForbiddenApiError(error)) {
      return {
        error: formatApiErrorMessage(
          error,
          "You do not have permission to update this donation.",
        ),
      } satisfies DonationDetailActionData;
    }
    if (error instanceof ApiRequestError) {
      return {
        error: formatApiErrorMessage(error, "Unable to update donation."),
      } satisfies DonationDetailActionData;
    }
    return {
      error: formatApiErrorMessage(error, "Unable to update donation."),
    } satisfies DonationDetailActionData;
  }
}

const fieldClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

export default function DonationDetailPage() {
  const data = useLoaderData<DonationDetailLoaderData>();
  const actionData = useActionData<DonationDetailActionData>();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" || navigation.state === "loading";

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Donation" description="Donation detail." />
        <ForbiddenState
          title="Donation access restricted"
          message={
            data.message ||
            "You do not have permission to view this donation (donations:read)."
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

  if (data?.status === "not_found") {
    return (
      <div>
        <PageHeader title="Donation" description="Donation detail." />
        <ErrorState
          title="Donation not found"
          message={data.message || `No donation matches id ${data.donationId}.`}
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

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader title="Donation" description="Donation detail." />
        <ErrorState
          title="Could not load donation"
          message={data.message || "Unable to load donation from the server."}
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

  const donation = data.donation;
  const centres = data.centres ?? [];
  const session = data.session;
  const inventoryIds = donation.inventoryUnitIds ?? [];
  const inventoryCount =
    donation.inventoryUnitCount ?? inventoryIds.length ?? donation.units;

  return (
    <div>
      <PageHeader
        title={`Donation #${donation.id}`}
        description="Detail from GET /donations/:id. Corrections for notes/centre use donations:create."
        actions={
          <Link
            to="/donations"
            className="inline-flex rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to list
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState title="Update failed" message={actionData.error} />
        </div>
      ) : null}

      <dl className="mb-6 grid gap-4 rounded-lg border border-nbts-border bg-nbts-panel p-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Donation date
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDateOnly(donation.donationDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Blood group
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDonationBloodGroup(donation)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Donor
          </dt>
          <dd className="mt-1 text-sm">
            <Link
              to={`/donors/${donation.donorId}`}
              className="text-nbts-teal underline-offset-2 hover:underline"
            >
              {formatDonationDonorName(donation.donor)}
              {donation.donor?.donorNumber
                ? ` (${donation.donor.donorNumber})`
                : ""}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Centre
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDonationCentreLabel(donation.donationCentre)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Units
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">{donation.units}</dd>
        </div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">Category</dt><dd className="mt-1 text-sm text-nbts-ink">{donation.category === "FAMILY_REPLACEMENT" ? "Family replacement" : "Voluntary"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">Weight at donation</dt><dd className="mt-1 text-sm text-nbts-ink">{donation.weightKgAtDonation === null ? "—" : `${donation.weightKgAtDonation} kg`}</dd></div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Inventory units
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {inventoryCount > 0 ? (
              inventoryIds.length > 0 ? (
                <span className="flex flex-wrap gap-2">
                  {inventoryIds.map((unitId) => (
                    <Link
                      key={unitId}
                      to={`/inventory/${unitId}`}
                      className="text-nbts-teal underline-offset-2 hover:underline"
                    >
                      Unit #{unitId}
                    </Link>
                  ))}
                </span>
              ) : (
                `${inventoryCount} linked unit(s)`
              )
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Notes
          </dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm text-nbts-ink">
            {donation.notes || "—"}
          </dd>
        </div>
      </dl>

      <ProtectedUi session={session} gate={UI_PERMISSIONS.donationsCreate}>
        <section className="max-w-2xl rounded-lg border border-nbts-border bg-nbts-panel p-5">
          <h2 className="text-base font-semibold text-nbts-ink">
            Correct notes / centre
          </h2>
          <p className="mt-1 text-sm text-nbts-muted">
            Donor, blood group, date, and units are immutable after inventory is
            linked. server enforces this.
          </p>
          <Form method="post" className="mt-4 grid gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-nbts-ink">Donation centre</span>
              <select
                name="donationCentreId"
                defaultValue={String(donation.donationCentreId)}
                className={fieldClass}
              >
                {centres.map((centre) => (
                  <option key={centre.id} value={centre.id}>
                    {formatDonationCentreLabel(centre)}
                  </option>
                ))}
                {!centres.some((c) => c.id === donation.donationCentreId) ? (
                  <option value={donation.donationCentreId}>
                    {formatDonationCentreLabel(donation.donationCentre)}
                  </option>
                ) : null}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-nbts-ink">Notes</span>
              <textarea
                name="notes"
                rows={3}
                maxLength={5000}
                defaultValue={donation.notes || ""}
                className={fieldClass}
              />
            </label>
            <button
              type="submit"
              disabled={busy || !data.canUpdate}
              className="w-fit rounded bg-nbts-teal px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save corrections"}
            </button>
          </Form>
        </section>
      </ProtectedUi>
    </div>
  );
}
