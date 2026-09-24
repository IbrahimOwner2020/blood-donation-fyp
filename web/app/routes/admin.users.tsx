import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import {
  formatRoleNames,
  formatUserStatus,
  listAdminUsers,
  type AdminUser,
  type UserStatus,
} from "~/lib/admin";
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";

export const meta: MetaFunction = () => [
  { title: "Users · Blood Donation Management System" },
];

type UsersLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      users: AdminUser[];
      filters: { q: string; status: string };
    }
  | { status: "forbidden"; session: AuthSession | null }
  | { status: "error"; message: string; detail?: string }
  | { status: "unauthenticated" };

function parseStatusFilter(raw: string | null): UserStatus | "" {
  const value = (raw || "").trim().toUpperCase();
  if (value === "ACTIVE" || value === "INACTIVE") {
    return value;
  }
  return "";
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<UsersLoaderData> {
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

  const canManageUsers =
    hasUiPermission(session, UI_PERMISSIONS.usersManage) ||
    hasUiPermission(session, UI_PERMISSIONS.usersManageFacility);

  if (!canManageUsers) {
    return { status: "forbidden", session };
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = parseStatusFilter(url.searchParams.get("status"));

  try {
    const users = await listAdminUsers({ q, status });
    return {
      status: "ok",
      session,
      users,
      filters: { q, status },
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { status: "forbidden", session };
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to load users.";
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return { status: "error", message, detail };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading users…" />;
}

export default function AdminUsersPage() {
  const data = useLoaderData<UsersLoaderData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering = navigation.state === "loading";

  if (data?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to manage users."
      />
    );
  }

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Admin · Users"
          description="User administration. Permission checks are enforced by the server."
        />
        <ForbiddenState
          title="Missing permission"
          message="User management permission is required to list or edit users. The server remains the authority."
          detail="UI gate: users:manage | users:manage:facility"
        />
      </div>
    );
  }

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader title="Admin · Users" />
        <ErrorState
          title="Could not load users"
          message={data.message || "Request failed."}
          detail={data.detail}
        />
      </div>
    );
  }

  if (data?.status !== "ok") {
    return <LoadingState label="Loading users…" />;
  }

  const canAssignRoles = hasUiPermission(
    data.session,
    UI_PERMISSIONS.rolesManage,
  ) || hasUiPermission(data.session, UI_PERMISSIONS.rolesAssignFacility);
  const users = data.users ?? [];
  const qValue = searchParams.get("q") ?? data.filters.q ?? "";
  const statusValue = searchParams.get("status") ?? data.filters.status ?? "";

  return (
    <div>
      <PageHeader
        title="Admin · Users"
        description="Create and manage staff accounts. The server scopes facility managers to their assigned facility."
        actions={
          <Link
            to="/admin/users/new"
            className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
          >
            New user
          </Link>
        }
      />

      <Form
        method="get"
        className="mb-4 flex flex-col gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:flex-row sm:items-end"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={qValue}
            placeholder="Name or email"
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          />
        </label>
        <label className="flex w-full flex-col gap-1 text-sm sm:w-44">
          <span className="font-medium text-nbts-ink">Status</span>
          <select
            name="status"
            defaultValue={statusValue}
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink"
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
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

      {!isFiltering && users.length === 0 ? (
        <EmptyState
          title="No users found"
          description="Try a different search, or create a new staff account."
          action={
            <Link
              to="/admin/users/new"
              className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark"
            >
              New user
            </Link>
          }
        />
      ) : null}

      {!isFiltering && users.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Roles</th>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-nbts-border last:border-b-0"
                >
                  <td className="px-4 py-3 font-medium text-nbts-ink">
                    {user.name || "—"}
                  </td>
                  <td className="px-4 py-3 text-nbts-muted">
                    {user.email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        user.status === "ACTIVE"
                          ? "text-nbts-teal"
                          : "text-nbts-muted"
                      }
                    >
                      {formatUserStatus(user.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-nbts-muted">
                    {formatRoleNames(user.roles)}
                    {!canAssignRoles && user.roles?.length ? (
                      <span className="sr-only">
                        {" "}
                        (role edits require role assignment permission)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/admin/users/${user.id}`}
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
