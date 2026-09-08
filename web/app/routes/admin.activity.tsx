import {
  Form,
  Link,
  redirect,
  useLoaderData,
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
  ApiRequestError,
  datetimeLocalToIso,
  formatActivityActor,
  formatActivityEntity,
  formatActivityMetadata,
  formatApiErrorMessage,
  formatDateTime,
  isoToDatetimeLocal,
  isForbiddenApiError,
  listActivityLogs,
  parsePositiveInt,
  type PublicActivityLog,
} from "~/lib/admin-activity";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";

export const meta: MetaFunction = () => [
  { title: "Activity · NBTS Blood AI" },
];

type ActivityFilters = {
  q: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdFrom: string;
  createdTo: string;
  limit: number;
  offset: number;
};

type ActivityLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      filters: ActivityFilters;
      activityLogs: PublicActivityLog[];
      total: number;
      limit: number;
      offset: number;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      filters: ActivityFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      detail?: string;
      filters: ActivityFilters;
    };

function parseFilters(url: URL): ActivityFilters {
  const q = (url.searchParams.get("q") || "").trim();
  const userId = (url.searchParams.get("userId") || "").trim();
  const action = (url.searchParams.get("action") || "").trim();
  const entityType = (url.searchParams.get("entityType") || "").trim();
  const entityId = (url.searchParams.get("entityId") || "").trim();
  const createdFromRaw = (url.searchParams.get("createdFrom") || "").trim();
  const createdToRaw = (url.searchParams.get("createdTo") || "").trim();
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
    q,
    userId,
    action,
    entityType,
    entityId,
    createdFrom: createdFromRaw,
    createdTo: createdToRaw,
    limit,
    offset,
  };
}

/** Accept datetime-local or ISO query values for the API. */
function toApiDateTime(value: string = ""): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  const fromLocal = datetimeLocalToIso(raw);
  if (fromLocal) {
    return fromLocal;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<ActivityLoaderData> {
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.activityRead)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include activity:read. The API remains the access authority.",
      filters,
    };
  }

  const userIdNum = parsePositiveInt(filters.userId);
  const createdFromIso = toApiDateTime(filters.createdFrom);
  const createdToIso = toApiDateTime(filters.createdTo);

  try {
    const listResult = await listActivityLogs({
      userId: Number.isFinite(userIdNum) ? userIdNum : undefined,
      action: filters.action || undefined,
      entityType: filters.entityType || undefined,
      entityId: filters.entityId || undefined,
      q: filters.q || undefined,
      createdFrom: createdFromIso || undefined,
      createdTo: createdToIso || undefined,
      limit: filters.limit,
      offset: filters.offset,
    });

    return {
      status: "ok",
      session,
      filters,
      activityLogs: listResult.activityLogs ?? [],
      total: listResult.total ?? 0,
      limit: listResult.limit ?? filters.limit,
      offset: listResult.offset ?? filters.offset,
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view activity logs.",
        ),
        filters,
      };
    }
    const message = formatApiErrorMessage(
      error,
      "Unable to load activity logs.",
    );
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return {
      status: "error",
      session,
      message,
      detail,
      filters,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading activity…" />;
}

function buildPageQuery(filters: ActivityFilters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.userId) {
    params.set("userId", filters.userId);
  }
  if (filters.action) {
    params.set("action", filters.action);
  }
  if (filters.entityType) {
    params.set("entityType", filters.entityType);
  }
  if (filters.entityId) {
    params.set("entityId", filters.entityId);
  }
  if (filters.createdFrom) {
    params.set("createdFrom", filters.createdFrom);
  }
  if (filters.createdTo) {
    params.set("createdTo", filters.createdTo);
  }
  params.set("limit", String(filters.limit));
  params.set("offset", String(offset));
  return params.toString();
}

export default function AdminActivityPage() {
  const loaderData = useLoaderData<ActivityLoaderData>();
  const [searchParams] = useSearchParams();

  const filters =
    loaderData?.filters ??
    parseFilters(new URL("http://local/admin/activity"));

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Admin · Activity"
          description="Audit trail for auth and admin actions. Sensitive values stay redacted per API policy."
        />
        <ForbiddenState
          title="Missing permission"
          message={
            loaderData.message ||
            "activity:read is required to view the audit trail. The API remains the authority."
          }
          detail="UI gate: activity:read"
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader title="Admin · Activity" />
        <ErrorState
          title="Could not load activity"
          message={loaderData.message || "Request failed."}
          detail={loaderData.detail}
        />
      </div>
    );
  }

  if (loaderData?.status !== "ok") {
    return <LoadingState label="Loading activity…" />;
  }

  const activityLogs = loaderData.activityLogs ?? [];
  const total = loaderData.total ?? 0;
  const limit = loaderData.limit ?? filters.limit;
  const offset = loaderData.offset ?? filters.offset;
  const hasPrev = offset > 0;
  const hasNext = offset + activityLogs.length < total;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  const qValue = searchParams.get("q") ?? filters.q ?? "";
  const userIdValue = searchParams.get("userId") ?? filters.userId ?? "";
  const actionValue = searchParams.get("action") ?? filters.action ?? "";
  const entityTypeValue =
    searchParams.get("entityType") ?? filters.entityType ?? "";
  const entityIdValue = searchParams.get("entityId") ?? filters.entityId ?? "";
  const createdFromValue =
    isoToDatetimeLocal(
      searchParams.get("createdFrom") ?? filters.createdFrom,
    ) || "";
  const createdToValue =
    isoToDatetimeLocal(searchParams.get("createdTo") ?? filters.createdTo) ||
    "";

  const pageHref = (nextOffsetValue: number) =>
    `/admin/activity?${buildPageQuery(filters, nextOffsetValue)}`;

  return (
    <div>
      <PageHeader
        title="Admin · Activity"
        description="Audit trail for auth and admin actions. Metadata is redacted by the API before display."
      />

      <Form
        method="get"
        className="mb-4 grid gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="block text-sm">
          <span className="text-nbts-muted">Search action</span>
          <input
            name="q"
            type="search"
            defaultValue={qValue}
            placeholder="e.g. login"
            className="mt-1 w-full rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">User id</span>
          <input
            name="userId"
            type="text"
            inputMode="numeric"
            defaultValue={userIdValue}
            placeholder="Optional"
            className="mt-1 w-full rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">Exact action</span>
          <input
            name="action"
            type="text"
            defaultValue={actionValue}
            placeholder="auth.login_success"
            className="mt-1 w-full rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">Entity type</span>
          <input
            name="entityType"
            type="text"
            defaultValue={entityTypeValue}
            placeholder="user, donor, …"
            className="mt-1 w-full rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">Entity id</span>
          <input
            name="entityId"
            type="text"
            defaultValue={entityIdValue}
            placeholder="Optional"
            className="mt-1 w-full rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">From</span>
          <input
            name="createdFrom"
            type="datetime-local"
            defaultValue={createdFromValue}
            className="mt-1 w-full rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="text-nbts-muted">To</span>
          <input
            name="createdTo"
            type="datetime-local"
            defaultValue={createdToValue}
            className="mt-1 w-full rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
          <input type="hidden" name="limit" value={String(limit)} />
          <input type="hidden" name="offset" value="0" />
          <button
            type="submit"
            className="rounded bg-nbts-slate px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Filter
          </button>
          <Link
            to="/admin/activity"
            className="rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Clear
          </Link>
        </div>
      </Form>

      {activityLogs.length === 0 ? (
        <EmptyState
          title="No activity found"
          description="Try clearing filters, or perform an audited action (login, user change) and refresh."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Actor</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Entity</th>
                  <th className="px-3 py-2 font-semibold">IP</th>
                  <th className="px-3 py-2 font-semibold">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {activityLogs.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-nbts-border last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-nbts-ink">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-nbts-ink">
                      {formatActivityActor(row)}
                    </td>
                    <td className="px-3 py-2 font-medium text-nbts-ink">
                      {row.action || "—"}
                    </td>
                    <td className="px-3 py-2 text-nbts-muted">
                      {formatActivityEntity(row)}
                    </td>
                    <td className="px-3 py-2 text-nbts-muted">
                      {row.ipAddress || "—"}
                    </td>
                    <td className="max-w-[18rem] truncate px-3 py-2 font-mono text-xs text-nbts-muted">
                      {formatActivityMetadata(row.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-nbts-muted">
            <p>
              Showing {activityLogs.length} of {total} (offset {offset})
            </p>
            <div className="flex gap-2">
              {hasPrev ? (
                <Link
                  to={pageHref(prevOffset)}
                  className="rounded border border-nbts-border px-3 py-1.5 font-medium text-nbts-ink hover:border-nbts-muted"
                >
                  Previous
                </Link>
              ) : null}
              {hasNext ? (
                <Link
                  to={pageHref(nextOffset)}
                  className="rounded border border-nbts-border px-3 py-1.5 font-medium text-nbts-ink hover:border-nbts-muted"
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
