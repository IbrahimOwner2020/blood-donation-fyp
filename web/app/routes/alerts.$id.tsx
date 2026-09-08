import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  data,
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
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import {
  allowedNextAlertStatuses,
  formatAlertBloodGroup,
  formatAlertFacility,
  formatAlertSeverity,
  formatAlertStatus,
  formatApiErrorMessage,
  formatDateTime,
  formatUnits,
  getAlert,
  isAlertsUnavailableError,
  isForbiddenApiError,
  isTerminalAlertStatus,
  parseAlertStatus,
  parsePositiveInt,
  patchAlertStatus,
  type AlertStatus,
  type PublicAlert,
} from "~/lib/alerts";

export const meta: MetaFunction = () => [
  { title: "Alert detail · NBTS Blood AI" },
];

type AlertDetailLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      alert: PublicAlert;
      canUpdate: boolean;
      nextStatuses: AlertStatus[];
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      alertId: string;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      alertId: string;
    }
  | {
      status: "not_found";
      session: AuthSession;
      message: string;
      alertId: string;
    }
  | {
      status: "unavailable";
      session: AuthSession;
      message: string;
      alertId: string;
    };

type AlertDetailActionData = {
  error?: string;
  success?: string;
};

export async function clientLoader({
  request,
  params,
}: ClientLoaderFunctionArgs): Promise<AlertDetailLoaderData> {
  const alertIdParam = params?.id || "";
  const alertId = parsePositiveInt(alertIdParam);

  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.alertsRead)) {
    return {
      status: "forbidden",
      session,
      alertId: alertIdParam,
      message:
        "Your session does not include alerts:read. The API remains the access authority.",
    };
  }

  if (!Number.isFinite(alertId)) {
    return {
      status: "not_found",
      session,
      alertId: alertIdParam,
      message: "Invalid alert id.",
    };
  }

  try {
    const alert = await getAlert(alertId);
    const canUpdate = hasUiPermission(session, UI_PERMISSIONS.alertsUpdate);
    const nextStatuses = [...allowedNextAlertStatuses(alert.status)];
    return { status: "ok", session, alert, canUpdate, nextStatuses };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        alertId: alertIdParam,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view this alert.",
        ),
      };
    }
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.code === "NOT_FOUND")
    ) {
      return {
        status: "not_found",
        session,
        alertId: alertIdParam,
        message: formatApiErrorMessage(
          error,
          "Alert not found (or alerts API not mounted yet).",
        ),
      };
    }
    if (isAlertsUnavailableError(error)) {
      return {
        status: "unavailable",
        session,
        alertId: alertIdParam,
        message: formatApiErrorMessage(
          error,
          "Alert detail is not available yet. The alerts API may still be landing.",
        ),
      };
    }
    return {
      status: "error",
      session,
      alertId: alertIdParam,
      message: formatApiErrorMessage(error, "Unable to load alert."),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading alert…" />;
}

export async function clientAction({
  request,
  params,
}: ClientActionFunctionArgs) {
  const alertId = parsePositiveInt(params?.id);
  if (!Number.isFinite(alertId)) {
    return data<AlertDetailActionData>(
      { error: "Invalid alert id." },
      { status: 400 },
    );
  }

  const session = await fetchAuthSession().catch(() => null);
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.alertsUpdate)) {
    return data<AlertDetailActionData>(
      { error: "You do not have permission to update alerts (alerts:update)." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const nextStatus = parseAlertStatus(String(formData.get("status") || ""));
  if (!nextStatus) {
    return data<AlertDetailActionData>(
      { error: "Select a valid next status." },
      { status: 400 },
    );
  }

  try {
    const updated = await patchAlertStatus(alertId, nextStatus);
    return data<AlertDetailActionData>({
      success: `Status updated to ${formatAlertStatus(updated.status)}.`,
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    return data<AlertDetailActionData>(
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

export default function AlertDetailPage() {
  const loaderData = useLoaderData<AlertDetailLoaderData>();
  const actionData = useActionData<AlertDetailActionData>();
  const navigation = useNavigation();
  const isUpdating =
    navigation.state === "submitting" &&
    Boolean(navigation.formData?.get("status"));
  const [pendingStatus, setPendingStatus] = useState<AlertStatus | null>(null);
  const statusFormRefs = useRef<Map<AlertStatus, HTMLFormElement>>(new Map());

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Alert detail" description="Shortage alert detail." />
        <ForbiddenState
          title="Alerts access restricted"
          message={
            loaderData.message ||
            "You do not have permission to view alerts (alerts:read)."
          }
          detail="UI gate only — the API enforces authorization."
          action={
            <Link
              to="/alerts"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to alerts
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "unavailable") {
    return (
      <div>
        <PageHeader
          title={`Alert #${loaderData.alertId}`}
          description="GET /alerts/:id"
        />
        <EmptyState
          title="Alerts API not available yet"
          description={loaderData.message}
          action={
            <Link
              to="/alerts"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to alerts
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "not_found") {
    return (
      <div>
        <PageHeader
          title={`Alert #${loaderData.alertId}`}
          description="GET /alerts/:id"
        />
        <EmptyState
          title="Alert not found"
          description={loaderData.message}
          action={
            <Link
              to="/alerts"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to alerts
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader
          title={`Alert #${loaderData.alertId}`}
          description="GET /alerts/:id"
        />
        <ErrorState
          title="Unable to load alert"
          message={loaderData.message}
        />
        <div className="mt-3">
          <Link
            to="/alerts"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to alerts
          </Link>
        </div>
      </div>
    );
  }

  const alert = loaderData?.alert;
  if (!alert) {
    return (
      <div>
        <PageHeader title="Alert detail" />
        <EmptyState
          title="Alert not loaded"
          description="Unexpected empty loader state."
        />
      </div>
    );
  }

  const nextStatuses = loaderData.nextStatuses ?? [];
  const canUpdate = loaderData.canUpdate === true;
  const terminal = isTerminalAlertStatus(alert.status);

  return (
    <div>
      <PageHeader
        title={`Alert #${alert.id}`}
        description="Supply, predicted demand, gap, and severity are API values. Acknowledge / resolve / dismiss call the alerts API when mounted."
        actions={
          <Link
            to="/alerts"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            All alerts
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
          {actionData.success}
        </div>
      ) : null}

      <dl className="mb-8 grid gap-4 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Blood group
          </dt>
          <dd className="mt-1 text-lg font-semibold text-nbts-ink">
            {formatAlertBloodGroup(alert)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Severity
          </dt>
          <dd className="mt-1 text-lg font-semibold text-nbts-ink">
            {formatAlertSeverity(alert.severity)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Status
          </dt>
          <dd className="mt-1 text-lg font-semibold text-nbts-ink">
            {formatAlertStatus(alert.status)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Current supply
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatUnits(alert.availableUnits)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Predicted demand
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatUnits(alert.predictedUnits)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Projected gap
          </dt>
          <dd className="mt-1 text-sm font-medium text-nbts-ink">
            {formatUnits(alert.projectedGap)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Facility
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatAlertFacility(alert.facility, alert.facilityId ?? 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Prediction
          </dt>
          <dd className="mt-1 text-sm">
            <Link
              to={`/predictions/${alert.predictionId}`}
              className="font-medium text-nbts-teal underline-offset-2 hover:underline"
            >
              #{alert.predictionId}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Created
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDateTime(alert.createdAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Resolved at
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {alert.resolvedAt ? formatDateTime(alert.resolvedAt) : "—"}
          </dd>
        </div>
      </dl>

      <ProtectedUi
        session={loaderData.session}
        gate={UI_PERMISSIONS.alertsUpdate}
        fallback={
          !canUpdate ? (
            <p className="text-sm text-nbts-muted">
              Status actions require alerts:update. The API remains the
              authority.
            </p>
          ) : null
        }
      >
        <section className="rounded-lg border border-nbts-border bg-nbts-panel p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-nbts-muted">
            Update status
          </h2>
          <p className="mt-1 text-sm text-nbts-muted">
            Lifecycle: OPEN → ACKNOWLEDGED → RESOLVED / DISMISSED. Transitions
            shown are UI hints; the API may reject invalid moves.
          </p>
          {terminal || nextStatuses.length === 0 ? (
            <p className="mt-3 text-sm text-nbts-muted">
              This alert is in a terminal status ({formatAlertStatus(alert.status)}
              ).
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {nextStatuses.map((next) => (
                  <Form
                    key={next}
                    method="post"
                    ref={(element) => {
                      if (element) {
                        statusFormRefs.current.set(next, element);
                      } else {
                        statusFormRefs.current.delete(next);
                      }
                    }}
                  >
                    <input type="hidden" name="status" value={next} />
                    <Button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => {
                        if (next === "RESOLVED" || next === "DISMISSED") {
                          setPendingStatus(next);
                          return;
                        }
                        statusFormRefs.current.get(next)?.requestSubmit();
                      }}
                    >
                      {isUpdating
                        ? "Updating…"
                        : `Mark ${formatAlertStatus(next)}`}
                    </Button>
                  </Form>
                ))}
              </div>
              <ConfirmDialog
                open={pendingStatus !== null}
                title={
                  pendingStatus
                    ? `Mark alert as ${formatAlertStatus(pendingStatus)}?`
                    : "Confirm status change"
                }
                description={
                  pendingStatus
                    ? `Alert #${alert.id} will move to ${formatAlertStatus(pendingStatus)}. The API enforces allowed transitions.`
                    : "Confirm this status change."
                }
                confirmLabel={
                  pendingStatus
                    ? `Mark ${formatAlertStatus(pendingStatus)}`
                    : "Confirm"
                }
                tone="danger"
                busy={isUpdating}
                onCancel={() => setPendingStatus(null)}
                onConfirm={() => {
                  const next = pendingStatus;
                  setPendingStatus(null);
                  if (next) {
                    statusFormRefs.current.get(next)?.requestSubmit();
                  }
                }}
              />
            </>
          )}
          <p className="mt-4 text-sm text-nbts-muted">
            Donor matching and notifications start from API workflows — use{" "}
            <Link
              to={`/notifications/new?alertId=${alert.id}`}
              className="text-nbts-teal underline-offset-2 hover:underline"
            >
              Compose notification
            </Link>{" "}
            to review matches, preview, and confirm send.
          </p>
        </section>
      </ProtectedUi>
    </div>
  );
}
