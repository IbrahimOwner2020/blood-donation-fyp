import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  data,
  type ClientActionFunctionArgs,
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
import { listFacilities, type PublicFacility } from "~/lib/blood-requests";
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ApiRequestError,
  BLOOD_GROUP_OPTIONS,
  allowedNextAlertStatuses,
  formatAlertBloodGroup,
  formatAlertFacility,
  formatAlertSeverity,
  formatAlertStatus,
  formatApiErrorMessage,
  formatDateTime,
  formatUnits,
  isAlertsRouteMissingError,
  isForbiddenApiError,
  listAlerts,
  parseAlertSeverity,
  parseAlertStatus,
  parsePositiveInt,
  patchAlertStatus,
  recalculateAlerts,
  type AlertSeverity,
  type AlertStatus,
  type PublicAlert,
} from "~/lib/alerts";

export const meta: MetaFunction = () => [
  { title: "Alerts · NBTS Blood AI" },
];

type AlertFilters = {
  bloodGroup: string;
  facilityId: string;
  status: AlertStatus | "";
  severity: AlertSeverity | "";
  limit: number;
  offset: number;
};

type AlertsIndexLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      filters: AlertFilters;
      alerts: PublicAlert[];
      facilities: PublicFacility[];
      total: number;
      limit: number;
      offset: number;
      canUpdate: boolean;
      unavailableMessage?: string;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      filters: AlertFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      filters: AlertFilters;
    };

type AlertsActionData = {
  error?: string;
  success?: string;
};

function parseFilters(url: URL): AlertFilters {
  const bloodGroupRaw = (url.searchParams.get("bloodGroup") || "").trim();
  const bloodGroup = BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroupRaw)
    ? bloodGroupRaw
    : "";
  const facilityId = (url.searchParams.get("facilityId") || "").trim();
  const status = parseAlertStatus(url.searchParams.get("status"));
  const severity = parseAlertSeverity(url.searchParams.get("severity"));
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
    bloodGroup,
    facilityId,
    status,
    severity,
    limit,
    offset,
  };
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<AlertsIndexLoaderData> {
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.alertsRead)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include alerts:read. The API remains the access authority.",
      filters,
    };
  }

  const facilityIdNum = parsePositiveInt(filters.facilityId);

  try {
    const [listResult, facilities] = await Promise.all([
      listAlerts({
        bloodGroup: filters.bloodGroup || undefined,
        facilityId: Number.isFinite(facilityIdNum) ? facilityIdNum : undefined,
        status: filters.status || undefined,
        severity: filters.severity || undefined,
        limit: filters.limit,
        offset: filters.offset,
      }),
      listFacilities({ active: true }).catch(() => [] as PublicFacility[]),
    ]);

    return {
      status: "ok",
      session,
      filters,
      alerts: listResult.alerts ?? [],
      facilities: facilities ?? [],
      total: listResult.total ?? 0,
      limit: listResult.limit ?? filters.limit,
      offset: listResult.offset ?? filters.offset,
      canUpdate: hasUiPermission(session, UI_PERMISSIONS.alertsUpdate),
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view alerts.",
        ),
        filters,
      };
    }
    if (isAlertsRouteMissingError(error)) {
      return {
        status: "ok",
        session,
        filters,
        alerts: [],
        facilities: [],
        total: 0,
        limit: filters.limit,
        offset: filters.offset,
        canUpdate: hasUiPermission(session, UI_PERMISSIONS.alertsUpdate),
        unavailableMessage: formatApiErrorMessage(
          error,
          "Alerts endpoints are not available yet. The table will populate when /api/v1/alerts lands.",
        ),
      };
    }
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load alerts."),
      filters,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading alerts…" />;
}

export async function clientAction({
  request,
}: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.alertsUpdate)) {
    return data<AlertsActionData>(
      { error: "You do not have permission to update alerts (alerts:update)." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();

  if (intent === "recalculate") {
    try {
      await recalculateAlerts();
      return data<AlertsActionData>({
        success: "Recalculate requested. Refresh to see API results.",
      });
    } catch (error) {
      if (isAlertsRouteMissingError(error)) {
        return data<AlertsActionData>({
          error:
            "Alerts API is not available yet — recalculate will work when the module lands.",
        });
      }
      return data<AlertsActionData>({
        error: formatApiErrorMessage(error, "Unable to recalculate alerts."),
      });
    }
  }

  if (intent === "status") {
    const alertId = parsePositiveInt(String(formData.get("alertId") || ""));
    const nextStatus = parseAlertStatus(String(formData.get("status") || ""));
    if (!Number.isFinite(alertId) || !nextStatus) {
      return data<AlertsActionData>(
        { error: "Invalid alert status update." },
        { status: 400 },
      );
    }
    try {
      const updated = await patchAlertStatus(alertId, nextStatus);
      return data<AlertsActionData>({
        success: `Alert #${updated.id} → ${formatAlertStatus(updated.status)}.`,
      });
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      if (isAlertsRouteMissingError(error)) {
        return data<AlertsActionData>({
          error: "Alerts API is not available yet.",
        });
      }
      return data<AlertsActionData>(
        {
          error: formatApiErrorMessage(error, "Unable to update alert status."),
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

  return data<AlertsActionData>({ error: "Unknown action." }, { status: 400 });
}

const inputClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

function severityToneClass(severity: string = ""): string {
  const value = severity.trim().toUpperCase();
  if (value === "CRITICAL" || value === "HIGH") {
    return "text-nbts-blood font-medium";
  }
  if (value === "MEDIUM") {
    return "text-nbts-amber font-medium";
  }
  return "text-nbts-ink";
}

function statusToneClass(status: string = ""): string {
  const value = status.trim().toUpperCase();
  if (value === "RESOLVED") {
    return "text-nbts-teal";
  }
  if (value === "OPEN" || value === "ACKNOWLEDGED") {
    return "text-nbts-amber";
  }
  return "text-nbts-muted";
}

function buildPageQuery(
  filters: AlertFilters,
  offset: number,
  limit: number,
): string {
  return new URLSearchParams({
    ...(filters.bloodGroup ? { bloodGroup: filters.bloodGroup } : {}),
    ...(filters.facilityId ? { facilityId: filters.facilityId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    limit: String(limit),
    offset: String(offset),
  }).toString();
}

export default function AlertsIndexPage() {
  const loaderData = useLoaderData<AlertsIndexLoaderData>();
  const actionData = useActionData<AlertsActionData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/alerts";
  const isActing = navigation.state === "submitting";

  const filters =
    loaderData?.filters ?? parseFilters(new URL("http://local/alerts"));

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Shortage alerts"
          description="Alert lifecycle and severity are API-owned. The browser never calculates projected gaps."
        />
        <ForbiddenState
          title="Alerts access restricted"
          message={
            loaderData.message ||
            "You do not have permission to view alerts (alerts:read)."
          }
          detail="UI gate only — the API enforces authorization."
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader
          title="Shortage alerts"
          description="Alert lifecycle and severity are API-owned. The browser never calculates projected gaps."
        />
        <ErrorState title="Unable to load alerts" message={loaderData.message} />
      </div>
    );
  }

  const alerts = loaderData?.alerts ?? [];
  const facilities = loaderData?.facilities ?? [];
  const total = loaderData?.total ?? 0;
  const limit = loaderData?.limit ?? filters.limit;
  const offset = loaderData?.offset ?? filters.offset;
  const canUpdate = loaderData?.canUpdate === true;
  const unavailableMessage = loaderData?.unavailableMessage;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;

  return (
    <div>
      <PageHeader
        title="Shortage alerts"
        description="Columns bind to API data only. Severity is never calculated in the browser. Status actions call PATCH /alerts/:id/status when available."
        actions={
          <ProtectedUi
            session={loaderData?.session}
            gate={UI_PERMISSIONS.alertsUpdate}
            fallback={null}
          >
            <Form method="post">
              <input type="hidden" name="intent" value="recalculate" />
              <button
                type="submit"
                disabled={isActing || Boolean(unavailableMessage)}
                className="inline-flex rounded border border-nbts-border bg-white px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted disabled:opacity-50"
                title={
                  unavailableMessage
                    ? "Alerts API not mounted yet"
                    : "POST /alerts/recalculate"
                }
              >
                Recalculate
              </button>
            </Form>
          </ProtectedUi>
        }
      />

      {actionData?.error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionData.error}
        </div>
      ) : null}
      {actionData?.success ? (
        <div className="mb-4 rounded border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-nbts-teal">
          {actionData.success}
        </div>
      ) : null}

      {unavailableMessage ? (
        <div className="mb-4 rounded border border-nbts-border bg-nbts-surface px-4 py-3 text-sm text-nbts-muted">
          {unavailableMessage}
        </div>
      ) : null}

      <Form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-nbts-muted">
          Blood group
          <select
            name="bloodGroup"
            defaultValue={filters.bloodGroup}
            className={inputClass}
          >
            <option value="">All</option>
            {BLOOD_GROUP_OPTIONS.map((group) => (
              <option key={group.code} value={group.code}>
                {group.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-nbts-muted">
          Facility
          <select
            name="facilityId"
            defaultValue={filters.facilityId}
            className={inputClass}
          >
            <option value="">All</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={String(facility.id)}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-nbts-muted">
          Status
          <select
            name="status"
            defaultValue={filters.status}
            className={inputClass}
          >
            <option value="">All</option>
            {ALERT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatAlertStatus(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-nbts-muted">
          Severity
          <select
            name="severity"
            defaultValue={filters.severity}
            className={inputClass}
          >
            <option value="">All</option>
            {ALERT_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {formatAlertSeverity(severity)}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="limit" value={String(limit)} />
        <input type="hidden" name="offset" value="0" />
        <button
          type="submit"
          className="rounded border border-nbts-border bg-white px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
        >
          Apply filters
        </button>
        {searchParams.toString() ? (
          <Link
            to="/alerts"
            className="rounded px-3 py-2 text-sm text-nbts-muted underline-offset-2 hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </Form>

      {isFiltering ? (
        <LoadingState label="Updating alerts…" />
      ) : alerts.length === 0 ? (
        <EmptyState
          title={unavailableMessage ? "Alerts API not ready" : "No alerts"}
          description={
            unavailableMessage ||
            "No shortage alerts match these filters. Severity and gaps remain API-owned when alerts appear."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Alert</th>
                  <th className="px-4 py-3 font-medium">Blood group</th>
                  <th className="px-4 py-3 font-medium">Facility</th>
                  <th className="px-4 py-3 font-medium">Supply</th>
                  <th className="px-4 py-3 font-medium">Predicted demand</th>
                  <th className="px-4 py-3 font-medium">Gap</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {canUpdate ? (
                    <th className="px-4 py-3 font-medium">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => {
                  const nextStatuses = allowedNextAlertStatuses(alert.status);
                  return (
                    <tr
                      key={alert.id}
                      className="border-b border-nbts-border last:border-0 align-top"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/alerts/${alert.id}`}
                          className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                        >
                          #{alert.id}
                        </Link>
                        <p className="text-xs text-nbts-muted">
                          Pred{" "}
                          <Link
                            to={`/predictions/${alert.predictionId}`}
                            className="underline-offset-2 hover:underline"
                          >
                            #{alert.predictionId}
                          </Link>
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {formatAlertBloodGroup(alert)}
                      </td>
                      <td className="px-4 py-3 text-nbts-muted">
                        {formatAlertFacility(
                          alert.facility,
                          alert.facilityId ?? 0,
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {formatUnits(alert.availableUnits)}
                      </td>
                      <td className="px-4 py-3">
                        {formatUnits(alert.predictedUnits)}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatUnits(alert.projectedGap)}
                      </td>
                      <td
                        className={`px-4 py-3 ${severityToneClass(alert.severity)}`}
                      >
                        {formatAlertSeverity(alert.severity)}
                      </td>
                      <td
                        className={`px-4 py-3 ${statusToneClass(alert.status)}`}
                      >
                        {formatAlertStatus(alert.status)}
                      </td>
                      {canUpdate ? (
                        <td className="px-4 py-3">
                          {nextStatuses.length === 0 ? (
                            <span className="text-xs text-nbts-muted">
                              Terminal
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {nextStatuses.map((next) => (
                                <Form key={next} method="post">
                                  <input
                                    type="hidden"
                                    name="intent"
                                    value="status"
                                  />
                                  <input
                                    type="hidden"
                                    name="alertId"
                                    value={String(alert.id)}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value={next}
                                  />
                                  <button
                                    type="submit"
                                    disabled={isActing}
                                    className="rounded border border-nbts-border px-2 py-1 text-xs font-medium text-nbts-ink hover:border-nbts-muted disabled:opacity-50"
                                  >
                                    {formatAlertStatus(next)}
                                  </button>
                                </Form>
                              ))}
                            </div>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-nbts-muted">
            <span>
              Showing {offset + 1}–{Math.min(offset + alerts.length, total)} of{" "}
              {total}
            </span>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  to={`/alerts?${buildPageQuery(filters, prevOffset, limit)}`}
                  className="rounded border border-nbts-border px-3 py-1.5 text-nbts-ink hover:border-nbts-muted"
                >
                  Previous
                </Link>
              ) : null}
              {hasNext ? (
                <Link
                  to={`/alerts?${buildPageQuery(filters, nextOffset, limit)}`}
                  className="rounded border border-nbts-border px-3 py-1.5 text-nbts-ink hover:border-nbts-muted"
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
