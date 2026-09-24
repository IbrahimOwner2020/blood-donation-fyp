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
  fetchAuthSession,
  hasUiPermission,
  UI_PERMISSIONS,
  type AuthSession,
} from "~/lib/auth";
import {
  BLOOD_GROUP_OPTIONS,
  DONOR_ELIGIBILITY_STATUSES,
  formatActiveState,
  formatApiErrorMessage,
  formatBloodGroup,
  formatDonorName,
  formatEligibilityStatus,
  isForbiddenApiError,
  listDonors,
  parseOptionalBoolean,
  parsePositiveInt,
  type DonorEligibilityStatus,
  type ListDonorsParams,
  type PublicDonor,
} from "~/lib/donors";
import {
  formatDonationCentreLabel,
  listDonationCentres,
  type PublicDonationCentre,
} from "~/lib/donations";

export const meta: MetaFunction = () => [
  { title: "Donors · Blood Donation Management System" },
];

type DonorFilters = {
  q: string;
  bloodGroup: string;
  donationCentreId: number | "";
  active: boolean | "";
  eligibilityStatus: DonorEligibilityStatus | "";
  limit: number;
  offset: number;
};

type DonorsIndexLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      donors: PublicDonor[];
      centres: PublicDonationCentre[];
      total: number;
      limit: number;
      offset: number;
      filters: DonorFilters;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      centres: PublicDonationCentre[];
      filters: DonorFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      centres: PublicDonationCentre[];
      filters: DonorFilters;
    };

function parseFilters(url: URL): DonorFilters {
  const eligibilityRaw = (url.searchParams.get("eligibilityStatus") || "").trim();
  const eligibilityStatus =
    eligibilityRaw === "POTENTIALLY_ELIGIBLE" ||
    eligibilityRaw === "TEMPORARILY_INELIGIBLE" ||
    eligibilityRaw === "INELIGIBLE" ||
    eligibilityRaw === "UNKNOWN"
      ? eligibilityRaw
      : "";

  const bloodGroupRaw = (url.searchParams.get("bloodGroup") || "").trim();
  const bloodGroup = BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroupRaw)
    ? bloodGroupRaw
    : "";

  const centreRaw = parsePositiveInt(url.searchParams.get("donationCentreId"));
  const donationCentreId = Number.isFinite(centreRaw) ? centreRaw : "";

  const limit = parsePositiveInt(url.searchParams.get("limit"), 50);
  const offsetRaw = Number.parseInt(
    String(url.searchParams.get("offset") ?? "0").trim(),
    10,
  );
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  return {
    q: (url.searchParams.get("q") || "").trim(),
    bloodGroup,
    donationCentreId,
    active: parseOptionalBoolean(url.searchParams.get("active")),
    eligibilityStatus,
    limit: Math.min(limit || 50, 100),
    offset,
  };
}

function toListParams(filters: DonorFilters): ListDonorsParams {
  return {
    q: filters.q || undefined,
    bloodGroup: filters.bloodGroup || undefined,
    donationCentreId:
      filters.donationCentreId === "" ? undefined : filters.donationCentreId,
    active: filters.active === "" ? undefined : filters.active,
    eligibilityStatus: filters.eligibilityStatus || undefined,
    limit: filters.limit,
    offset: filters.offset,
  };
}

async function loadCentresSafe(): Promise<PublicDonationCentre[]> {
  try {
    return await listDonationCentres({ active: true });
  } catch {
    return [];
  }
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<DonorsIndexLoaderData> {
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const centres = await loadCentresSafe();

  if (!hasUiPermission(session, UI_PERMISSIONS.donorsRead)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include donors:read. The server remains the access authority.",
      centres,
      filters,
    };
  }

  try {
    const result = await listDonors(toListParams(filters));
    return {
      status: "ok",
      session,
      donors: result.donors ?? [],
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
          "You do not have permission to list donors.",
        ),
        centres,
        filters,
      };
    }
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load donors."),
      centres,
      filters,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading donors…" />;
}

const inputClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

export default function DonorsIndexPage() {
  const data = useLoaderData<DonorsIndexLoaderData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/donors";

  const filters = data?.filters ?? parseFilters(new URL("http://local/donors"));
  const session = data?.session;
  const centres = data?.centres ?? [];

  function buildDonorListQuery(overrides: {
    offset?: number;
  } = {}): string {
    return new URLSearchParams({
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.bloodGroup ? { bloodGroup: filters.bloodGroup } : {}),
      ...(filters.donationCentreId === ""
        ? {}
        : { donationCentreId: String(filters.donationCentreId) }),
      ...(filters.active === ""
        ? {}
        : { active: filters.active ? "true" : "false" }),
      ...(filters.eligibilityStatus
        ? { eligibilityStatus: filters.eligibilityStatus }
        : {}),
      limit: String(data?.status === "ok" ? data.limit : filters.limit),
      offset: String(
        overrides.offset ?? (data?.status === "ok" ? data.offset : 0),
      ),
    }).toString();
  }

  return (
    <div>
      <PageHeader
        title="Donors"
        description="Search and filter donors. Eligibility labels are server-provided and shown as potentially eligible only — never as medical approval."
        actions={
          <ProtectedUi
            session={session}
            gate={UI_PERMISSIONS.donorsCreate}
            fallback={null}
          >
            <Link
              to="/donors/new"
              className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
            >
              New donor
            </Link>
          </ProtectedUi>
        }
      />

      {data?.status === "forbidden" ? (
        <ForbiddenState
          title="Donors access restricted"
          message={
            data.message ||
            "You do not have permission to view donors (donors:read)."
          }
          detail="UI gate only — the server enforces authorization."
        />
      ) : null}

      {data?.status === "error" ? (
        <ErrorState
          title="Could not load donors"
          message={data.message || "Unable to load donors from the server."}
        />
      ) : null}

      {data?.status === "ok" || data?.status === "error" ? (
        <Form
          method="get"
          className="mb-6 grid gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-6"
        >
          <label className="flex flex-col gap-1 text-sm lg:col-span-2">
            <span className="font-medium text-nbts-ink">Search</span>
            <input
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder="Number, name, phone, email"
              className={inputClass}
            />
          </label>
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
          <label className="flex flex-col gap-1 text-sm">
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
                <option key={centre.id} value={String(centre.id)}>
                  {formatDonationCentreLabel(centre)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Active</span>
            <select
              name="active"
              defaultValue={
                filters.active === ""
                  ? ""
                  : filters.active
                    ? "true"
                    : "false"
              }
              className={inputClass}
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Eligibility</span>
            <select
              name="eligibilityStatus"
              defaultValue={filters.eligibilityStatus}
              className={inputClass}
            >
              <option value="">All</option>
              {DONOR_ELIGIBILITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatEligibilityStatus(status)}
                </option>
              ))}
            </select>
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
                to="/donors"
                className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </Form>
      ) : null}

      {isFiltering ? <LoadingState label="Updating donors…" /> : null}

      {data?.status === "ok" && !isFiltering ? (
        <>
          {(data.donors?.length ?? 0) === 0 ? (
            <EmptyState
              title="No donors found"
              description="Try adjusting filters, or register a donor if you have create access."
              action={
                <ProtectedUi
                  session={session}
                  gate={UI_PERMISSIONS.donorsCreate}
                >
                  <Link
                    to="/donors/new"
                    className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
                  >
                    Register donor
                  </Link>
                </ProtectedUi>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Donor #</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Blood group</th>
                    <th className="px-4 py-3 font-medium">Eligibility</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {data.donors.map((donor) => (
                    <tr
                      key={donor.id}
                      className="border-b border-nbts-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/donors/${donor.id}`}
                          className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                        >
                          {donor.donorNumber || `ID ${donor.id}`}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-nbts-ink">
                        {formatDonorName(donor)}
                      </td>
                      <td className="px-4 py-3">{formatBloodGroup(donor)}</td>
                      <td className="px-4 py-3">
                        {formatEligibilityStatus(donor.eligibilityStatus)}
                      </td>
                      <td className="px-4 py-3">
                        {formatActiveState(donor.active)}
                      </td>
                      <td className="px-4 py-3 text-nbts-muted">
                        {donor.phone || donor.email || "—"}
                      </td>
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
                  (data.offset ?? 0) + (data.donors?.length ?? 0),
                  data.total ?? 0,
                )}{" "}
                of {data.total}
              </p>
              <div className="flex gap-2">
                {data.offset > 0 ? (
                  <Link
                    to={`/donors?${buildDonorListQuery({
                      offset: Math.max(0, data.offset - data.limit),
                    })}`}
                    className="rounded border border-nbts-border px-3 py-1.5 font-medium text-nbts-ink hover:border-nbts-muted"
                  >
                    Previous
                  </Link>
                ) : null}
                {data.offset + data.limit < data.total ? (
                  <Link
                    to={`/donors?${buildDonorListQuery({
                      offset: data.offset + data.limit,
                    })}`}
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
