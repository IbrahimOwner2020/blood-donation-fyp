import {
  Link,
  redirect,
  useLoaderData,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ErrorState } from "~/components/ui/ErrorState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { listAlerts, type PublicAlert } from "~/lib/alerts";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import { listBloodRequests, type PublicBloodRequest } from "~/lib/blood-requests";
import { listDonations, type PublicDonation } from "~/lib/donations";
import { listDonors, type PublicDonor } from "~/lib/donors";
import {
  listExpiringInventory,
  listLowStockInventory,
  type PublicInventoryUnit,
  type InventorySummaryRow,
} from "~/lib/inventory";
import { listNotifications, type PublicNotification } from "~/lib/notifications";

export const meta: MetaFunction = () => [
  { title: "Dashboard · Blood Donation Management System" },
];

type LoaderData = {
  session: AuthSession;
  donors: PublicDonor[];
  donations: PublicDonation[];
  lowStock: InventorySummaryRow[];
  expiring: PublicInventoryUnit[];
  requests: PublicBloodRequest[];
  notifications: PublicNotification[];
  alerts: PublicAlert[];
  unavailable: string[];
  can: {
    donors: boolean;
    donations: boolean;
    inventory: boolean;
    requests: boolean;
    notifications: boolean;
    alerts: boolean;
  };
};

async function safely<T>(
  name: string,
  call: Promise<T>,
  fallback: T,
  unavailable: string[],
): Promise<T> {
  try {
    return await call;
  } catch {
    unavailable.push(name);
    return fallback;
  }
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<LoaderData> {
  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    throw redirect(
      `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
    );
  }

  const can = {
    donors: hasUiPermission(session, UI_PERMISSIONS.donorsRead),
    donations: hasUiPermission(session, UI_PERMISSIONS.donationsRead),
    inventory: hasUiPermission(session, UI_PERMISSIONS.inventoryRead),
    requests: hasUiPermission(session, UI_PERMISSIONS.requestsRead),
    notifications: hasUiPermission(session, UI_PERMISSIONS.notificationsRead),
    alerts: hasUiPermission(session, UI_PERMISSIONS.alertsRead),
  };

  const unavailable: string[] = [];
  const emptyDonors = {
    donors: [] as PublicDonor[],
    total: 0,
    limit: 100,
    offset: 0,
  };
  const emptyDonations = {
    donations: [] as PublicDonation[],
    total: 0,
    limit: 5,
    offset: 0,
  };
  const emptyRequests = {
    bloodRequests: [] as PublicBloodRequest[],
    total: 0,
    limit: 20,
    offset: 0,
  };
  const emptyNotifications = {
    notifications: [] as PublicNotification[],
    total: 0,
    limit: 20,
    offset: 0,
  };
  const emptyAlerts = {
    alerts: [] as PublicAlert[],
    total: 0,
    limit: 20,
    offset: 0,
  };
  const [
    donorResult,
    donationResult,
    lowResult,
    expiryResult,
    requestResult,
    notificationResult,
    alertResult,
  ] = await Promise.all([
    can.donors
      ? safely(
          "donors",
          listDonors({ active: true, limit: 100 }),
          emptyDonors,
          unavailable,
        )
      : Promise.resolve(emptyDonors),
    can.donations
      ? safely("donations", listDonations({ limit: 5 }), emptyDonations, unavailable)
      : Promise.resolve(emptyDonations),
    can.inventory
      ? safely(
          "low stock",
          listLowStockInventory(),
          { rows: [] as InventorySummaryRow[] },
          unavailable,
        )
      : Promise.resolve({ rows: [] as InventorySummaryRow[] }),
    can.inventory
      ? safely(
          "expiring units",
          listExpiringInventory({ withinDays: 14, limit: 20 }),
          { units: [] as PublicInventoryUnit[], total: 0, limit: 20, offset: 0 },
          unavailable,
        )
      : Promise.resolve({
          units: [] as PublicInventoryUnit[],
          total: 0,
          limit: 20,
          offset: 0,
        }),
    can.requests
      ? safely(
          "blood requests",
          listBloodRequests({ limit: 20 }),
          emptyRequests,
          unavailable,
        )
      : Promise.resolve(emptyRequests),
    can.notifications
      ? safely(
          "notifications",
          listNotifications({ status: "FAILED", limit: 20 }),
          emptyNotifications,
          unavailable,
        )
      : Promise.resolve(emptyNotifications),
    can.alerts
      ? safely(
          "alerts",
          listAlerts({ activeOnly: true, limit: 20 }),
          emptyAlerts,
          unavailable,
        )
      : Promise.resolve(emptyAlerts),
  ]);

  return {
    session,
    donors: donorResult.donors,
    donations: donationResult.donations,
    lowStock: lowResult.rows,
    expiring: expiryResult.units,
    requests: requestResult.bloodRequests,
    notifications: notificationResult.notifications,
    alerts: alertResult.alerts,
    unavailable,
    can,
  };
}

clientLoader.hydrate = true as const;
export function HydrateFallback() {
  return <LoadingState label="Loading dashboard…" />;
}

function Card({
  title,
  value,
  detail,
  to,
}: {
  title: string;
  value: number;
  detail: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-nbts-border bg-white p-4 transition hover:border-nbts-teal"
    >
      <p className="text-sm text-nbts-muted">{title}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-nbts-muted">{detail}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const data = useLoaderData<LoaderData>();
  const eligible = (data.donors ?? []).filter(
    (donor) => donor.preliminaryEligibility.status === "ELIGIBLE",
  ).length;
  const becomingEligible = (data.donors ?? []).filter((donor) => {
    const days = donor.preliminaryEligibility.daysUntilEligible;
    return (
      donor.preliminaryEligibility.status === "WAITING_PERIOD" &&
      days !== null &&
      days <= 30
    );
  }).length;
  const openRequests = (data.requests ?? []).filter(
    (request) => !["FULFILLED", "CANCELLED"].includes(request.status),
  ).length;
  const pendingApproval = (data.requests ?? []).filter(
    (request) => request.status === "PENDING",
  ).length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Current operational priorities. Eligibility is preliminary and does not replace medical screening."
      />
      {data.unavailable.length ? (
        <div className="mb-4">
          <ErrorState
            title="Some dashboard sections are unavailable"
            message={`Could not load: ${data.unavailable.join(", ")}. Visible cards use the sections that were available.`}
          />
        </div>
      ) : null}
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Operational summary"
      >
        {data.can.donors ? (
          <Card
            title="Eligible donors"
            value={eligible}
            detail="Preliminary requirements met"
            to="/donors"
          />
        ) : null}
        {data.can.donors ? (
          <Card
            title="Eligible within 30 days"
            value={becomingEligible}
            detail="Waiting-period follow-up"
            to="/donors"
          />
        ) : null}
        {data.can.inventory ? (
          <Card
            title="Low-stock groups"
            value={data.lowStock.filter((row) => row.lowStock).length}
            detail="Current inventory thresholds"
            to="/inventory?view=low-stock"
          />
        ) : null}
        {data.can.inventory ? (
          <Card
            title="Expiring units"
            value={data.expiring.length}
            detail="Within the next 14 days"
            to="/inventory?view=expiring"
          />
        ) : null}
        {data.can.donations ? (
          <Card
            title="Recent donations"
            value={data.donations.length}
            detail="Most recently recorded"
            to="/donations"
          />
        ) : null}
        {data.can.requests ? (
          <Card
            title="Open blood requests"
            value={openRequests}
            detail="Pending, approved, or partial"
            to="/blood-requests"
          />
        ) : null}
        {data.can.requests && hasUiPermission(data.session, UI_PERMISSIONS.requestsApprove) ? (
          <Card
            title="Pending approval"
            value={pendingApproval}
            detail="Awaiting manager decision"
            to="/blood-requests?status=PENDING"
          />
        ) : null}
        {data.can.alerts ? (
          <Card
            title="Open shortage alerts"
            value={data.alerts.length}
            detail="Active projected stock gaps"
            to="/alerts"
          />
        ) : null}
        {data.can.notifications ? (
          <Card
            title="Notification failures"
            value={data.notifications.length}
            detail="Review before an administrator retries"
            to="/notifications?status=FAILED"
          />
        ) : null}
        {data.can.donors ? (
          <Card
            title="Incomplete donor profiles"
            value={data.donors.filter(
              (donor) => !donor.preliminaryEligibility.profileComplete,
            ).length}
            detail="Needs demographic or contact details"
            to="/donors"
          />
        ) : null}
      </section>
      <section className="mt-8 rounded-lg border border-nbts-border bg-white p-5">
        <h2 className="text-lg font-semibold">Assistant guidance</h2>
        <p className="mt-2 text-sm text-nbts-muted">
          Use the assistant to summarize donors, donations, inventory, blood
          requests, stock alerts, notifications, and reports. It follows your
          role and facility access and asks for confirmation before sending
          notifications or changing records.
        </p>
      </section>
    </div>
  );
}
