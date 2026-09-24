/**
 * /reports — presentation-only operational reports (docs/05, docs/04 Reports).
 * Values come exclusively from /api/v1/reports/*; missing sections stay empty.
 */

import {
  Form,
  redirect,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import type { ReactNode } from "react";

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
import { BLOOD_GROUP_OPTIONS } from "~/lib/donors";
import {
  fetchBloodRequestsReport,
  fetchDonorEligibilityReport,
  fetchDonationsReport,
  fetchInventoryReport,
  fetchNotificationsReport,
  formatBloodGroupLabel,
  formatCount,
  isValidDateOnly,
  type BloodRequestsReport,
  type DonorEligibilityReport,
  type DonationsReport,
  type InventoryReport,
  type NotificationsReport,
  type ReportSectionStatus,
} from "~/lib/reports";

export const meta: MetaFunction = () => [
  { title: "Reports · Blood Donation Management System" },
];

type ReportFilters = {
  from: string;
  to: string;
  bloodGroup: string;
};

type ReportsLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      filters: ReportFilters;
      inventory: ReportSectionStatus<InventoryReport>;
      donations: ReportSectionStatus<DonationsReport>;
      bloodRequests: ReportSectionStatus<BloodRequestsReport>;
      donorEligibility: ReportSectionStatus<DonorEligibilityReport>;
      notifications: ReportSectionStatus<NotificationsReport>;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      filters: ReportFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      filters: ReportFilters;
    };

function parseFilters(url: URL): ReportFilters {
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
}: ClientLoaderFunctionArgs): Promise<ReportsLoaderData> {
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
        "Your account does not have access to operational reports.",
      filters,
    };
  }

  const params = {
    from: filters.from || undefined,
    to: filters.to || undefined,
    bloodGroup: filters.bloodGroup || undefined,
  };

  try {
    const [donorEligibility, donations, inventory, bloodRequests, notifications] =
      await Promise.all([
        fetchDonorEligibilityReport(params),
        fetchDonationsReport(params),
        fetchInventoryReport(params),
        fetchBloodRequestsReport(params),
        fetchNotificationsReport(params),
      ]);

    return {
      status: "ok",
      session,
      filters,
      inventory,
      donations,
      bloodRequests,
      donorEligibility,
      notifications,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load reports from the system.";
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
  return <LoadingState label="Loading reports…" />;
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
    <section className="mb-8 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:p-5">
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

function SectionUnavailable({
  message = "No data for this report.",
}: {
  message?: string;
}) {
  return (
    <EmptyState title="No report data" description={message} />
  );
}

function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-md border border-nbts-border bg-nbts-surface px-3 py-2"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-nbts-muted">
            {item.label}
          </p>
          <p className="mt-1 text-xl font-semibold text-nbts-ink">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
  emptyLabel,
}: {
  headers: string[];
  rows: string[][];
  emptyLabel: string;
}) {
  if (!rows.length) {
    return (
      <p className="text-sm text-nbts-muted">{emptyLabel}</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-nbts-border text-xs uppercase tracking-wide text-nbts-muted">
            {headers.map((h) => (
              <th key={h} className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={`${row[0] ?? "row"}-${idx}`}
              className="border-b border-nbts-border/60 text-nbts-ink"
            >
              {row.map((cell, cellIdx) => (
                <td key={`${idx}-${cellIdx}`} className="px-2 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderSection<T>(
  section: ReportSectionStatus<T>,
  renderOk: (data: T) => ReactNode,
) {
  if (section.status === "forbidden") {
    return (
      <ForbiddenState
        title="Report restricted"
        message={
          section.message ||
          "reports:read is required for this section."
        }
      />
    );
  }
  if (section.status === "error") {
    return (
      <ErrorState
        title="Report failed to load"
        message={section.message}
      />
    );
  }
  if (section.status === "empty") {
    return <SectionUnavailable message={section.message} />;
  }
  return renderOk(section.data);
}

export default function ReportsPage() {
  const data = useLoaderData<ReportsLoaderData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering = navigation.state === "loading";

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Reports"
          description="Donor operations, donations, inventory, blood requests, and notification reports."
        />
        <ForbiddenState
          title="Reports access denied"
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
          title="Reports"
          description="Donor operations, donations, inventory, blood requests, and notification reports."
        />
        <ErrorState title="Unable to load reports" message={data.message} />
      </div>
    );
  }

  const filters = data?.filters ?? {
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    bloodGroup: searchParams.get("bloodGroup") || "",
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Printable operational reports. Filters apply where date or blood-group scope is supported."
        actions={<button type="button" onClick={() => window.print()} className="print:hidden rounded-md bg-nbts-blood px-4 py-2 text-sm font-semibold text-white">Print or save as PDF</button>}
      />

      <div className="print-report-header hidden print:block">
        <h1>Blood Donation Management System</h1>
        <h2>Combined operational report</h2>
        <p>Period: {filters.from || "All dates"} to {filters.to || "Present"} · Blood group: {filters.bloodGroup || "All"}</p>
        <p>Generated: {new Date().toLocaleString()} · User: {data?.status === "ok" ? data.session.displayName : "—"}</p>
      </div>

      <Form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-nbts-muted">From</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="rounded-md border border-nbts-border bg-nbts-surface px-3 py-2 text-nbts-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-nbts-muted">To</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="rounded-md border border-nbts-border bg-nbts-surface px-3 py-2 text-nbts-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-nbts-muted">Blood group</span>
          <select
            name="bloodGroup"
            defaultValue={filters.bloodGroup}
            className="rounded-md border border-nbts-border bg-nbts-surface px-3 py-2 text-nbts-ink"
          >
            <option value="">All</option>
            {BLOOD_GROUP_OPTIONS.map((g) => (
              <option key={g.code} value={g.code}>
                {g.code}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-nbts-teal px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          disabled={isFiltering}
        >
          {isFiltering ? "Applying…" : "Apply filters"}
        </button>
      </Form>

      {isFiltering ? <LoadingState label="Refreshing reports…" /> : null}

      {data?.status === "ok" ? (
        <>
          <SectionShell
            title="Donor eligibility"
            description="Preliminary eligibility for outreach and scheduling; medical screening is still required."
          >
            {renderSection(data.donorEligibility, (report) => (
              <>
                <MetricStrip items={[
                  { label: "Donors", value: formatCount(report.totals.total) },
                  { label: "Eligible", value: formatCount(report.totals.eligible) },
                  { label: "Waiting", value: formatCount(report.totals.waitingPeriod) },
                  { label: "Incomplete profiles", value: formatCount(report.totals.profileIncomplete) },
                ]} />
                <SimpleTable
                  headers={["Membership", "Donor", "Blood group", "Donations", "Last donation", "Next eligible", "Status"]}
                  rows={report.donors.map((donor) => [donor.donorNumber, donor.name, formatBloodGroupLabel(donor.bloodGroup), formatCount(donor.donationCount), donor.lastDonationDate || "—", donor.nextEligibleDate || "Now", donor.status.replaceAll("_", " ")])}
                  emptyLabel="No donors for the selected filters."
                />
              </>
            ))}
          </SectionShell>

          <SectionShell
            title="Inventory"
            description="Point-in-time stock by blood group (as of filter end date when provided)."
          >
            {renderSection(data.inventory, (report) => (
              <>
                <MetricStrip
                  items={[
                    {
                      label: "As of",
                      value: report.asOf || "—",
                    },
                    {
                      label: "Available",
                      value: formatCount(report.totals.availableUnits),
                    },
                    {
                      label: "Expiring soon",
                      value: formatCount(report.totals.expiringSoonUnits),
                    },
                    {
                      label: "Low-stock groups",
                      value: formatCount(report.totals.lowStockGroupCount),
                    },
                  ]}
                />
                <SimpleTable
                  headers={[
                    "Blood group",
                    "Available",
                    "Reserved",
                    "Expiring",
                    "Expired",
                    "Low stock",
                  ]}
                  rows={report.groups.map((g) => [
                    formatBloodGroupLabel(g.bloodGroup),
                    formatCount(g.availableUnits),
                    formatCount(g.reservedUnits),
                    formatCount(g.expiringSoonUnits),
                    formatCount(g.expiredUnits),
                    g.lowStock ? "Yes" : "No",
                  ])}
                  emptyLabel="No inventory rows for the selected filters."
                />
              </>
            ))}
          </SectionShell>

          <SectionShell
            title="Donations"
            description="Donation counts and units by blood group and date."
          >
            {renderSection(data.donations, (report) => (
              <>
                <MetricStrip
                  items={[
                    {
                      label: "Donations",
                      value: formatCount(report.totals.donationCount),
                    },
                    {
                      label: "Units",
                      value: formatCount(report.totals.units),
                    },
                  ]}
                />
                <h3 className="mb-2 text-sm font-medium text-nbts-ink">
                  By blood group
                </h3>
                <SimpleTable
                  headers={["Blood group", "Donations", "Units"]}
                  rows={report.byBloodGroup.map((g) => [
                    formatBloodGroupLabel(g.bloodGroup),
                    formatCount(g.donationCount),
                    formatCount(g.units),
                  ])}
                  emptyLabel="No donations in range."
                />
                <h3 className="mb-2 mt-4 text-sm font-medium text-nbts-ink">
                  By date
                </h3>
                <SimpleTable
                  headers={["Date", "Donations", "Units"]}
                  rows={report.byDate.map((d) => [
                    d.date,
                    formatCount(d.donationCount),
                    formatCount(d.units),
                  ])}
                  emptyLabel="No daily donation rows."
                />
              </>
            ))}
          </SectionShell>

          <SectionShell
            title="Blood requests"
            description="Requested, issued, used, and unfulfilled blood units."
          >
            {renderSection(data.bloodRequests, (report) => (
              <>
                <MetricStrip
                  items={[
                    {
                      label: "Requests",
                      value: formatCount(report.totals.requestCount),
                    },
                    {
                      label: "Requested",
                      value: formatCount(report.totals.unitsRequested),
                    },
                    {
                      label: "Fulfilled",
                      value: formatCount(report.totals.fulfilledUnits),
                    },
                    {
                      label: "Unfulfilled",
                      value: formatCount(report.totals.unfulfilledUnits),
                    },
                  ]}
                />
                <SimpleTable
                  headers={[
                    "Blood group",
                    "Requested",
                    "Fulfilled",
                    "Unfulfilled",
                  ]}
                  rows={report.byBloodGroup.map((g) => [
                    formatBloodGroupLabel(g.bloodGroup),
                    formatCount(g.unitsRequested),
                    formatCount(g.fulfilledUnits),
                    formatCount(g.unfulfilledUnits),
                  ])}
                  emptyLabel="No blood-request rows for the selected filters."
                />
              </>
            ))}
          </SectionShell>

          <SectionShell
            title="Notifications"
            description="Notification volume by status, channel, blood group, and day."
          >
            {renderSection(data.notifications, (report) => (
              <>
                <MetricStrip
                  items={[
                    {
                      label: "Total",
                      value: formatCount(report.totals.total),
                    },
                  ]}
                />
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-nbts-ink">
                      By status
                    </h3>
                    <SimpleTable
                      headers={["Status", "Count"]}
                      rows={report.byStatus.map((r) => [
                        r.status,
                        formatCount(r.count),
                      ])}
                      emptyLabel="No status rows."
                    />
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-nbts-ink">
                      By channel
                    </h3>
                    <SimpleTable
                      headers={["Channel", "Count"]}
                      rows={report.byChannel.map((r) => [
                        r.channel,
                        formatCount(r.count),
                      ])}
                      emptyLabel="No channel rows."
                    />
                  </div>
                </div>
                <h3 className="mb-2 mt-4 text-sm font-medium text-nbts-ink">
                  By blood group
                </h3>
                <SimpleTable
                  headers={["Blood group", "Count"]}
                  rows={report.byBloodGroup.map((g) => [
                    formatBloodGroupLabel(g.bloodGroup),
                    formatCount(g.count),
                  ])}
                  emptyLabel="No notification blood-group rows."
                />
              </>
            ))}
          </SectionShell>
        </>
      ) : null}
    </div>
  );
}
