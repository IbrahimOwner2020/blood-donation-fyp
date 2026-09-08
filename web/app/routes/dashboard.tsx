/**
 * /dashboard — presentation-only operational overview (docs/05 Dashboard).
 * Values come exclusively from /api/v1/dashboard/*; no client shortage math.
 */

import {
    useEffect,
    useState,
    type ReactElement,
    type ReactNode,
} from "react";
import {
    Form,
    Link,
    redirect,
    useLoaderData,
    useNavigation,
    useSearchParams,
    type ClientLoaderFunctionArgs,
    type MetaFunction,
} from "react-router";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { Button } from "~/components/ui/Button";
import {
    CHART_COLORS,
    CHART_MARGIN,
    ChartTooltipContent,
    chartAxisTick,
    chartLegendStyle,
    formatChartDateTick,
    sortBloodGroupCodes,
} from "~/components/ui/chart";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { Input } from "~/components/ui/Input";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { Select } from "~/components/ui/Select";
import { Table, TBody, THead, Td, Th, Tr } from "~/components/ui/Table";
import {
    UI_PERMISSIONS,
    fetchAuthSession,
    hasUiPermission,
    type AuthSession,
} from "~/lib/auth";
import { BLOOD_GROUP_OPTIONS } from "~/lib/donors";
import {
    fetchDashboardAlerts,
    fetchDashboardPredictions,
    fetchDashboardSummary,
    fetchDemandTrend,
    fetchDonationTrend,
    fetchInventoryTrend,
    formatAlertBloodGroup,
    formatAlertFacility,
    formatAlertSeverity,
    formatAlertStatus,
    formatDashboardCount,
    formatInventoryGroupLabel,
    formatUnits,
    isValidDateOnly,
    type DashboardAlerts,
    type DashboardInventoryGroup,
    type DashboardPredictions,
    type DashboardSectionStatus,
    type DashboardSummary,
    type DashboardTrend,
} from "~/lib/dashboard";

export const meta: MetaFunction = () => [
    { title: "Dashboard · NBTS Blood AI" },
];

type DashboardFilters = {
    from: string;
    to: string;
    bloodGroup: string;
};

type DashboardLoaderData =
    | {
        status: "ok";
        session: AuthSession;
        filters: DashboardFilters;
        summary: DashboardSectionStatus<DashboardSummary>;
        inventoryTrend: DashboardSectionStatus<DashboardTrend>;
        donationTrend: DashboardSectionStatus<DashboardTrend>;
        demandTrend: DashboardSectionStatus<DashboardTrend>;
        predictions: DashboardSectionStatus<DashboardPredictions>;
        alerts: DashboardSectionStatus<DashboardAlerts>;
    }
    | {
        status: "forbidden";
        session: AuthSession;
        message?: string;
        filters: DashboardFilters;
    }
    | {
        status: "error";
        session: AuthSession;
        message: string;
        filters: DashboardFilters;
    };

function parseFilters(url: URL): DashboardFilters {
    const bloodGroupRaw = (url.searchParams.get("bloodGroup") || "").trim();
    const bloodGroup = BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroupRaw)
        ? bloodGroupRaw
        : "";
    const fromRaw = (url.searchParams.get("from") || "").trim();
    const toRaw = (url.searchParams.get("to") || "").trim();
    const from = isValidDateOnly(fromRaw) ? fromRaw : "";
    const to = isValidDateOnly(toRaw) ? toRaw : "";
    return { from, to, bloodGroup };
}

export async function clientLoader({
    request,
}: ClientLoaderFunctionArgs): Promise<DashboardLoaderData> {
    const url = new URL(request.url);
    const filters = parseFilters(url);

    const session = await fetchAuthSession();
    if (!session) {
        const next = `${url.pathname}${url.search}`;
        throw redirect(`/login?next=${encodeURIComponent(next)}`);
    }

    if (!hasUiPermission(session, UI_PERMISSIONS.reportsRead)) {
        return {
            status: "forbidden",
            session,
            message:
                "Your session does not include reports:read. The API remains the access authority.",
            filters,
        };
    }

    const params = {
        from: filters.from || undefined,
        to: filters.to || undefined,
        bloodGroup: filters.bloodGroup || undefined,
    };

    try {
        const [
            summary,
            inventoryTrend,
            donationTrend,
            demandTrend,
            predictions,
            alerts,
        ] = await Promise.all([
            fetchDashboardSummary(params),
            fetchInventoryTrend(params),
            fetchDonationTrend(params),
            fetchDemandTrend(params),
            fetchDashboardPredictions(params),
            fetchDashboardAlerts(params),
        ]);

        if (summary.status === "forbidden") {
            return {
                status: "forbidden",
                session,
                message:
                    summary.message ||
                    "Your session does not include reports:read. The API remains the access authority.",
                filters,
            };
        }

        return {
            status: "ok",
            session,
            filters,
            summary,
            inventoryTrend,
            donationTrend,
            demandTrend,
            predictions,
            alerts,
        };
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Unable to load dashboard from the API.";
        return {
            status: "error",
            session,
            message,
            filters,
        };
    }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
    return <LoadingState label="Loading dashboard…" />;
}

function SectionShell({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <section className="mb-5 min-w-0 rounded-lg border border-nbts-border bg-nbts-panel p-3 sm:mb-6 sm:p-5">
            <div className="mb-4 border-b border-nbts-border pb-3">
                <h2 className="text-lg font-semibold text-nbts-ink">{title}</h2>
                {description ? (
                    <p className="mt-1 text-sm text-nbts-muted">{description}</p>
                ) : null}
            </div>
            {children}
        </section>
    );
}

function ClientChartShell({
    height = 300,
    children,
}: {
    height?: number;
    children: ReactElement;
}) {
    const [ready, setReady] = useState(false);
    const chartHeight = `clamp(220px, 52vw, ${height}px)`;

    useEffect(() => {
        setReady(true);
    }, []);

    if (!ready) {
        return (
            <div
                className="flex min-w-0 items-center justify-center rounded-md bg-nbts-surface/60 text-sm text-nbts-muted"
                style={{ height: chartHeight, minHeight: 220 }}
            >
                Preparing chart…
            </div>
        );
    }

    return (
        <div
            className="w-full min-w-0 overflow-hidden"
            style={{ width: "100%", height: chartHeight, minHeight: 220 }}
        >
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
                {children}
            </ResponsiveContainer>
        </div>
    );
}

function renderSection<T>(
    section: DashboardSectionStatus<T>,
    renderOk: (data: T) => ReactNode,
    emptyTitle = "No data",
) {
    if (section.status === "forbidden") {
        return (
            <ForbiddenState
                title="Section restricted"
                message={
                    section.message || "reports:read is required for this section."
                }
            />
        );
    }
    if (section.status === "error") {
        return (
            <ErrorState title="Section failed to load" message={section.message} />
        );
    }
    if (section.status === "empty") {
        return (
            <EmptyState
                title={emptyTitle}
                description={section.message || "No values returned by the API."}
            />
        );
    }
    return renderOk(section.data);
}

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

function KpiCards({ summary }: { summary: DashboardSummary }) {
    const kpis = summary.kpis;
    const cards = [
        {
            label: "Total available units",
            value: formatDashboardCount(kpis.availableUnits),
            hint: summary.asOf ? `As of ${summary.asOf}` : "API snapshot",
        },
        {
            label: "Low-stock groups",
            value: formatDashboardCount(kpis.lowStockGroupCount),
            hint:
                typeof summary.lowStockThreshold === "number"
                    ? `Threshold ≤ ${summary.lowStockThreshold}`
                    : "API threshold",
        },
        {
            label: "Active alerts",
            value: formatDashboardCount(kpis.activeAlerts),
            hint: "Open / acknowledged",
        },
        {
            label: "Donations this period",
            value: formatDashboardCount(kpis.donationsThisPeriod),
            hint: `${formatDashboardCount(kpis.donationUnitsThisPeriod)} units`,
        },
        {
            label: "Notifications sent",
            value: formatDashboardCount(kpis.notificationsSentThisPeriod),
            hint:
                summary.period.from && summary.period.to
                    ? `${summary.period.from} → ${summary.period.to}`
                    : "Selected period",
        },
    ];

    return (
        <div className="mb-5 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {cards.map((card) => (
                <div
                    key={card.label}
                    className="min-w-0 rounded-lg border border-nbts-border bg-nbts-panel px-4 py-3"
                >
                    <p className="text-xs font-medium uppercase tracking-wide text-nbts-muted">
                        {card.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-nbts-ink sm:text-3xl xl:text-2xl">
                        {card.value}
                    </p>
                    <p className="mt-1 text-xs text-nbts-muted">{card.hint}</p>
                </div>
            ))}
        </div>
    );
}

function InventoryDistributionChart({
    groups,
}: {
    groups: DashboardInventoryGroup[];
}) {
    if (!groups.length) {
        return (
            <EmptyState
                title="No inventory distribution"
                description="The API returned no blood-group inventory rows for this period."
            />
        );
    }

    const data = sortBloodGroupCodes(
        groups.map((group) => formatInventoryGroupLabel(group)),
    )
        .map((name) => {
            const group = groups.find(
                (row) => formatInventoryGroupLabel(row) === name,
            );
            if (!group) {
                return null;
            }
            return {
                name,
                available: group.availableUnits,
                reserved: group.reservedUnits,
                lowStock: group.lowStock,
            };
        })
        .filter(
            (
                row,
            ): row is {
                name: string;
                available: number;
                reserved: number;
                lowStock: boolean;
            } => row !== null,
        );

    return (
        <ClientChartShell>
            <BarChart data={data} margin={CHART_MARGIN} barCategoryGap="18%">
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_COLORS.grid}
                    vertical={false}
                />
                <XAxis
                    dataKey="name"
                    tick={chartAxisTick}
                    axisLine={{ stroke: CHART_COLORS.border }}
                    tickLine={false}
                    interval={0}
                />
                <YAxis
                    allowDecimals={false}
                    width={40}
                    tick={chartAxisTick}
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip
                    cursor={{ fill: "rgba(15, 28, 46, 0.04)" }}
                    content={<ChartTooltipContent />}
                />
                <Legend wrapperStyle={chartLegendStyle} />
                <Bar
                    dataKey="available"
                    name="Available"
                    fill={CHART_COLORS.available}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={36}
                />
                <Bar
                    dataKey="reserved"
                    name="Reserved"
                    fill={CHART_COLORS.reserved}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={36}
                />
            </BarChart>
        </ClientChartShell>
    );
}

function TrendLineChart({
    trend,
    label,
    color,
}: {
    trend: DashboardTrend;
    label: string;
    color: string;
}) {
    if (!trend.points.length) {
        return (
            <EmptyState
                title={`No ${label.toLowerCase()} points`}
                description="The API returned an empty series for this period."
            />
        );
    }

    return (
        <div>
            <p className="mb-2 text-sm text-nbts-muted">
                Total units (API): {formatDashboardCount(trend.totalUnits)}
                {trend.period.from && trend.period.to
                    ? ` · ${trend.period.from} → ${trend.period.to}`
                    : ""}
            </p>
            <ClientChartShell>
                <LineChart data={trend.points} margin={CHART_MARGIN}>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART_COLORS.grid}
                        vertical={false}
                    />
                    <XAxis
                        dataKey="date"
                        tick={chartAxisTick}
                        tickFormatter={formatChartDateTick}
                        minTickGap={28}
                        axisLine={{ stroke: CHART_COLORS.border }}
                        tickLine={false}
                    />
                    <YAxis
                        allowDecimals={false}
                        width={40}
                        tick={chartAxisTick}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        content={
                            <ChartTooltipContent labelFormatter={formatChartDateTick} />
                        }
                    />
                    <Legend wrapperStyle={chartLegendStyle} />
                    <Line
                        type="monotone"
                        dataKey="units"
                        name={label}
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ClientChartShell>
        </div>
    );
}

function SupplyVsPredictedChart({
    summary,
    predictions,
}: {
    summary: DashboardSummary;
    predictions: DashboardPredictions;
}) {
    const availableByGroup = new Map<string, number>();
    for (const group of summary.inventoryByBloodGroup ?? []) {
        const key = formatInventoryGroupLabel(group);
        if (key !== "—") {
            availableByGroup.set(key, group.availableUnits);
        }
    }

    const predictedByGroup = new Map<string, number>();
    for (const prediction of predictions.predictions ?? []) {
        const key =
            prediction.bloodGroup?.code?.trim() ||
            BLOOD_GROUP_OPTIONS.find((g) => g.id === prediction.bloodGroupId)?.code ||
            "";
        if (!key) {
            continue;
        }
        predictedByGroup.set(key, prediction.predictedUnits);
    }

    const names = sortBloodGroupCodes(
        Array.from(
            new Set([...availableByGroup.keys(), ...predictedByGroup.keys()]),
        ),
    );

    if (!names.length) {
        return (
            <EmptyState
                title="No supply / forecast rows"
                description="Need inventory distribution and prediction snapshot values from the API."
            />
        );
    }

    const data = names.map((name) => ({
        name,
        available: availableByGroup.get(name) ?? 0,
        predicted: predictedByGroup.get(name) ?? 0,
    }));

    return (
        <ClientChartShell height={320}>
            <BarChart data={data} margin={CHART_MARGIN} barCategoryGap="16%">
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_COLORS.grid}
                    vertical={false}
                />
                <XAxis
                    dataKey="name"
                    tick={chartAxisTick}
                    axisLine={{ stroke: CHART_COLORS.border }}
                    tickLine={false}
                    interval={0}
                />
                <YAxis
                    allowDecimals={false}
                    width={40}
                    tick={chartAxisTick}
                    axisLine={false}
                    tickLine={false}
                />
                <Tooltip
                    cursor={{ fill: "rgba(15, 28, 46, 0.04)" }}
                    content={<ChartTooltipContent />}
                />
                <Legend wrapperStyle={chartLegendStyle} />
                <Bar
                    dataKey="available"
                    name="Available supply (API)"
                    fill={CHART_COLORS.available}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={32}
                />
                <Bar
                    dataKey="predicted"
                    name="Predicted demand (API)"
                    fill={CHART_COLORS.predicted}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={32}
                />
            </BarChart>
        </ClientChartShell>
    );
}

function PredictionsSnapshot({ data }: { data: DashboardPredictions }) {
    const predictions = data.predictions ?? [];
    if (!predictions.length) {
        return (
            <EmptyState
                title="No predictions yet"
                description="Latest-per-group forecast rows will appear when the API returns them."
            />
        );
    }

    const rows = predictions.map((prediction) => {
        const code =
            prediction.bloodGroup?.code?.trim() ||
            BLOOD_GROUP_OPTIONS.find((g) => g.id === prediction.bloodGroupId)
                ?.code ||
            "—";
        const facility =
            prediction.facility?.name?.trim() ||
            (prediction.facilityId ? `Facility #${prediction.facilityId}` : "—");
        const horizon =
            prediction.forecastStart && prediction.forecastEnd
                ? `${prediction.forecastStart} → ${prediction.forecastEnd}`
                : "—";
        const model = `${prediction.modelName || "—"}${
            prediction.modelVersion ? ` (${prediction.modelVersion})` : ""
        }`;
        const created = prediction.createdAt
            ? new Date(prediction.createdAt).toLocaleString()
            : "—";
        return { prediction, code, facility, horizon, model, created };
    });

    return (
        <>
            <div className="hidden md:block">
                <Table caption="Latest predictions by blood group">
                    <THead>
                        <Tr className="border-b border-nbts-border">
                            <Th>Blood group</Th>
                            <Th>Facility</Th>
                            <Th>Horizon</Th>
                            <Th>Predicted units</Th>
                            <Th>Model</Th>
                            <Th>Created</Th>
                        </Tr>
                    </THead>
                    <TBody>
                        {rows.map(({ prediction, code, facility, horizon, model, created }) => (
                            <Tr key={prediction.id}>
                                <Td>
                                    <Link
                                        to={`/predictions/${prediction.id}`}
                                        className="font-medium text-nbts-teal hover:underline"
                                    >
                                        {code}
                                    </Link>
                                </Td>
                                <Td>{facility}</Td>
                                <Td>{horizon}</Td>
                                <Td>{formatUnits(prediction.predictedUnits)}</Td>
                                <Td>{model}</Td>
                                <Td>{created}</Td>
                            </Tr>
                        ))}
                    </TBody>
                </Table>
            </div>
            <div className="grid gap-3 md:hidden">
                {rows.map(({ prediction, code, facility, horizon, model, created }) => (
                    <article
                        key={prediction.id}
                        className="rounded-lg border border-nbts-border bg-white p-3"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <Link
                                to={`/predictions/${prediction.id}`}
                                className="text-base font-semibold text-nbts-teal hover:underline"
                            >
                                {code}
                            </Link>
                            <span className="shrink-0 text-sm font-medium text-nbts-ink">
                                {formatUnits(prediction.predictedUnits)}
                            </span>
                        </div>
                        <dl className="mt-3 grid gap-2 text-sm">
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-nbts-muted">
                                    Facility
                                </dt>
                                <dd>{facility}</dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-nbts-muted">
                                    Horizon
                                </dt>
                                <dd>{horizon}</dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-nbts-muted">
                                    Model
                                </dt>
                                <dd className="break-words">{model}</dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-nbts-muted">
                                    Created
                                </dt>
                                <dd>{created}</dd>
                            </div>
                        </dl>
                    </article>
                ))}
            </div>
        </>
    );
}

function AlertsTable({ data }: { data: DashboardAlerts }) {
    const alerts = data.alerts ?? [];
    if (!alerts.length) {
        return (
            <EmptyState
                title="No recent alerts"
                description={
                    data.activeOnly
                        ? "No active shortage alerts were returned for this view."
                        : "No alerts were returned for this view."
                }
                action={
                    <Link
                        to="/alerts"
                        className="text-sm font-medium text-nbts-teal hover:underline"
                    >
                        Open alerts
                    </Link>
                }
            />
        );
    }

    return (
        <div>
            <p className="mb-3 text-sm text-nbts-muted">
                Showing {alerts.length}
                {typeof data.total === "number" ? ` of ${data.total}` : ""} alert
                {alerts.length === 1 ? "" : "s"}
                {data.activeOnly ? " (active only)" : ""}.
            </p>
            <div className="hidden md:block">
                <Table caption="Recent shortage alerts">
                    <THead>
                        <Tr className="border-b border-nbts-border">
                            <Th>Blood group</Th>
                            <Th>Facility</Th>
                            <Th>Supply</Th>
                            <Th>Predicted</Th>
                            <Th>Gap</Th>
                            <Th>Severity</Th>
                            <Th>Status</Th>
                        </Tr>
                    </THead>
                    <TBody>
                        {alerts.map((alert) => (
                            <Tr key={alert.id}>
                                <Td>
                                    <Link
                                        to={`/alerts/${alert.id}`}
                                        className="font-medium text-nbts-teal hover:underline"
                                    >
                                        {formatAlertBloodGroup(alert)}
                                    </Link>
                                </Td>
                                <Td>
                                    {formatAlertFacility(alert.facility, alert.facilityId ?? 0)}
                                </Td>
                                <Td>{formatUnits(alert.availableUnits)}</Td>
                                <Td>{formatUnits(alert.predictedUnits)}</Td>
                                <Td>{formatUnits(alert.projectedGap)}</Td>
                                <Td className={severityToneClass(alert.severity)}>
                                    {formatAlertSeverity(alert.severity)}
                                </Td>
                                <Td className={statusToneClass(alert.status)}>
                                    {formatAlertStatus(alert.status)}
                                </Td>
                            </Tr>
                        ))}
                    </TBody>
                </Table>
            </div>
            <div className="grid gap-3 md:hidden">
                {alerts.map((alert) => (
                    <article
                        key={alert.id}
                        className="rounded-lg border border-nbts-border bg-white p-3"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <Link
                                to={`/alerts/${alert.id}`}
                                className="text-base font-semibold text-nbts-teal hover:underline"
                            >
                                {formatAlertBloodGroup(alert)}
                            </Link>
                            <span className={severityToneClass(alert.severity)}>
                                {formatAlertSeverity(alert.severity)}
                            </span>
                        </div>
                        <p className="mt-1 text-sm text-nbts-muted">
                            {formatAlertFacility(alert.facility, alert.facilityId ?? 0)}
                        </p>
                        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-nbts-muted">
                                    Supply
                                </dt>
                                <dd>{formatUnits(alert.availableUnits)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-nbts-muted">
                                    Predicted
                                </dt>
                                <dd>{formatUnits(alert.predictedUnits)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs uppercase tracking-wide text-nbts-muted">
                                    Gap
                                </dt>
                                <dd>{formatUnits(alert.projectedGap)}</dd>
                            </div>
                        </dl>
                        <p className={`mt-3 text-sm ${statusToneClass(alert.status)}`}>
                            {formatAlertStatus(alert.status)}
                        </p>
                    </article>
                ))}
            </div>
            <div className="mt-3">
                <Link
                    to="/alerts"
                    className="text-sm font-medium text-nbts-teal hover:underline"
                >
                    View all alerts
                </Link>
            </div>
        </div>
    );
}

export default function DashboardPage() {
    const data = useLoaderData<DashboardLoaderData>();
    const navigation = useNavigation();
    const [searchParams] = useSearchParams();
    const isFiltering = navigation.state === "loading";

    if (data?.status === "forbidden") {
        return (
            <div>
                <PageHeader
                    title="Dashboard"
                    description="Operational overview from the dashboard API."
                />
                <ForbiddenState
                    title="Dashboard access denied"
                    message={
                        data.message ||
                        "Your account needs reports:read to view this page."
                    }
                />
            </div>
        );
    }

    if (data?.status === "error") {
        return (
            <div>
                <PageHeader
                    title="Dashboard"
                    description="Operational overview from the dashboard API."
                />
                <ErrorState title="Unable to load dashboard" message={data.message} />
            </div>
        );
    }

    const filters = data?.filters ?? {
        from: searchParams.get("from") || "",
        to: searchParams.get("to") || "",
        bloodGroup: searchParams.get("bloodGroup") || "",
    };

    const summaryOk =
        data?.summary?.status === "ok" ? data.summary.data : null;
    const predictionsOk =
        data?.predictions?.status === "ok" ? data.predictions.data : null;

    return (
        <div>
            <PageHeader
                title="Dashboard"
                description="KPI cards, trends, prediction snapshot, and recent alerts — all values from the API."
            />

            <Form
                method="get"
                className="mb-5 grid gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(8rem,0.8fr)_auto] lg:items-end"
            >
                <Input
                    type="date"
                    name="from"
                    label="From"
                    labelClassName="text-nbts-muted font-normal"
                    defaultValue={filters.from}
                    wrapperClassName="min-w-0"
                />
                <Input
                    type="date"
                    name="to"
                    label="To"
                    labelClassName="text-nbts-muted font-normal"
                    defaultValue={filters.to}
                    wrapperClassName="min-w-0"
                />
                <Select
                    name="bloodGroup"
                    label="Blood group"
                    defaultValue={filters.bloodGroup}
                    wrapperClassName="min-w-0"
                >
                    <option value="">All</option>
                    {BLOOD_GROUP_OPTIONS.map((group) => (
                        <option key={group.code} value={group.code}>
                            {group.code}
                        </option>
                    ))}
                </Select>
                <Button type="submit" disabled={isFiltering} className="w-full lg:w-auto">
                    {isFiltering ? "Updating…" : "Apply"}
                </Button>
            </Form>

            {isFiltering ? <LoadingState label="Refreshing dashboard…" /> : null}

            {!isFiltering && data?.summary
                ? renderSection(
                    data.summary,
                    (summary) => <KpiCards summary={summary} />,
                    "No KPI summary",
                )
                : null}

            {!isFiltering && data?.summary ? (
                <SectionShell
                    title="Blood-group inventory"
                    description="Available and reserved units by blood group from the summary payload."
                >
                    {renderSection(
                        data.summary,
                        (summary) => (
                            <InventoryDistributionChart
                                groups={summary.inventoryByBloodGroup ?? []}
                            />
                        ),
                        "No inventory distribution",
                    )}
                </SectionShell>
            ) : null}

            {!isFiltering && data ? (
                <div className="grid min-w-0 gap-0 lg:grid-cols-2 lg:gap-6">
                    <SectionShell
                        title="Donation trend"
                        description="Donated units per day from GET /dashboard/donation-trend."
                    >
                        {renderSection(
                            data.donationTrend,
                            (trend) => (
                                <TrendLineChart
                                    trend={trend}
                                    label="Donations"
                                    color={CHART_COLORS.donations}
                                />
                            ),
                            "No donation trend",
                        )}
                    </SectionShell>

                    <SectionShell
                        title="Demand trend"
                        description="Requested demand units per day from GET /dashboard/demand-trend."
                    >
                        {renderSection(
                            data.demandTrend,
                            (trend) => (
                                <TrendLineChart
                                    trend={trend}
                                    label="Demand"
                                    color={CHART_COLORS.demand}
                                />
                            ),
                            "No demand trend",
                        )}
                    </SectionShell>
                </div>
            ) : null}

            {!isFiltering && data ? (
                <SectionShell
                    title="Inventory collection trend"
                    description="Units collected per day from GET /dashboard/inventory-trend."
                >
                    {renderSection(
                        data.inventoryTrend,
                        (trend) => (
                            <TrendLineChart
                                trend={trend}
                                label="Collected"
                                color={CHART_COLORS.collected}
                            />
                        ),
                        "No inventory trend",
                    )}
                </SectionShell>
            ) : null}

            {!isFiltering && summaryOk && predictionsOk ? (
                <SectionShell
                    title="Supply vs predicted demand"
                    description="Side-by-side API values only — available units from summary and predicted units from the prediction snapshot."
                >
                    <SupplyVsPredictedChart
                        summary={summaryOk}
                        predictions={predictionsOk}
                    />
                </SectionShell>
            ) : null}

            {!isFiltering && data ? (
                <SectionShell
                    title="Predictions snapshot"
                    description="Latest prediction per blood group from GET /dashboard/predictions."
                >
                    {renderSection(
                        data.predictions,
                        (payload) => <PredictionsSnapshot data={payload} />,
                        "No predictions",
                    )}
                </SectionShell>
            ) : null}

            {!isFiltering && data ? (
                <SectionShell
                    title="Recent alerts"
                    description="Shortage alerts from GET /dashboard/alerts. Gap and severity are API values."
                >
                    {renderSection(
                        data.alerts,
                        (payload) => <AlertsTable data={payload} />,
                        "No alerts",
                    )}
                </SectionShell>
            ) : null}
        </div>
    );
}
