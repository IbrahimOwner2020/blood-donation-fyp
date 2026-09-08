import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useSearchParams,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ProtectedUi } from "~/components/auth/ProtectedUi";
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
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  formatApiErrorMessage,
  formatDateTime,
  formatNotificationChannel,
  formatNotificationStatus,
  isForbiddenApiError,
  isNotificationsRouteMissingError,
  listNotifications,
  parseNotificationChannel,
  parseNotificationStatus,
  parsePositiveInt,
  type NotificationChannel,
  type NotificationStatus,
  type PublicNotification,
} from "~/lib/notifications";

export const meta: MetaFunction = () => [
  { title: "Notifications · NBTS Blood AI" },
];

type NotificationFilters = {
  alertId: string;
  channel: NotificationChannel | "";
  status: NotificationStatus | "";
  limit: number;
  offset: number;
};

type NotificationsIndexLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      filters: NotificationFilters;
      notifications: PublicNotification[];
      total: number;
      limit: number;
      offset: number;
      canSend: boolean;
      unavailableMessage?: string;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      filters: NotificationFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      filters: NotificationFilters;
    };

function parseFilters(url: URL): NotificationFilters {
  const alertId = (url.searchParams.get("alertId") || "").trim();
  const channel = parseNotificationChannel(url.searchParams.get("channel"));
  const status = parseNotificationStatus(url.searchParams.get("status"));
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), 50) || 50,
    100,
  );
  const offsetRaw = Number.parseInt(
    String(url.searchParams.get("offset") ?? "0").trim(),
    10,
  );
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  return {
    alertId,
    channel,
    status,
    limit,
    offset,
  };
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<NotificationsIndexLoaderData> {
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.notificationsRead)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include notifications:read. The API remains the access authority.",
      filters,
    };
  }

  const alertIdNum = parsePositiveInt(filters.alertId);

  try {
    const listResult = await listNotifications({
      alertId: Number.isFinite(alertIdNum) ? alertIdNum : undefined,
      channel: filters.channel || undefined,
      status: filters.status || undefined,
      limit: filters.limit,
      offset: filters.offset,
    });

    return {
      status: "ok",
      session,
      filters,
      notifications: listResult.notifications ?? [],
      total: listResult.total ?? 0,
      limit: listResult.limit ?? filters.limit,
      offset: listResult.offset ?? filters.offset,
      canSend: hasUiPermission(session, UI_PERMISSIONS.notificationsSend),
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view notifications.",
        ),
        filters,
      };
    }
    if (isNotificationsRouteMissingError(error)) {
      return {
        status: "ok",
        session,
        filters,
        notifications: [],
        total: 0,
        limit: filters.limit,
        offset: filters.offset,
        canSend: hasUiPermission(session, UI_PERMISSIONS.notificationsSend),
        unavailableMessage: formatApiErrorMessage(
          error,
          "Notification history is not available yet. The list will populate when /api/v1/notifications lands.",
        ),
      };
    }
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load notifications."),
      filters,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading notifications…" />;
}

export default function NotificationsIndexPage() {
  const loaderData = useLoaderData<NotificationsIndexLoaderData>();
  const [searchParams] = useSearchParams();

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Notifications"
          description="Preview and send history. Providers and matching logic stay on the API."
        />
        <ForbiddenState
          title="Notifications access restricted"
          message={
            loaderData.message ||
            "You do not have permission to view notifications (notifications:read)."
          }
          detail="UI gate only — the API enforces authorization."
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader title="Notifications" />
        <ErrorState
          title="Unable to load notifications"
          message={loaderData.message}
        />
      </div>
    );
  }

  const filters = loaderData?.filters;
  const notifications = loaderData?.notifications ?? [];
  const total = loaderData?.total ?? 0;
  const limit = loaderData?.limit ?? filters?.limit ?? 50;
  const offset = loaderData?.offset ?? filters?.offset ?? 0;
  const canSend = loaderData?.canSend === true;
  const unavailableMessage = loaderData?.unavailableMessage;
  const session = loaderData?.session;

  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;

  function pageHref(nextOffsetValue: number): string {
    const params = new URLSearchParams(searchParams);
    params.set("limit", String(limit));
    params.set("offset", String(nextOffsetValue));
    return `/notifications?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Send history from the API. Nothing is sent from this list — compose requires preview and an explicit confirm."
        actions={
          <ProtectedUi
            session={session}
            gate={UI_PERMISSIONS.notificationsSend}
            fallback={
              !canSend ? (
                <span className="text-sm text-nbts-muted">
                  Compose requires notifications:send
                </span>
              ) : null
            }
          >
            <Link
              to="/notifications/new"
              className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
            >
              Compose
            </Link>
          </ProtectedUi>
        }
      />

      {unavailableMessage ? (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {unavailableMessage}
        </div>
      ) : null}

      <Form
        method="get"
        className="mb-6 grid gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="block text-sm">
          <span className="text-nbts-muted">Alert id</span>
          <input
            name="alertId"
            type="text"
            inputMode="numeric"
            defaultValue={filters?.alertId || ""}
            placeholder="Optional"
            className="mt-1 w-full rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">Channel</span>
          <select
            name="channel"
            defaultValue={filters?.channel || ""}
            className="mt-1 w-full rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink"
          >
            <option value="">All</option>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {formatNotificationChannel(channel)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">Status</span>
          <select
            name="status"
            defaultValue={filters?.status || ""}
            className="mt-1 w-full rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink"
          >
            <option value="">All</option>
            {NOTIFICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatNotificationStatus(status)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <input type="hidden" name="limit" value={String(limit)} />
          <input type="hidden" name="offset" value="0" />
          <button
            type="submit"
            className="rounded bg-nbts-slate px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Filter
          </button>
          <Link
            to="/notifications"
            className="rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Clear
          </Link>
        </div>
      </Form>

      {notifications.length === 0 ? (
        <EmptyState
          title="No notifications loaded"
          description={
            unavailableMessage ||
            "Channel, recipient, status, and timestamps will appear when the API returns history."
          }
          action={
            canSend ? (
              <Link
                to="/notifications/new"
                className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
              >
                Compose notification
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-nbts-border">
            <table className="min-w-full divide-y divide-nbts-border text-left text-sm">
              <thead className="bg-nbts-panel text-xs uppercase tracking-wide text-nbts-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Id</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Donor</th>
                  <th className="px-3 py-2 font-medium">Alert</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-nbts-border bg-white">
                {notifications.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-nbts-ink">#{row.id}</td>
                    <td className="px-3 py-2 text-nbts-ink">
                      {formatNotificationChannel(row.channel)}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-nbts-ink">
                      {row.recipient || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/donors/${row.donorId}`}
                        className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                      >
                        {row.donorLabel || `#${row.donorId}`}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {row.alertId ? (
                        <Link
                          to={`/alerts/${row.alertId}`}
                          className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                        >
                          #{row.alertId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-nbts-ink">
                      {formatNotificationStatus(row.status)}
                    </td>
                    <td className="px-3 py-2 text-nbts-ink">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-nbts-ink">
                      {row.sentAt ? formatDateTime(row.sentAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-nbts-muted">
            <p>
              Showing {notifications.length} of {total} (offset {offset})
            </p>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  to={pageHref(prevOffset)}
                  className="rounded border border-nbts-border px-3 py-1.5 font-medium text-nbts-ink hover:border-nbts-muted"
                >
                  Previous
                </Link>
              ) : null}
              {hasNext ? (
                <Link
                  to={pageHref(nextOffset)}
                  className="rounded border border-nbts-border px-3 py-1.5 font-medium text-nbts-ink hover:border-nbts-muted"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
