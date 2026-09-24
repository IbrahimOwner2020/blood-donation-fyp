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
import { BLOOD_GROUP_OPTIONS } from "~/lib/donors";
import {
  formatApiErrorMessage,
  formatDateOnly,
  formatDonationBloodGroup,
  formatDonationCentreLabel,
  formatDonationDonorName,
  isForbiddenApiError,
  isValidDateOnly,
  listDonationCentres,
  listDonations,
  parsePositiveInt,
  type PublicDonation,
  type PublicDonationCentre,
} from "~/lib/donations";

export const meta: MetaFunction = () => [
  { title: "Donations · Blood Donation Management System" },
];

type DonationFilters = {
  bloodGroup: string;
  donationCentreId: number | "";
  donorId: number | "";
  from: string;
  to: string;
  limit: number;
  offset: number;
};

type DonationsIndexLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      donations: PublicDonation[];
      centres: PublicDonationCentre[];
      total: number;
      limit: number;
      offset: number;
      filters: DonationFilters;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      centres: PublicDonationCentre[];
      filters: DonationFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      centres: PublicDonationCentre[];
      filters: DonationFilters;
    };

function parseFilters(url: URL): DonationFilters {
  const bloodGroupRaw = (url.searchParams.get("bloodGroup") || "").trim();
  const bloodGroup = BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroupRaw)
    ? bloodGroupRaw
    : "";

  const centreRaw = parsePositiveInt(url.searchParams.get("donationCentreId"));
  const donorRaw = parsePositiveInt(url.searchParams.get("donorId"));
  const fromRaw = (url.searchParams.get("from") || "").trim();
  const toRaw = (url.searchParams.get("to") || "").trim();

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
    donationCentreId: Number.isFinite(centreRaw) ? centreRaw : "",
    donorId: Number.isFinite(donorRaw) ? donorRaw : "",
    from: isValidDateOnly(fromRaw) ? fromRaw : "",
    to: isValidDateOnly(toRaw) ? toRaw : "",
    limit,
    offset,
  };
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<DonationsIndexLoaderData> {
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  let centres: PublicDonationCentre[] = [];
  try {
    centres = await listDonationCentres({ active: true });
  } catch {
    centres = [];
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.donationsRead)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include donations:read. The server remains the access authority.",
      centres,
      filters,
    };
  }

  try {
    const result = await listDonations({
      bloodGroup: filters.bloodGroup || undefined,
      donationCentreId:
        filters.donationCentreId === ""
          ? undefined
          : filters.donationCentreId,
      donorId: filters.donorId === "" ? undefined : filters.donorId,
      from: filters.from || undefined,
      to: filters.to || undefined,
      limit: filters.limit,
      offset: filters.offset,
    });

    return {
      status: "ok",
      session,
      donations: result.donations ?? [],
      centres,
      total: result.total ?? 0,
      limit: result.limit ?? filters.limit,
      offset: result.offset ?? filters.offset,
      filters,
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to list donations.",
        ),
        centres,
        filters,
      };
    }
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load donations."),
      centres,
      filters,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading donations…" />;
}

const inputClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

function buildPageQuery(
  filters: DonationFilters,
  offset: number,
  limit: number,
): string {
  return new URLSearchParams({
    ...(filters.bloodGroup ? { bloodGroup: filters.bloodGroup } : {}),
    ...(filters.donationCentreId === ""
      ? {}
      : { donationCentreId: String(filters.donationCentreId) }),
    ...(filters.donorId === "" ? {} : { donorId: String(filters.donorId) }),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    limit: String(limit),
    offset: String(offset),
  }).toString();
}

export default function DonationsIndexPage() {
  const data = useLoaderData<DonationsIndexLoaderData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/donations";

  const filters =
    data?.filters ?? parseFilters(new URL("http://local/donations"));
  const session = data?.session;
  const centres = data?.centres ?? [];

  return (
    <div>
      <PageHeader
        title="Donations"
        description="Recorded donations from the server. Unit and stock totals remain server-owned — recording a donation may create linked inventory units."
        actions={
          <ProtectedUi
            session={session}
            gate={UI_PERMISSIONS.donationsCreate}
            fallback={null}
          >
            <Link
              to="/donations/new"
              className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
            >
              Record donation
            </Link>
          </ProtectedUi>
        }
      />

      {data?.status === "forbidden" ? (
        <ForbiddenState
          title="Donations access restricted"
          message={
            data.message ||
            "You do not have permission to view donations (donations:read)."
          }
          detail="UI gate only — the server enforces authorization."
        />
      ) : null}

      {data?.status === "error" ? (
        <ErrorState
          title="Could not load donations"
          message={data.message || "Unable to load donations from the server."}
        />
      ) : null}

      {data?.status === "ok" || data?.status === "error" ? (
        <Form
          method="get"
          className="mb-6 grid gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-6"
        >
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
          <label className="flex flex-col gap-1 text-sm lg:col-span-2">
            <span className="font-medium text-nbts-ink">Donation centre</span>
            <select
              name="donationCentreId"
              defaultValue={
                filters.donationCentreId === ""
                  ? ""
                  : String(filters.donationCentreId)
              }
              className={inputClass}
            >
              <option value="">All centres</option>
              {centres.map((centre) => (
                <option key={centre.id} value={centre.id}>
                  {formatDonationCentreLabel(centre)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Donor id</span>
            <input
              name="donorId"
              type="number"
              min={1}
              defaultValue={
                filters.donorId === "" ? "" : String(filters.donorId)
              }
              placeholder="Optional"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">From</span>
            <input
              name="from"
              type="date"
              defaultValue={filters.from}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">To</span>
            <input
              name="to"
              type="date"
              defaultValue={filters.to}
              className={inputClass}
            />
          </label>
          <input type="hidden" name="limit" value={String(filters.limit)} />
          <input type="hidden" name="offset" value="0" />
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <button
              type="submit"
              className="rounded bg-nbts-teal px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Apply filters
            </button>
            {searchParams.toString() ? (
              <Link
                to="/donations"
                className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </Form>
      ) : null}

      {isFiltering ? <LoadingState label="Updating donations…" /> : null}

      {data?.status === "ok" && !isFiltering ? (
        <>
          {(data.donations?.length ?? 0) === 0 ? (
            <EmptyState
              title="No donations found"
              description="Try adjusting filters, or record a donation if you have create access."
              action={
                <ProtectedUi
                  session={session}
                  gate={UI_PERMISSIONS.donationsCreate}
                >
                  <Link
                    to="/donations/new"
                    className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
                  >
                    Record donation
                  </Link>
                </ProtectedUi>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Id</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Donor</th>
                    <th className="px-4 py-3 font-medium">Centre</th>
                    <th className="px-4 py-3 font-medium">Blood group</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {data.donations.map((donation) => (
                    <tr
                      key={donation.id}
                      className="border-b border-nbts-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/donations/${donation.id}`}
                          className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                        >
                          #{donation.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {formatDateOnly(donation.donationDate)}
                      </td>
                      <td className="px-4 py-3">
                        {donation.donor ? (
                          <Link
                            to={`/donors/${donation.donorId}`}
                            className="text-nbts-teal underline-offset-2 hover:underline"
                          >
                            {formatDonationDonorName(donation.donor)}
                            {donation.donor.donorNumber
                              ? ` (${donation.donor.donorNumber})`
                              : ""}
                          </Link>
                        ) : (
                          `Donor #${donation.donorId}`
                        )}
                      </td>
                      <td className="px-4 py-3 text-nbts-ink">
                        {formatDonationCentreLabel(donation.donationCentre)}
                      </td>
                      <td className="px-4 py-3">
                        {formatDonationBloodGroup(donation)}
                      </td>
                      <td className="px-4 py-3">{donation.category === "FAMILY_REPLACEMENT" ? "Family replacement" : "Voluntary"}</td>
                      <td className="px-4 py-3">{donation.units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(data.total ?? 0) > 0 &&
          ((data.offset ?? 0) > 0 ||
            (data.offset ?? 0) + (data.limit ?? 50) < (data.total ?? 0)) ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-nbts-muted">
              <p>
                Showing {(data.offset ?? 0) + 1}–
                {Math.min(
                  (data.offset ?? 0) + (data.donations?.length ?? 0),
                  data.total ?? 0,
                )}{" "}
                of {data.total}
              </p>
              <div className="flex gap-2">
                {data.offset > 0 ? (
                  <Link
                    to={`/donations?${buildPageQuery(
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
                    to={`/donations?${buildPageQuery(
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
