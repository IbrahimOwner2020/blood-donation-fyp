import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useParams,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useRef, useState, type ReactNode } from "react";

import { ProtectedUi } from "~/components/auth/ProtectedUi";
import { Button } from "~/components/ui/Button";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
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
  formatDonationBloodGroup,
  formatDonationCentreLabel,
  formatDateOnly,
  listDonations,
  type PublicDonation,
} from "~/lib/donations";
import {
  deactivateDonor,
  formatActiveState,
  formatApiErrorMessage,
  formatBloodGroup,
  formatDonorName,
  formatEligibilityStatus,
  getDonor,
  isForbiddenApiError,
  parsePositiveInt,
  type PublicDonor,
} from "~/lib/donors";
import {
  listNotifications,
  type PublicNotification,
} from "~/lib/notifications";

export const meta: MetaFunction = () => [
  { title: "Donor detail · NBTS Blood AI" },
];

type HistoryLoadState<T> =
  | { status: "ok"; items: T[]; total: number }
  | { status: "forbidden"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "skipped"; message: string };

type DonorDetailLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      donor: PublicDonor;
      donations: HistoryLoadState<PublicDonation>;
      notifications: HistoryLoadState<PublicNotification>;
    }
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

type DonorDetailActionData = {
  error?: string;
};

async function loadDonationHistory(
  session: AuthSession,
  donorId: number,
): Promise<HistoryLoadState<PublicDonation>> {
  if (!hasUiPermission(session, UI_PERMISSIONS.donationsRead)) {
    return {
      status: "skipped",
      message:
        "Donation history requires donations:read. Contact an administrator if you need access.",
    };
  }

  try {
    const result = await listDonations({ donorId, limit: 20, offset: 0 });
    return {
      status: "ok",
      items: result.donations ?? [],
      total: result.total ?? 0,
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view donation history.",
        ),
      };
    }
    return {
      status: "unavailable",
      message: formatApiErrorMessage(
        error,
        "Donation history could not be loaded from the API.",
      ),
    };
  }
}

async function loadNotificationHistory(
  session: AuthSession,
  donorId: number,
): Promise<HistoryLoadState<PublicNotification>> {
  if (!hasUiPermission(session, UI_PERMISSIONS.notificationsRead)) {
    return {
      status: "skipped",
      message:
        "Notification history requires notifications:read. Contact an administrator if you need access.",
    };
  }

  try {
    const result = await listNotifications({ donorId, limit: 20, offset: 0 });
    return {
      status: "ok",
      items: result.notifications ?? [],
      total: result.total ?? 0,
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view notification history.",
        ),
      };
    }
    return {
      status: "unavailable",
      message: formatApiErrorMessage(
        error,
        "Notification history could not be loaded from the API.",
      ),
    };
  }
}

export async function clientLoader({
  request,
  params,
}: ClientLoaderFunctionArgs): Promise<DonorDetailLoaderData> {
  const donorIdParam = params?.id || "";
  const donorId = parsePositiveInt(donorIdParam);

  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.donorsRead)) {
    return {
      status: "forbidden",
      session,
      donorId: donorIdParam,
      message:
        "Your session does not include donors:read. The API remains the access authority.",
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
    const [donations, notifications] = await Promise.all([
      loadDonationHistory(session, donorId),
      loadNotificationHistory(session, donorId),
    ]);
    return { status: "ok", session, donor, donations, notifications };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        donorId: donorIdParam,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view this donor.",
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
  return <LoadingState label="Loading donor…" />;
}

export async function clientAction({
  request,
  params,
}: ClientActionFunctionArgs) {
  const donorId = parsePositiveInt(params?.id);
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect(`/login?next=/donors/${params?.id || ""}`);
  }
  if (!hasUiPermission(session, UI_PERMISSIONS.donorsUpdate)) {
    return {
      error: "You do not have permission to update donors (donors:update).",
    } satisfies DonorDetailActionData;
  }
  if (!Number.isFinite(donorId)) {
    return { error: "Invalid donor id." } satisfies DonorDetailActionData;
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();

  if (intent !== "deactivate") {
    return { error: "Unknown action." } satisfies DonorDetailActionData;
  }

  try {
    await deactivateDonor(donorId);
    throw redirect(`/donors/${donorId}`);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    if (isForbiddenApiError(error)) {
      return {
        error: formatApiErrorMessage(
          error,
          "You do not have permission to deactivate donors.",
        ),
      } satisfies DonorDetailActionData;
    }
    return {
      error: formatApiErrorMessage(error, "Unable to deactivate donor."),
    } satisfies DonorDetailActionData;
  }
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="border-b border-nbts-border py-3 last:border-0 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-nbts-muted">{label}</dt>
      <dd className="mt-1 text-sm text-nbts-ink sm:col-span-2 sm:mt-0">
        {value?.trim() || "—"}
      </dd>
    </div>
  );
}

function HistoryPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-nbts-border bg-nbts-panel">
      <div className="border-b border-nbts-border px-4 py-3">
        <h2 className="text-sm font-semibold text-nbts-ink">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function formatNotificationWhen(
  notification: PublicNotification | null | undefined,
): string {
  const sent = notification?.sentAt?.trim();
  if (sent) {
    const parsed = new Date(sent);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }
  const created = notification?.createdAt?.trim();
  if (created) {
    const parsed = new Date(created);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }
  return "—";
}

export default function DonorDetailPage() {
  const data = useLoaderData<DonorDetailLoaderData>();
  const actionData = useActionData<DonorDetailActionData>();
  const navigation = useNavigation();
  const params = useParams();
  const donorId = params?.id || "unknown";
  const busy = navigation.state === "submitting";
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const deactivateFormRef = useRef<HTMLFormElement>(null);

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Donor detail" />
        <ForbiddenState
          title="Donor access restricted"
          message={
            data.message ||
            "You do not have permission to view this donor (donors:read)."
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

  if (data?.status === "not_found") {
    return (
      <div>
        <PageHeader title="Donor detail" />
        <EmptyState
          title="Donor not found"
          description={data.message || `No donor matched id ${donorId}.`}
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
        <PageHeader title="Donor detail" />
        <ErrorState
          title="Could not load donor"
          message={data.message || "Unable to load donor from the API."}
        />
        <p className="mt-4">
          <Link
            to="/donors"
            className="text-sm font-medium text-nbts-teal underline"
          >
            Back to donors
          </Link>
        </p>
      </div>
    );
  }

  if (data?.status !== "ok" || !data.donor) {
    return <LoadingState label="Loading donor…" />;
  }

  const donor = data.donor;
  const session = data.session;
  const donations = data.donations;
  const notifications = data.notifications;

  return (
    <div>
      <PageHeader
        title={formatDonorName(donor)}
        description={`Donor ${donor.donorNumber || donor.id}. Eligibility is operational only — not a medical approval.`}
        actions={
          <>
            <Link
              to="/donors"
              className="inline-flex rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back
            </Link>
            <ProtectedUi session={session} gate={UI_PERMISSIONS.donorsUpdate}>
              <Link
                to={`/donors/${donor.id}/edit`}
                className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
              >
                Edit
              </Link>
            </ProtectedUi>
          </>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState title="Action failed" message={actionData.error} />
        </div>
      ) : null}

      <section className="mb-6 rounded-lg border border-nbts-border bg-nbts-panel px-5 py-2">
        <h2 className="sr-only">Contact and eligibility</h2>
        <dl>
          <DetailRow label="Donor number" value={donor.donorNumber} />
          <DetailRow label="First name" value={donor.firstName} />
          <DetailRow label="Last name" value={donor.lastName} />
          <DetailRow label="Phone" value={donor.phone} />
          <DetailRow label="Email" value={donor.email} />
          <DetailRow label="Blood group" value={formatBloodGroup(donor)} />
          <DetailRow
            label="Eligibility"
            value={formatEligibilityStatus(donor.eligibilityStatus)}
          />
          <DetailRow label="Record status" value={formatActiveState(donor.active)} />
          <DetailRow
            label="Created"
            value={
              donor.createdAt
                ? new Date(donor.createdAt).toLocaleString()
                : undefined
            }
          />
          <DetailRow
            label="Updated"
            value={
              donor.updatedAt
                ? new Date(donor.updatedAt).toLocaleString()
                : undefined
            }
          />
        </dl>
        <p className="mt-2 pb-3 text-xs text-nbts-muted">
          “Potentially eligible” indicates the donor may be suitable for
          outreach. It is not a medical clearance.
        </p>
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <HistoryPanel title="Donation history">
          {donations.status === "ok" && (donations.items?.length ?? 0) > 0 ? (
            <>
              <ul className="divide-y divide-nbts-border text-sm">
                {donations.items.map((donation) => (
                  <li key={donation.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        to={`/donations/${donation.id}`}
                        className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                      >
                        {formatDateOnly(donation.donationDate)}
                      </Link>
                      <span className="text-nbts-muted">
                        {donation.units} unit
                        {donation.units === 1 ? "" : "s"} ·{" "}
                        {formatDonationBloodGroup(donation)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-nbts-muted">
                      {formatDonationCentreLabel(donation.donationCentre)}
                    </p>
                  </li>
                ))}
              </ul>
              {(donations.total ?? 0) > (donations.items?.length ?? 0) ? (
                <p className="mt-3 text-xs text-nbts-muted">
                  Showing {donations.items.length} of {donations.total}.{" "}
                  <Link
                    to={`/donations?donorId=${donor.id}`}
                    className="font-medium text-nbts-teal underline"
                  >
                    View all donations
                  </Link>
                </p>
              ) : (
                <p className="mt-3 text-xs text-nbts-muted">
                  <Link
                    to={`/donations?donorId=${donor.id}`}
                    className="font-medium text-nbts-teal underline"
                  >
                    Open donations list
                  </Link>
                </p>
              )}
            </>
          ) : donations.status === "ok" ? (
            <EmptyState
              title="No donations yet"
              description="No donation records are linked to this donor in the API."
              action={
                <ProtectedUi
                  session={session}
                  gate={UI_PERMISSIONS.donationsCreate}
                  fallback={null}
                >
                  <Link
                    to={`/donations/new?donorId=${donor.id}`}
                    className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
                  >
                    Record donation
                  </Link>
                </ProtectedUi>
              }
            />
          ) : (
            <EmptyState
              title="Donation history unavailable"
              description={donations.message}
            />
          )}
        </HistoryPanel>

        <HistoryPanel title="Notification history">
          {notifications.status === "ok" &&
          (notifications.items?.length ?? 0) > 0 ? (
            <>
              <ul className="divide-y divide-nbts-border text-sm">
                {notifications.items.map((notification) => (
                  <li
                    key={notification.id}
                    className="py-2 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-nbts-ink">
                        {notification.channel} · {notification.status}
                      </span>
                      <span className="text-nbts-muted">
                        {formatNotificationWhen(notification)}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-nbts-muted">
                      {notification.message?.trim() || "—"}
                    </p>
                  </li>
                ))}
              </ul>
              {(notifications.total ?? 0) >
              (notifications.items?.length ?? 0) ? (
                <p className="mt-3 text-xs text-nbts-muted">
                  Showing {notifications.items.length} of {notifications.total}.{" "}
                  <Link
                    to={`/notifications?donorId=${donor.id}`}
                    className="font-medium text-nbts-teal underline"
                  >
                    View all notifications
                  </Link>
                </p>
              ) : (
                <p className="mt-3 text-xs text-nbts-muted">
                  <Link
                    to={`/notifications?donorId=${donor.id}`}
                    className="font-medium text-nbts-teal underline"
                  >
                    Open notifications list
                  </Link>
                </p>
              )}
            </>
          ) : notifications.status === "ok" ? (
            <EmptyState
              title="No notifications yet"
              description="No notification records are linked to this donor in the API."
            />
          ) : (
            <EmptyState
              title="Notification history unavailable"
              description={notifications.message}
            />
          )}
        </HistoryPanel>
      </div>

      <ProtectedUi session={session} gate={UI_PERMISSIONS.donorsUpdate}>
        {donor.active ? (
          <>
            <Form
              ref={deactivateFormRef}
              method="post"
              className="rounded-lg border border-nbts-blood/20 bg-nbts-blood-soft px-5 py-4"
            >
              <input type="hidden" name="intent" value="deactivate" />
              <h2 className="text-sm font-semibold text-nbts-blood-dark">
                Soft-deactivate
              </h2>
              <p className="mt-1 text-sm text-nbts-muted">
                Sets active to false. Does not hard-delete historical donations or
                notifications.
              </p>
              <Button
                type="button"
                variant="danger"
                className="mt-3"
                disabled={busy}
                onClick={() => setDeactivateOpen(true)}
              >
                {busy ? "Deactivating…" : "Deactivate donor"}
              </Button>
            </Form>
            <ConfirmDialog
              open={deactivateOpen}
              title="Deactivate this donor?"
              description="Soft-deactivate keeps historical donations and notifications. The donor will no longer appear as active for matching."
              confirmLabel="Deactivate donor"
              tone="danger"
              busy={busy}
              onCancel={() => setDeactivateOpen(false)}
              onConfirm={() => {
                setDeactivateOpen(false);
                deactivateFormRef.current?.requestSubmit();
              }}
            />
          </>
        ) : (
          <p className="text-sm text-nbts-muted">
            This donor is inactive. Use Edit to reactivate if appropriate.
          </p>
        )}
      </ProtectedUi>
    </div>
  );
}
