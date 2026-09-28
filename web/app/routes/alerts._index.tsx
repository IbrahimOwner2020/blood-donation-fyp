/**
 * /alerts — read-only shortage alert list (docs/04 alerts/, docs/10).
 * Acknowledge/recalculate stay on the API; managers monitor here.
 */

import {
    redirect,
    useLoaderData,
    type ClientLoaderFunctionArgs,
    type MetaFunction,
} from "react-router";

import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { ApiRequestError } from "~/lib/api";
import {
    formatAlertSeverity,
    formatAlertStatus,
    formatApiErrorMessage,
    listAlerts,
    type PublicAlert,
} from "~/lib/alerts";
import {
    UI_PERMISSIONS,
    fetchAuthSession,
    hasUiPermission,
    type AuthSession,
} from "~/lib/auth";

export const meta: MetaFunction = () => [
    { title: "Alerts · Blood Donation Management System" },
];

type LoaderData =
    | {
        status: "ok";
        session: AuthSession;
        alerts: PublicAlert[];
        total: number;
    }
    | { status: "forbidden" }
    | { status: "unauthenticated" }
    | { status: "error"; message: string };

export async function clientLoader({
    request,
}: ClientLoaderFunctionArgs): Promise<LoaderData> {
    const session = await fetchAuthSession().catch(() => null);
    if (!session) {
        const url = new URL(request.url);
        throw redirect(
            `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
        );
    }
    if (!hasUiPermission(session, UI_PERMISSIONS.alertsRead)) {
        return { status: "forbidden" };
    }

    try {
        const result = await listAlerts({ limit: 50, activeOnly: true });
        return {
            status: "ok",
            session,
            alerts: result.alerts ?? [],
            total: result.total ?? 0,
        };
    } catch (error) {
        if (error instanceof ApiRequestError && error.status === 403) {
            return { status: "forbidden" };
        }
        return {
            status: "error",
            message: formatApiErrorMessage(error, "Unable to load alerts."),
        };
    }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
    return <LoadingState label="Loading alerts…" />;
}

export default function AlertsIndexPage() {
    const data = useLoaderData<LoaderData>();

    if (data?.status === "forbidden") {
        return (
            <div>
                <PageHeader title="Alerts" />
                <ForbiddenState
                    title="Alerts unavailable"
                    message="You do not have permission to view shortage alerts. Contact an administrator if you need access."
                />
            </div>
        );
    }

    if (data?.status === "error") {
        return (
            <div>
                <PageHeader title="Alerts" />
                <ErrorState title="Could not load alerts" message={data.message} />
            </div>
        );
    }

    if (data?.status !== "ok") {
        return <LoadingState label="Loading alerts…" />;
    }

    const alerts = data.alerts ?? [];

    return (
        <div>
            <PageHeader
                title="Shortage alerts"
                description="List of open shortage alerts."
            />

            {alerts.length === 0 ? (
                <EmptyState
                    title="No active alerts"
                    description="Open shortage alerts appear here."
                />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-nbts-border bg-white">
                    <table className="min-w-full text-left text-sm">
                        <thead className="border-b border-nbts-border bg-nbts-panel text-xs uppercase tracking-wide text-nbts-muted">
                            <tr>
                                <th className="px-4 py-3 font-medium">Alert</th>
                                <th className="px-4 py-3 font-medium">Gap</th>
                                <th className="px-4 py-3 font-medium">Severity</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {alerts.map((alert) => {
                                const group =
                                    alert.bloodGroup?.code ?? `#${alert.bloodGroupId}`;
                                const facility =
                                    alert.facility?.name ??
                                    (alert.facilityId != null
                                        ? `Facility #${alert.facilityId}`
                                        : "National");
                                return (
                                    <tr
                                        key={alert.id}
                                        className="border-b border-nbts-border last:border-0"
                                    >
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-nbts-ink">
                                                {group} · {facility}
                                            </p>
                                            <p className="text-xs text-nbts-muted">
                                                #{alert.id} · {group}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 text-nbts-ink">
                                            {alert.projectedGap} (avail {alert.availableUnits} / pred{" "}
                                            {alert.predictedUnits})
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-nbts-ink">
                                            {formatAlertSeverity(alert.severity)}
                                        </td>
                                        <td className="px-4 py-3 text-nbts-muted">
                                            {formatAlertStatus(alert.status)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="border-t border-nbts-border px-4 py-2 text-xs text-nbts-muted">
                        Showing {alerts.length} of {data.total} alerts.
                    </p>
                </div>
            )}
        </div>
    );
}
