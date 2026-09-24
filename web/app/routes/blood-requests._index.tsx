import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
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
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import {
  BLOOD_GROUP_OPTIONS,
  BLOOD_REQUEST_PRIORITIES,
  BLOOD_REQUEST_STATUSES,
  formatBloodGroupCode,
  formatDateTime,
  formatFacilityLabel,
  formatRequestPriority,
  formatRequestStatus,
  listBloodRequests,
  listFacilities,
  parseBloodRequestPriority,
  parseBloodRequestStatus,
  parsePositiveInt,
  type PublicBloodRequest,
  type PublicFacility,
} from "~/lib/blood-requests";

export const meta: MetaFunction = () => [
  { title: "Blood requests · Blood Donation Management System" },
];

type ListLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      bloodRequests: PublicBloodRequest[];
      facilities: PublicFacility[];
      total: number;
      filters: {
        facilityId: string;
        bloodGroupId: string;
        status: string;
        priority: string;
      };
      canCreate: boolean;
    }
  | { status: "forbidden"; session: AuthSession | null }
  | { status: "error"; message: string; detail?: string }
  | { status: "unauthenticated" };

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<ListLoaderData> {
  let session: AuthSession | null = null;
  try {
    session = await fetchAuthSession();
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to verify your session.";
    return { status: "error", message };
  }

  if (!session) {
    return { status: "unauthenticated" };
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.requestsRead)) {
    return { status: "forbidden", session };
  }

  const url = new URL(request.url);
  const facilityIdRaw = (url.searchParams.get("facilityId") || "").trim();
  const bloodGroupIdRaw = (url.searchParams.get("bloodGroupId") || "").trim();
  const status = parseBloodRequestStatus(url.searchParams.get("status"));
  const priority = parseBloodRequestPriority(url.searchParams.get("priority"));
  const facilityId = parsePositiveInt(facilityIdRaw);
  const bloodGroupId = parsePositiveInt(bloodGroupIdRaw);

  try {
    const [listResult, facilities] = await Promise.all([
      listBloodRequests({
        facilityId: Number.isFinite(facilityId) ? facilityId : undefined,
        bloodGroupId: Number.isFinite(bloodGroupId) ? bloodGroupId : undefined,
        status,
        priority,
      }),
      listFacilities({ active: true }).catch(() => [] as PublicFacility[]),
    ]);

    return {
      status: "ok",
      session,
      bloodRequests: listResult.bloodRequests ?? [],
      facilities: facilities ?? [],
      total: listResult.total ?? 0,
      filters: {
        facilityId: facilityIdRaw,
        bloodGroupId: bloodGroupIdRaw,
        status,
        priority,
      },
      canCreate: hasUiPermission(session, UI_PERMISSIONS.requestsCreate),
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { status: "forbidden", session };
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to load blood requests.";
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return { status: "error", message, detail };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading blood requests…" />;
}

function statusToneClass(status: string = ""): string {
  const value = status.trim().toUpperCase();
  if (value === "APPROVED" || value === "FULFILLED") {
    return "text-nbts-teal";
  }
  if (value === "PARTIAL" || value === "PENDING") {
    return "text-nbts-amber";
  }
  if (value === "CANCELLED") {
    return "text-nbts-muted";
  }
  return "text-nbts-ink";
}

export default function BloodRequestsIndexPage() {
  const data = useLoaderData<ListLoaderData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering = navigation.state === "loading";

  if (data?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to view blood requests."
      />
    );
  }

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Blood requests"
          description="Facility requests and status changes. Transitions are enforced by the server."
        />
        <ForbiddenState
          title="Missing permission"
          message="requests:read is required to list blood requests. The server remains the authority."
          detail="UI gate: requests:read"
        />
      </div>
    );
  }

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader title="Blood requests" />
        <ErrorState
          title="Could not load requests"
          message={data.message || "Request failed."}
          detail={data.detail}
        />
      </div>
    );
  }

  if (data?.status !== "ok") {
    return <LoadingState label="Loading blood requests…" />;
  }

  const requests = data.bloodRequests ?? [];
  const facilities = data.facilities ?? [];
  const facilityValue =
    searchParams.get("facilityId") ?? data.filters.facilityId ?? "";
  const bloodGroupValue =
    searchParams.get("bloodGroupId") ?? data.filters.bloodGroupId ?? "";
  const statusValue = searchParams.get("status") ?? data.filters.status ?? "";
  const priorityValue =
    searchParams.get("priority") ?? data.filters.priority ?? "";

  return (
    <div>
      <PageHeader
        title="Blood requests"
        description="Facility demand requests. Status transitions are constrained by the server status machine."
        actions={
          <ProtectedUi
            session={data.session}
            gate={UI_PERMISSIONS.requestsCreate}
            fallback={
              <span className="text-xs text-nbts-muted">
                Create requires requests:create
              </span>
            }
          >
            <Link
              to="/blood-requests/new"
              className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
            >
              New request
            </Link>
          </ProtectedUi>
        }
      />

      <Form
        method="get"
        className="mb-4 grid gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Facility</span>
          <select
            name="facilityId"
            defaultValue={facilityValue}
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          >
            <option value="">All</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={String(facility.id)}>
                {formatFacilityLabel(facility)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Blood group</span>
          <select
            name="bloodGroupId"
            defaultValue={bloodGroupValue}
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          >
            <option value="">All</option>
            {BLOOD_GROUP_OPTIONS.map((group) => (
              <option key={group.id} value={String(group.id)}>
                {group.code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Status</span>
          <select
            name="status"
            defaultValue={statusValue}
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          >
            <option value="">All</option>
            {BLOOD_REQUEST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatRequestStatus(status)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Priority</span>
          <select
            name="priority"
            defaultValue={priorityValue}
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          >
            <option value="">All</option>
            {BLOOD_REQUEST_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {formatRequestPriority(priority)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded border border-nbts-border bg-nbts-surface px-4 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
        >
          Filter
        </button>
      </Form>

      {isFiltering ? <LoadingState label="Updating list…" /> : null}

      {!isFiltering && requests.length === 0 ? (
        <EmptyState
          title="No blood requests found"
          description="Try different filters, or create a new facility request."
          action={
            data.canCreate ? (
              <Link
                to="/blood-requests/new"
                className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
              >
                New request
              </Link>
            ) : undefined
          }
        />
      ) : null}

      {!isFiltering && requests.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
          <p className="border-b border-nbts-border px-4 py-2 text-xs text-nbts-muted">
            Showing {requests.length}
            {data.total > requests.length ? ` of ${data.total}` : ""} request
            {data.total === 1 ? "" : "s"}
          </p>
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">ID</th>
                <th className="px-4 py-3 font-semibold">Facility</th>
                <th className="px-4 py-3 font-semibold">Blood group</th>
                <th className="px-4 py-3 font-semibold">Units</th>
                <th className="px-4 py-3 font-semibold">Priority</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Requested</th>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-nbts-border last:border-b-0"
                >
                  <td className="px-4 py-3 font-medium text-nbts-ink">
                    #{item.id}
                  </td>
                  <td className="px-4 py-3 text-nbts-muted">
                    {formatFacilityLabel(item.facility, item.facilityId)}
                  </td>
                  <td className="px-4 py-3 text-nbts-ink">
                    {formatBloodGroupCode(item.bloodGroup, item.bloodGroupId)}
                  </td>
                  <td className="px-4 py-3 text-nbts-muted">
                    {item.fulfilledUnits}/{item.unitsRequested}
                  </td>
                  <td className="px-4 py-3 text-nbts-muted">
                    {formatRequestPriority(item.priority)}
                  </td>
                  <td className={`px-4 py-3 font-medium ${statusToneClass(item.status)}`}>
                    {formatRequestStatus(item.status)}
                  </td>
                  <td className="px-4 py-3 text-nbts-muted">
                    {formatDateTime(item.requestedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/blood-requests/${item.id}`}
                      className="font-medium text-nbts-teal underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
