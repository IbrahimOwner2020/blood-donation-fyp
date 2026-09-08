import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useRef, useState } from "react";

import { ProtectedUi } from "~/components/auth/ProtectedUi";
import { Button } from "~/components/ui/Button";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { EmptyState } from "~/components/ui/EmptyState";
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
import {
  formatAlertBloodGroup,
  formatAlertSeverity,
  formatAlertStatus,
  formatApiErrorMessage as formatAlertApiError,
  isAlertsRouteMissingError,
  isForbiddenApiError as isAlertsForbidden,
  listAlertMatches,
  listAlerts,
  parsePositiveInt,
  type PublicAlert,
} from "~/lib/alerts";
import {
  formatDonorName,
  formatEligibilityStatus,
  type PublicDonor,
} from "~/lib/donors";
import {
  NOTIFICATION_CHANNELS,
  ApiRequestError,
  buildDefaultNotificationMessage,
  buildLocalPreview,
  formatApiErrorMessage,
  formatNotificationChannel,
  isForbiddenApiError,
  isNotificationsRouteMissingError,
  parseDonorIdList,
  parseNotificationChannel,
  previewNotifications,
  sendNotifications,
  type NotificationChannel,
  type NotificationPreviewItem,
  type LocalPreviewDonor,
  type PreviewNotificationsResult,
} from "~/lib/notifications";

export const meta: MetaFunction = () => [
  { title: "Compose notification · NBTS Blood AI" },
];

type ComposeLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      alerts: PublicAlert[];
      alertsUnavailableMessage?: string;
      selectedAlertId: number | null;
      selectedAlert: PublicAlert | null;
      matches: PublicDonor[];
      matchTotal: number;
      matchDisclaimer: string;
      matchesUnavailableMessage?: string;
      matchesError?: string;
      canReadAlerts: boolean;
      canReadDonors: boolean;
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

type ComposeActionData = {
  error?: string;
  success?: string;
  intent?: "preview" | "send";
  preview?: PreviewNotificationsResult;
  selectedDonorIds?: number[];
  channel?: NotificationChannel;
  message?: string;
  alertId?: number;
};

function parseAlertIdFromUrl(url: URL): number | null {
  const raw = parsePositiveInt(url.searchParams.get("alertId"));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<ComposeLoaderData> {
  const url = new URL(request.url);
  const selectedAlertId = parseAlertIdFromUrl(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.notificationsSend)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include notifications:send. The API remains the access authority.",
    };
  }

  const canReadAlerts = hasUiPermission(session, UI_PERMISSIONS.alertsRead);
  const canReadDonors = hasUiPermission(session, UI_PERMISSIONS.donorsRead);

  let alerts: PublicAlert[] = [];
  let alertsUnavailableMessage: string | undefined;

  if (canReadAlerts) {
    try {
      const listResult = await listAlerts({
        status: "OPEN",
        limit: 50,
        offset: 0,
      });
      const openAlerts = listResult.alerts ?? [];
      // Also surface acknowledged alerts for outreach.
      let acknowledged: PublicAlert[] = [];
      try {
        const ackResult = await listAlerts({
          status: "ACKNOWLEDGED",
          limit: 50,
          offset: 0,
        });
        acknowledged = ackResult.alerts ?? [];
      } catch {
        acknowledged = [];
      }
      const byId = new Map<number, PublicAlert>();
      for (const alert of [...openAlerts, ...acknowledged]) {
        if (alert?.id) {
          byId.set(alert.id, alert);
        }
      }
      alerts = [...byId.values()].sort((a, b) => b.id - a.id);
    } catch (error) {
      if (isAlertsForbidden(error)) {
        alertsUnavailableMessage = formatAlertApiError(
          error,
          "You do not have permission to list alerts for selection.",
        );
      } else if (isAlertsRouteMissingError(error)) {
        alertsUnavailableMessage = formatAlertApiError(
          error,
          "Alerts API is not available yet. Select an alert when /api/v1/alerts is mounted.",
        );
      } else {
        return {
          status: "error",
          session,
          message: formatAlertApiError(error, "Unable to load alerts."),
        };
      }
    }
  } else {
    alertsUnavailableMessage =
      "Listing alerts requires alerts:read. You can still open compose with ?alertId= if you know the id.";
  }

  let selectedAlert: PublicAlert | null =
    alerts.find((alert) => alert.id === selectedAlertId) ?? null;
  let matches: PublicDonor[] = [];
  let matchTotal = 0;
  let matchDisclaimer =
    "Matches are potentially eligible registered donors for review — not a medical approval. Notifications are never sent automatically.";
  let matchesUnavailableMessage: string | undefined;
  let matchesError: string | undefined;

  if (selectedAlertId && canReadAlerts && canReadDonors) {
    try {
      const matchResult = await listAlertMatches(selectedAlertId, {
        limit: 100,
        offset: 0,
      });
      matches = matchResult.matches ?? [];
      matchTotal = matchResult.total ?? matches.length;
      if (matchResult.disclaimer?.trim()) {
        matchDisclaimer = matchResult.disclaimer.trim();
      }
      if (matchResult.alert) {
        selectedAlert = matchResult.alert;
      }
    } catch (error) {
      if (isAlertsForbidden(error) || isForbiddenApiError(error)) {
        matchesError = formatAlertApiError(
          error,
          "You do not have permission to view matches (alerts:read + donors:read).",
        );
      } else if (isAlertsRouteMissingError(error)) {
        matchesUnavailableMessage = formatAlertApiError(
          error,
          "Match endpoint is not available yet. Matches will appear when GET /alerts/:id/matches is mounted.",
        );
      } else if (
        error instanceof ApiRequestError &&
        (error.status === 404 || error.code === "NOT_FOUND")
      ) {
        matchesError = formatAlertApiError(
          error,
          "Alert not found or has no match route.",
        );
      } else {
        matchesError = formatAlertApiError(error, "Unable to load matches.");
      }
    }
  } else if (selectedAlertId && (!canReadAlerts || !canReadDonors)) {
    matchesError =
      "Loading matches requires both alerts:read and donors:read in addition to notifications:send.";
  }

  return {
    status: "ok",
    session,
    alerts,
    alertsUnavailableMessage,
    selectedAlertId,
    selectedAlert,
    matches,
    matchTotal,
    matchDisclaimer,
    matchesUnavailableMessage,
    matchesError,
    canReadAlerts,
    canReadDonors,
  };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading compose form…" />;
}

export async function clientAction({
  request,
}: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.notificationsSend)) {
    return data<ComposeActionData>(
      {
        error:
          "You do not have permission to preview or send notifications (notifications:send).",
      },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  const alertId = parsePositiveInt(String(formData.get("alertId") || ""));
  const channel =
    parseNotificationChannel(String(formData.get("channel") || "")) || "SMS";
  const messageRaw = String(formData.get("message") || "");
  const donorIds = parseDonorIdList(formData, "donorIds");
  const bloodGroupCode = String(formData.get("bloodGroupCode") || "").trim();

  if (!Number.isFinite(alertId) || alertId <= 0) {
    return data<ComposeActionData>(
      { error: "Select a shortage alert before preview or send." },
      { status: 400 },
    );
  }
  if (donorIds.length === 0) {
    return data<ComposeActionData>(
      { error: "Select at least one matched donor to notify." },
      { status: 400 },
    );
  }

  if (intent === "preview") {
    const message =
      messageRaw.trim() ||
      buildDefaultNotificationMessage(channel, bloodGroupCode);

    try {
      const preview = await previewNotifications({
        alertId,
        donorIds,
        channel,
        message,
      });
      return data<ComposeActionData>({
        intent: "preview",
        preview,
        selectedDonorIds: donorIds,
        channel,
        message: preview.message || message,
        alertId,
      });
    } catch (error) {
      if (isNotificationsRouteMissingError(error)) {
        // Local draft for review only — send still requires the API.
        const donorsJson = String(formData.get("donorsJson") || "");
        let donors: LocalPreviewDonor[] = [];
        try {
          const parsed: unknown = donorsJson ? JSON.parse(donorsJson) : [];
          if (Array.isArray(parsed)) {
            donors = parsed.filter(
              (row): row is LocalPreviewDonor =>
                typeof row === "object" &&
                row !== null &&
                typeof (row as LocalPreviewDonor).id === "number",
            );
          }
        } catch {
          donors = [];
        }
        const preview = buildLocalPreview(
          { alertId, donorIds, channel, message },
          donors,
          bloodGroupCode,
        );
        return data<ComposeActionData>({
          intent: "preview",
          preview,
          selectedDonorIds: donorIds,
          channel,
          message: preview.message,
          alertId,
          error:
            "Preview API is not mounted yet — showing a local draft for review. Send will work when POST /notifications/send lands.",
        });
      }
      return data<ComposeActionData>(
        {
          error: formatApiErrorMessage(error, "Unable to preview notification."),
          intent: "preview",
          selectedDonorIds: donorIds,
          channel,
          message: messageRaw,
          alertId,
        },
        {
          status:
            error instanceof ApiRequestError && error.status >= 400
              ? error.status
              : 500,
        },
      );
    }
  }

  if (intent === "send") {
    const confirmSend = String(formData.get("confirmSend") || "") === "yes";
    const donorsJson = String(formData.get("donorsJson") || "");
    let donors: LocalPreviewDonor[] = [];
    try {
      const parsed: unknown = donorsJson ? JSON.parse(donorsJson) : [];
      if (Array.isArray(parsed)) {
        donors = parsed.filter(
          (row): row is LocalPreviewDonor =>
            typeof row === "object" &&
            row !== null &&
            typeof (row as LocalPreviewDonor).id === "number",
        );
      }
    } catch {
      donors = [];
    }
    const retainedPreview = buildLocalPreview(
      {
        alertId,
        donorIds,
        channel,
        message: messageRaw.trim() || undefined,
      },
      donors,
      bloodGroupCode,
    );
    // Mark as non-local if we already had an API preview message in the form.
    retainedPreview.localDraft = false;

    if (!confirmSend) {
      return data<ComposeActionData>(
        {
          error:
            "Confirm send explicitly. Notifications are never sent automatically.",
          intent: "send",
          preview: retainedPreview,
          selectedDonorIds: donorIds,
          channel,
          message: messageRaw,
          alertId,
        },
        { status: 400 },
      );
    }

    const message = messageRaw.trim();
    if (!message) {
      return data<ComposeActionData>(
        {
          error: "Review and keep a message body before sending.",
          intent: "send",
          preview: retainedPreview,
          selectedDonorIds: donorIds,
          channel,
          alertId,
        },
        { status: 400 },
      );
    }

    try {
      const result = await sendNotifications({
        alertId,
        donorIds,
        channel,
        message,
      });
      const sent = result.sentCount ?? 0;
      const failed = result.failedCount ?? 0;
      return data<ComposeActionData>({
        intent: "send",
        success: `Send requested for ${donorIds.length} recipient(s). Sent: ${sent}, failed: ${failed}. Check history for provider results.`,
        selectedDonorIds: donorIds,
        channel,
        message,
        alertId,
      });
    } catch (error) {
      if (isNotificationsRouteMissingError(error)) {
        return data<ComposeActionData>({
          error:
            "Send API is not available yet. Nothing was sent. History and send will work when /api/v1/notifications lands.",
          intent: "send",
          preview: retainedPreview,
          selectedDonorIds: donorIds,
          channel,
          message,
          alertId,
        });
      }
      if (isForbiddenApiError(error)) {
        return data<ComposeActionData>(
          {
            error: formatApiErrorMessage(
              error,
              "You do not have permission to send notifications.",
            ),
            intent: "send",
            preview: retainedPreview,
            selectedDonorIds: donorIds,
            channel,
            message,
            alertId,
          },
          { status: 403 },
        );
      }
      return data<ComposeActionData>(
        {
          error: formatApiErrorMessage(error, "Unable to send notifications."),
          intent: "send",
          preview: retainedPreview,
          selectedDonorIds: donorIds,
          channel,
          message,
          alertId,
        },
        {
          status:
            error instanceof ApiRequestError && error.status >= 400
              ? error.status
              : 500,
        },
      );
    }
  }

  return data<ComposeActionData>(
    { error: "Unknown action. Use Preview or Confirm send." },
    { status: 400 },
  );
}

function PreviewTable({
  previews = [],
}: {
  previews?: NotificationPreviewItem[];
}) {
  if (!previews.length) {
    return (
      <EmptyState
        title="No preview rows"
        description="Select donors and run Preview to review recipients and message copy."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-nbts-border">
      <table className="min-w-full divide-y divide-nbts-border text-left text-sm">
        <thead className="bg-nbts-panel text-xs uppercase tracking-wide text-nbts-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Donor</th>
            <th className="px-3 py-2 font-medium">Channel</th>
            <th className="px-3 py-2 font-medium">Destination</th>
            <th className="px-3 py-2 font-medium">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-nbts-border bg-white">
          {previews.map((row) => (
            <tr key={`${row.donorId}-${row.channel}-${row.recipient}`}>
              <td className="px-3 py-2 text-nbts-ink">{row.donorLabel}</td>
              <td className="px-3 py-2 text-nbts-ink">
                {formatNotificationChannel(row.channel)}
              </td>
              <td className="px-3 py-2 text-nbts-ink">{row.recipient || "—"}</td>
              <td className="max-w-md whitespace-pre-wrap px-3 py-2 text-nbts-ink">
                {row.message || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NotificationNewPage() {
  const loaderData = useLoaderData<ComposeLoaderData>();
  const actionData = useActionData<ComposeActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const submittingIntent = String(
    navigation.formData?.get("intent") || "",
  ).trim();
  const [sendOpen, setSendOpen] = useState(false);
  const sendSubmitRef = useRef<HTMLButtonElement>(null);
  const confirmCheckboxRef = useRef<HTMLInputElement>(null);
  const [sendGateError, setSendGateError] = useState<string | null>(null);

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Compose notification"
          description="Select an alert, review matches, preview, then confirm send."
        />
        <ForbiddenState
          title="Send permission required"
          message={
            loaderData.message ||
            "You do not have permission to compose notifications (notifications:send)."
          }
          detail="UI gate only — the API enforces authorization."
          action={
            <Link
              to="/notifications"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to history
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader title="Compose notification" />
        <ErrorState title="Unable to load compose" message={loaderData.message} />
      </div>
    );
  }

  if (loaderData?.status !== "ok") {
    return <LoadingState label="Loading compose form…" />;
  }

  const {
    session,
    alerts,
    alertsUnavailableMessage,
    selectedAlertId,
    selectedAlert,
    matches,
    matchTotal,
    matchDisclaimer,
    matchesUnavailableMessage,
    matchesError,
  } = loaderData;

  const bloodGroupCode = formatAlertBloodGroup(selectedAlert);
  const defaultMessage =
    actionData?.message ||
    buildDefaultNotificationMessage(
      actionData?.channel || "SMS",
      bloodGroupCode === "—" ? "" : bloodGroupCode,
    );
  const selectedSet = new Set(actionData?.selectedDonorIds ?? []);
  const previewReady = Boolean(actionData?.preview?.previews?.length);
  const donorsJson = JSON.stringify(
    matches.map((donor) => ({
      id: donor.id,
      firstName: donor.firstName,
      lastName: donor.lastName,
      donorNumber: donor.donorNumber,
      phone: donor.phone,
      email: donor.email,
    })),
  );

  return (
    <div>
      <PageHeader
        title="Compose notification"
        description="Workflow: select alert → review matches → preview → explicit send confirm. Matching and delivery stay on the API — never auto-send."
        actions={
          <Link
            to="/notifications"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            History
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionData.error}
        </div>
      ) : null}
      {actionData?.success ? (
        <div className="mb-4 rounded border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-nbts-teal">
          {actionData.success}{" "}
          <Link
            to="/notifications"
            className="font-medium underline-offset-2 hover:underline"
          >
            View history
          </Link>
        </div>
      ) : null}

      <section className="mb-6 rounded-lg border border-nbts-border bg-nbts-panel p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-nbts-muted">
          1. Select shortage alert
        </h2>
        <p className="mt-1 text-sm text-nbts-muted">
          Open or acknowledged alerts only. Matches load from GET
          /alerts/:id/matches.
        </p>
        {alertsUnavailableMessage ? (
          <p className="mt-3 text-sm text-amber-800">{alertsUnavailableMessage}</p>
        ) : null}
        <Form method="get" className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[16rem] flex-1 text-sm">
            <span className="text-nbts-muted">Alert</span>
            <select
              name="alertId"
              defaultValue={selectedAlertId ? String(selectedAlertId) : ""}
              className="mt-1 w-full rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink"
              required
            >
              <option value="">Select an alert…</option>
              {alerts.map((alert) => (
                <option key={alert.id} value={alert.id}>
                  #{alert.id} · {formatAlertBloodGroup(alert)} ·{" "}
                  {formatAlertSeverity(alert.severity)} ·{" "}
                  {formatAlertStatus(alert.status)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded bg-nbts-slate px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Load matches
          </button>
        </Form>
        {selectedAlert ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase text-nbts-muted">Blood group</dt>
              <dd className="text-sm font-medium text-nbts-ink">
                {formatAlertBloodGroup(selectedAlert)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-nbts-muted">Severity</dt>
              <dd className="text-sm font-medium text-nbts-ink">
                {formatAlertSeverity(selectedAlert.severity)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-nbts-muted">Status</dt>
              <dd className="text-sm font-medium text-nbts-ink">
                {formatAlertStatus(selectedAlert.status)}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      {!selectedAlertId ? (
        <EmptyState
          title="No alert selected"
          description="Choose a shortage alert above to load potential donor matches for review."
        />
      ) : (
        <Form method="post" className="space-y-6" key={`compose-${selectedAlertId}-${actionData?.intent || "idle"}`}>
          <input type="hidden" name="alertId" value={String(selectedAlertId)} />
          <input
            type="hidden"
            name="bloodGroupCode"
            value={bloodGroupCode === "—" ? "" : bloodGroupCode}
          />
          <input type="hidden" name="donorsJson" value={donorsJson} />

          <section className="rounded-lg border border-nbts-border bg-nbts-panel p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-nbts-muted">
              2. Review matched donors
            </h2>
            <p className="mt-1 text-sm text-nbts-muted">{matchDisclaimer}</p>
            {matchesUnavailableMessage ? (
              <p className="mt-3 text-sm text-amber-800">
                {matchesUnavailableMessage}
              </p>
            ) : null}
            {matchesError ? (
              <div className="mt-3">
                <ErrorState title="Matches unavailable" message={matchesError} />
              </div>
            ) : null}

            {!matchesError && matches.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No matches for this alert"
                  description={
                    matchesUnavailableMessage ||
                    "The API returned no potentially eligible donors with contact details."
                  }
                />
              </div>
            ) : null}

            {matches.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-nbts-border bg-white">
                <table className="min-w-full divide-y divide-nbts-border text-left text-sm">
                  <thead className="bg-nbts-panel/60 text-xs uppercase tracking-wide text-nbts-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Notify</th>
                      <th className="px-3 py-2 font-medium">Donor</th>
                      <th className="px-3 py-2 font-medium">Number</th>
                      <th className="px-3 py-2 font-medium">Phone</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Eligibility</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-nbts-border">
                    {matches.map((donor) => (
                      <tr key={donor.id}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            name="donorIds"
                            value={String(donor.id)}
                            defaultChecked={
                              selectedSet.size === 0
                                ? false
                                : selectedSet.has(donor.id)
                            }
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            to={`/donors/${donor.id}`}
                            className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                          >
                            {formatDonorName(donor)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-nbts-ink">
                          {donor.donorNumber || "—"}
                        </td>
                        <td className="px-3 py-2 text-nbts-ink">
                          {donor.phone || "—"}
                        </td>
                        <td className="px-3 py-2 text-nbts-ink">
                          {donor.email || "—"}
                        </td>
                        <td className="px-3 py-2 text-nbts-ink">
                          {formatEligibilityStatus(donor.eligibilityStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {matchTotal > matches.length ? (
              <p className="mt-2 text-sm text-nbts-muted">
                Showing {matches.length} of {matchTotal} matches (first page).
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-nbts-border bg-nbts-panel p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-nbts-muted">
              3. Channel and message
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-nbts-muted">Channel</span>
                <select
                  name="channel"
                  defaultValue={actionData?.channel || "SMS"}
                  className="mt-1 w-full rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink"
                >
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {formatNotificationChannel(channel)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-sm text-nbts-muted sm:pt-6">
                SMS uses phone; Email uses email. Recipients without the chosen
                contact may fail at send time (API decides).
              </div>
            </div>
            <label className="mt-4 block text-sm">
              <span className="text-nbts-muted">Message</span>
              <textarea
                name="message"
                rows={4}
                defaultValue={defaultMessage}
                className="mt-1 w-full rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink"
              />
            </label>
            <div className="mt-4">
              <button
                type="submit"
                name="intent"
                value="preview"
                disabled={busy || matches.length === 0}
                className="rounded bg-nbts-slate px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {busy && submittingIntent === "preview"
                  ? "Building preview…"
                  : "Preview (required before send)"}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-nbts-border bg-nbts-panel p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-nbts-muted">
              4. Preview and confirm send
            </h2>
            <p className="mt-1 text-sm text-nbts-muted">
              Review destinations and copy. Send stays disabled until you
              preview and check the confirmation box.
            </p>
            {actionData?.preview?.localDraft ? (
              <p className="mt-3 text-sm text-amber-800">
                Local draft preview — API preview endpoint not mounted yet.
              </p>
            ) : null}
            <div className="mt-4">
              {previewReady ? (
                <PreviewTable previews={actionData?.preview?.previews} />
              ) : (
                <EmptyState
                  title="No preview yet"
                  description="Select donors, choose a channel, then click Preview. Nothing is sent by preview."
                />
              )}
            </div>

            <ProtectedUi session={session} gate={UI_PERMISSIONS.notificationsSend}>
              <div className="mt-4 space-y-3">
                <label className="flex items-start gap-2 text-sm text-nbts-ink">
                  <input
                    ref={confirmCheckboxRef}
                    type="checkbox"
                    name="confirmSend"
                    value="yes"
                    className="mt-0.5 h-4 w-4"
                    disabled={!previewReady}
                    onChange={() => setSendGateError(null)}
                  />
                  <span>
                    I reviewed the preview and confirm sending these
                    notifications now. This action is not automatic.
                  </span>
                </label>
                {sendGateError ? (
                  <p className="text-sm text-nbts-blood">{sendGateError}</p>
                ) : null}
                <Button
                  type="button"
                  disabled={busy || !previewReady}
                  onClick={() => {
                    if (!confirmCheckboxRef.current?.checked) {
                      setSendGateError(
                        "Check the confirmation box after reviewing the preview.",
                      );
                      return;
                    }
                    setSendGateError(null);
                    setSendOpen(true);
                  }}
                >
                  {busy && submittingIntent === "send"
                    ? "Sending…"
                    : "Confirm send"}
                </Button>
                <button
                  ref={sendSubmitRef}
                  type="submit"
                  name="intent"
                  value="send"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  Submit send
                </button>
                <ConfirmDialog
                  open={sendOpen}
                  title="Send notifications now?"
                  description={`This will send to ${actionData?.preview?.previews?.length ?? 0} recipient(s) via the API. Delivery cannot be undone from the UI.`}
                  confirmLabel="Send now"
                  tone="danger"
                  busy={busy && submittingIntent === "send"}
                  onCancel={() => setSendOpen(false)}
                  onConfirm={() => {
                    setSendOpen(false);
                    sendSubmitRef.current?.click();
                  }}
                />
              </div>
            </ProtectedUi>
          </section>
        </Form>
      )}
    </div>
  );
}
