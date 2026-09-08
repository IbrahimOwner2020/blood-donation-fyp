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
  formatApiErrorMessage,
  formatDateOnly,
  formatInventoryBloodGroup,
  formatInventoryFacility,
  formatInventoryStatus,
  getInventorySummary,
  isForbiddenApiError,
  isInventoryRouteMissingError,
  listExpiringInventory,
  listInventory,
  listLowStockInventory,
  parseInventoryStatus,
  parsePositiveInt,
  type InventoryStatus,
  type InventorySummaryRow,
  type PublicInventoryUnit,
  INVENTORY_STATUSES,
} from "~/lib/inventory";

export const meta: MetaFunction = () => [
  { title: "Inventory · NBTS Blood AI" },
];

type InventoryView = "units" | "summary" | "expiring" | "low-stock";

type InventoryFilters = {
  view: InventoryView;
  bloodGroup: string;
  status: InventoryStatus | "";
  withinDays: number;
  limit: number;
  offset: number;
};

type InventoryIndexLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      filters: InventoryFilters;
      units: PublicInventoryUnit[];
      summary: InventorySummaryRow[];
      lowStock: InventorySummaryRow[];
      total: number;
      limit: number;
      offset: number;
      unavailableMessage?: string;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      filters: InventoryFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      filters: InventoryFilters;
    };

function parseView(value: string | null | undefined): InventoryView {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "summary") return "summary";
  if (raw === "expiring") return "expiring";
  if (raw === "low-stock" || raw === "lowstock") return "low-stock";
  return "units";
}

function parseFilters(url: URL): InventoryFilters {
  const bloodGroupRaw = (url.searchParams.get("bloodGroup") || "").trim();
  const bloodGroup = BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroupRaw)
    ? bloodGroupRaw
    : "";
  const status = parseInventoryStatus(url.searchParams.get("status"));
  const withinRaw = Number.parseInt(
    String(url.searchParams.get("withinDays") ?? "7").trim(),
    10,
  );
  const withinDays =
    Number.isFinite(withinRaw) && withinRaw > 0 ? Math.min(withinRaw, 90) : 7;
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
    view: parseView(url.searchParams.get("view")),
    bloodGroup,
    status,
    withinDays,
    limit,
    offset,
  };
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<InventoryIndexLoaderData> {
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.inventoryRead)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include inventory:read. The API remains the access authority.",
      filters,
    };
  }

  try {
    if (filters.view === "summary") {
      const summary = await getInventorySummary();
      return {
        status: "ok",
        session,
        filters,
        units: [],
        summary: summary ?? [],
        lowStock: [],
        total: summary?.length ?? 0,
        limit: filters.limit,
        offset: 0,
      };
    }

    if (filters.view === "low-stock") {
      const low = await listLowStockInventory();
      return {
        status: "ok",
        session,
        filters,
        units: [],
        summary: [],
        lowStock: low.rows ?? [],
        total: low.rows?.length ?? 0,
        limit: filters.limit,
        offset: 0,
      };
    }

    if (filters.view === "expiring") {
      const bloodGroupId = filters.bloodGroup
        ? BLOOD_GROUP_OPTIONS.find((g) => g.code === filters.bloodGroup)?.id
        : undefined;
      const result = await listExpiringInventory({
        withinDays: filters.withinDays,
        bloodGroupId:
          typeof bloodGroupId === "number" ? bloodGroupId : undefined,
        limit: filters.limit,
        offset: filters.offset,
      });

      return {
        status: "ok",
        session,
        filters,
        units: result.units ?? [],
        summary: [],
        lowStock: [],
        total: result.total ?? 0,
        limit: result.limit ?? filters.limit,
        offset: result.offset ?? filters.offset,
      };
    }

    const result = await listInventory({
      bloodGroup: filters.bloodGroup || undefined,
      status: filters.status || undefined,
      limit: filters.limit,
      offset: filters.offset,
    });

    return {
      status: "ok",
      session,
      filters,
      units: result.units ?? [],
      summary: [],
      lowStock: [],
      total: result.total ?? 0,
      limit: result.limit ?? filters.limit,
      offset: result.offset ?? filters.offset,
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view inventory.",
        ),
        filters,
      };
    }
    if (isInventoryRouteMissingError(error)) {
      return {
        status: "ok",
        session,
        filters,
        units: [],
        summary: [],
        lowStock: [],
        total: 0,
        limit: filters.limit,
        offset: filters.offset,
        unavailableMessage: formatApiErrorMessage(
          error,
          "Inventory endpoints are not available yet. Counts remain API-owned when the module lands.",
        ),
      };
    }
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load inventory."),
      filters,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading inventory…" />;
}

const inputClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

const tabClass = (active: boolean) =>
  [
    "rounded px-3 py-1.5 text-sm font-medium",
    active
      ? "bg-nbts-blood text-white"
      : "border border-nbts-border bg-nbts-panel text-nbts-ink hover:border-nbts-muted",
  ].join(" ");

function viewHref(view: InventoryView, filters: InventoryFilters): string {
  const params = new URLSearchParams({ view });
  if (filters.bloodGroup) params.set("bloodGroup", filters.bloodGroup);
  if (filters.status) params.set("status", filters.status);
  if (view === "expiring") {
    params.set("withinDays", String(filters.withinDays));
  }
  params.set("limit", String(filters.limit));
  params.set("offset", "0");
  return `/inventory?${params.toString()}`;
}

function buildPageQuery(
  filters: InventoryFilters,
  offset: number,
  limit: number,
): string {
  return new URLSearchParams({
    view: filters.view,
    ...(filters.bloodGroup ? { bloodGroup: filters.bloodGroup } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.view === "expiring"
      ? { withinDays: String(filters.withinDays) }
      : {}),
    limit: String(limit),
    offset: String(offset),
  }).toString();
}

function UnitsTable({ units }: { units: PublicInventoryUnit[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Unit</th>
            <th className="px-4 py-3 font-medium">Blood group</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Collected</th>
            <th className="px-4 py-3 font-medium">Expires</th>
            <th className="px-4 py-3 font-medium">Facility</th>
            <th className="px-4 py-3 font-medium">Donation</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr
              key={unit.id}
              className="border-b border-nbts-border last:border-0"
            >
              <td className="px-4 py-3">
                <Link
                  to={`/inventory/${unit.id}`}
                  className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                >
                  #{unit.id}
                </Link>
              </td>
              <td className="px-4 py-3">
                {formatInventoryBloodGroup(unit)}
              </td>
              <td className="px-4 py-3">
                {formatInventoryStatus(unit.status)}
              </td>
              <td className="px-4 py-3">
                {formatDateOnly(unit.collectionDate)}
              </td>
              <td className="px-4 py-3">{formatDateOnly(unit.expiryDate)}</td>
              <td className="px-4 py-3 text-nbts-muted">
                {formatInventoryFacility(unit.facility)}
              </td>
              <td className="px-4 py-3">
                {unit.donationId ? (
                  <Link
                    to={`/donations/${unit.donationId}`}
                    className="text-nbts-teal underline-offset-2 hover:underline"
                  >
                    #{unit.donationId}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: InventorySummaryRow[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if ((rows?.length ?? 0) === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Blood group</th>
            <th className="px-4 py-3 font-medium">Available</th>
            <th className="px-4 py-3 font-medium">Reserved</th>
            <th className="px-4 py-3 font-medium">Expiring soon</th>
            <th className="px-4 py-3 font-medium">Expired</th>
            <th className="px-4 py-3 font-medium">Low stock</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.bloodGroupId}
              className="border-b border-nbts-border last:border-0"
            >
              <td className="px-4 py-3 font-medium text-nbts-ink">
                {formatInventoryBloodGroup(row)}
              </td>
              <td className="px-4 py-3">{row.availableUnits}</td>
              <td className="px-4 py-3">{row.reservedUnits}</td>
              <td className="px-4 py-3">{row.expiringSoon}</td>
              <td className="px-4 py-3">{row.expired}</td>
              <td className="px-4 py-3">
                {row.lowStock ? "Yes" : "No"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InventoryIndexPage() {
  const data = useLoaderData<InventoryIndexLoaderData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/inventory";

  const filters =
    data?.filters ?? parseFilters(new URL("http://local/inventory"));

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Summary by blood group, unit list, low-stock, and expiry views. All counts come from the API — never computed here."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to={viewHref("units", filters)}
          className={tabClass(filters.view === "units")}
        >
          Units
        </Link>
        <Link
          to={viewHref("summary", filters)}
          className={tabClass(filters.view === "summary")}
        >
          Summary
        </Link>
        <Link
          to={viewHref("expiring", filters)}
          className={tabClass(filters.view === "expiring")}
        >
          Expiring
        </Link>
        <Link
          to={viewHref("low-stock", filters)}
          className={tabClass(filters.view === "low-stock")}
        >
          Low stock
        </Link>
      </div>

      {data?.status === "forbidden" ? (
        <ForbiddenState
          title="Inventory access restricted"
          message={
            data.message ||
            "You do not have permission to view inventory (inventory:read)."
          }
          detail="UI gate only — the API enforces authorization."
        />
      ) : null}

      {data?.status === "error" ? (
        <ErrorState
          title="Could not load inventory"
          message={data.message || "Unable to load inventory from the API."}
        />
      ) : null}

      {data?.status === "ok" && data.unavailableMessage ? (
        <div className="mb-4">
          <EmptyState
            title="Inventory API not available yet"
            description={data.unavailableMessage}
          />
        </div>
      ) : null}

      {data?.status === "ok" || data?.status === "error" ? (
        <Form
          method="get"
          className="mb-6 grid gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <input type="hidden" name="view" value={filters.view} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Blood group</span>
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
          {filters.view === "units" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-nbts-ink">Status</span>
              <select
                name="status"
                defaultValue={filters.status}
                className={inputClass}
              >
                <option value="">All</option>
                {INVENTORY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {formatInventoryStatus(status)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {filters.view === "expiring" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-nbts-ink">Within days</span>
              <input
                name="withinDays"
                type="number"
                min={1}
                max={90}
                defaultValue={filters.withinDays}
                className={inputClass}
              />
            </label>
          ) : null}
          <input type="hidden" name="limit" value={String(filters.limit)} />
          <input type="hidden" name="offset" value="0" />
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <button
              type="submit"
              className="rounded bg-nbts-teal px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Apply filters
            </button>
            {searchParams.toString() ? (
              <Link
                to={`/inventory?view=${filters.view}`}
                className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </Form>
      ) : null}

      {isFiltering ? <LoadingState label="Updating inventory…" /> : null}

      {data?.status === "ok" && !isFiltering && !data.unavailableMessage ? (
        <>
          {filters.view === "summary" ? (
            <SummaryTable
              rows={data.summary}
              emptyTitle="No summary rows"
              emptyDescription="Inventory summary by blood group will appear when the API returns data."
            />
          ) : null}

          {filters.view === "low-stock" ? (
            <SummaryTable
              rows={data.lowStock}
              emptyTitle="No low-stock groups"
              emptyDescription="Low-stock statuses come from the API. Empty means none reported (or the endpoint is empty)."
            />
          ) : null}

          {(filters.view === "units" || filters.view === "expiring") &&
          (data.units?.length ?? 0) === 0 ? (
            <EmptyState
              title={
                filters.view === "expiring"
                  ? "No expiring units"
                  : "No inventory units"
              }
              description={
                filters.view === "expiring"
                  ? "No units are marked as expiring soon for the selected window."
                  : "Try adjusting filters, or record a donation to create linked units."
              }
              action={
                <Link
                  to="/donations/new"
                  className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
                >
                  Record donation
                </Link>
              }
            />
          ) : null}

          {(filters.view === "units" || filters.view === "expiring") &&
          (data.units?.length ?? 0) > 0 ? (
            <UnitsTable units={data.units} />
          ) : null}

          {(filters.view === "units" || filters.view === "expiring") &&
          (data.total ?? 0) > 0 &&
          ((data.offset ?? 0) > 0 ||
            (data.offset ?? 0) + (data.limit ?? 50) < (data.total ?? 0)) ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-nbts-muted">
              <p>
                Showing {(data.offset ?? 0) + 1}–
                {Math.min(
                  (data.offset ?? 0) + (data.units?.length ?? 0),
                  data.total ?? 0,
                )}{" "}
                of {data.total}
              </p>
              <div className="flex gap-2">
                {data.offset > 0 ? (
                  <Link
                    to={`/inventory?${buildPageQuery(
                      filters,
                      Math.max(0, data.offset - data.limit),
                      data.limit,
                    )}`}
                    className="rounded border border-nbts-border px-3 py-1.5 font-medium text-nbts-ink hover:border-nbts-muted"
                  >
                    Previous
                  </Link>
                ) : null}
                {data.offset + data.limit < data.total ? (
                  <Link
                    to={`/inventory?${buildPageQuery(
                      filters,
                      data.offset + data.limit,
                      data.limit,
                    )}`}
                    className="rounded border border-nbts-border px-3 py-1.5 font-medium text-nbts-ink hover:border-nbts-muted"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
