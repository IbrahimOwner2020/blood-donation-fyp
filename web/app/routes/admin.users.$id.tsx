import {
  Form,
  Link,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/Button";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import {
  assignAdminUserRoles,
  deactivateAdminUser,
  formatUserStatus,
  getAdminUser,
  listAdminRoles,
  parsePositiveInt,
  patchAdminUser,
  roleIdsFromFormData,
  type AdminUser,
  type RoleListItem,
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
  { title: "User · NBTS Blood AI" },
];

type UserDetailLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      user: AdminUser;
      roles: RoleListItem[];
      canAssignRoles: boolean;
    }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "error"; message: string; detail?: string }
  | { status: "unauthenticated" };

type UserDetailActionData = {
  error?: string;
  success?: string;
  fieldErrors?: string[];
};

function intentOf(formData: FormData): string {
  return String(formData.get("intent") || "").trim();
}

export async function clientLoader({
  params,
}: ClientLoaderFunctionArgs): Promise<UserDetailLoaderData> {
  const userId = parsePositiveInt(params?.id);
  if (!Number.isFinite(userId)) {
    return { status: "not_found" };
  }

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

  if (!hasUiPermission(session, UI_PERMISSIONS.usersManage)) {
    return { status: "forbidden" };
  }

  const canAssignRoles = hasUiPermission(session, UI_PERMISSIONS.rolesManage);

  try {
    const user = await getAdminUser(userId);
    let roles: RoleListItem[] = [];
    if (canAssignRoles) {
      try {
        roles = await listAdminRoles();
      } catch {
        roles = [];
      }
    }
    return { status: "ok", session, user, roles, canAssignRoles };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { status: "forbidden" };
    }
    if (error instanceof ApiRequestError && error.status === 404) {
      return { status: "not_found" };
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to load user.";
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return { status: "error", message, detail };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading user…" />;
}

export async function clientAction({
  request,
  params,
}: ClientActionFunctionArgs) {
  const userId = parsePositiveInt(params?.id);
  if (!Number.isFinite(userId)) {
    return data<UserDetailActionData>(
      { error: "Invalid user id." },
      { status: 400 },
    );
  }

  const session = await fetchAuthSession().catch(() => null);
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.usersManage)) {
    return data<UserDetailActionData>(
      { error: "You do not have permission to manage users." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const intent = intentOf(formData);

  try {
    if (intent === "update") {
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");
      const statusRaw = String(formData.get("status") || "ACTIVE")
        .trim()
        .toUpperCase();
      const status: UserStatus =
        statusRaw === "INACTIVE" ? "INACTIVE" : "ACTIVE";

      if (!name || !email) {
        return data<UserDetailActionData>(
          { error: "Name and email are required." },
          { status: 400 },
        );
      }

      if (password && password.length < 8) {
        return data<UserDetailActionData>(
          { error: "Password must be at least 8 characters when set." },
          { status: 400 },
        );
      }

      await patchAdminUser(userId, {
        name,
        email,
        status,
        ...(password ? { password } : {}),
      });
      return data<UserDetailActionData>({ success: "User updated." });
    }

    if (intent === "deactivate") {
      await deactivateAdminUser(userId);
      return data<UserDetailActionData>({
        success: "User deactivated (status set to Inactive).",
      });
    }

    if (intent === "assign-roles") {
      if (!hasUiPermission(session, UI_PERMISSIONS.rolesManage)) {
        return data<UserDetailActionData>(
          { error: "roles:manage is required to assign roles." },
          { status: 403 },
        );
      }
      const roleIds = roleIdsFromFormData(formData);
      await assignAdminUserRoles(userId, { roleIds });
      return data<UserDetailActionData>({ success: "Roles updated." });
    }

    return data<UserDetailActionData>(
      { error: "Unknown action." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to save user changes.";
    const fieldErrors =
      error instanceof ApiRequestError
        ? (error.details ?? [])
            .map((detail) => detail?.message || "")
            .filter(Boolean)
        : [];
    return data<UserDetailActionData>(
      { error: message, fieldErrors },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

export default function AdminUserDetailPage() {
  const loaderData = useLoaderData<UserDetailLoaderData>();
  const actionData = useActionData<UserDetailActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const deactivateFormRef = useRef<HTMLFormElement>(null);

  if (loaderData?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to manage users."
      />
    );
  }

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="User" />
        <ForbiddenState
          title="Missing permission"
          message="users:manage is required to view or edit users."
          detail="UI gate: users:manage"
          action={
            <Link to="/admin/users" className="text-sm text-nbts-teal underline">
              Back to users
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "not_found") {
    return (
      <div>
        <PageHeader title="User" />
        <EmptyState
          title="User not found"
          description="This account may have been removed or the id is invalid."
          action={
            <Link to="/admin/users" className="text-sm text-nbts-teal underline">
              Back to users
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader title="User" />
        <ErrorState
          title="Could not load user"
          message={loaderData.message}
          detail={loaderData.detail}
        />
      </div>
    );
  }

  if (loaderData?.status !== "ok") {
    return <LoadingState label="Loading user…" />;
  }

  const user = loaderData.user;
  const roles = loaderData.roles ?? [];
  const assignedIds = new Set(
    (user.roles ?? []).map((role) => role.id).filter((id) => Number.isFinite(id)),
  );
  const isInactive = (user.status || "").toUpperCase() === "INACTIVE";

  return (
    <div>
      <PageHeader
        title={user.name || "User"}
        description={`${user.email || "No email"} · ${formatUserStatus(user.status)}`}
        actions={
          <Link
            to="/admin/users"
            className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to users
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState
            title="Could not save"
            message={actionData.error}
            detail={actionData.fieldErrors?.join("; ")}
          />
        </div>
      ) : null}

      {actionData?.success ? (
        <p
          className="mb-4 rounded border border-nbts-teal/30 bg-nbts-teal-soft px-4 py-3 text-sm text-nbts-ink"
          role="status"
        >
          {actionData.success}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Form
          method="post"
          key={`profile-${user.id}-${user.updatedAt ?? user.status}`}
          className="space-y-4 rounded-lg border border-nbts-border bg-nbts-panel p-5"
        >
          <input type="hidden" name="intent" value="update" />
          <h2 className="text-base font-semibold text-nbts-ink">Profile</h2>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Name</span>
            <input
              name="name"
              required
              defaultValue={user.name || ""}
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Email</span>
            <input
              type="email"
              name="email"
              required
              defaultValue={user.email || ""}
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">New password</span>
            <input
              type="password"
              name="password"
              minLength={8}
              autoComplete="new-password"
              placeholder="Leave blank to keep current"
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Status</span>
            <select
              name="status"
              defaultValue={isInactive ? "INACTIVE" : "ACTIVE"}
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="rounded bg-nbts-blood px-4 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </Form>

        <div className="space-y-6">
          {loaderData.canAssignRoles ? (
            <Form
              method="post"
              key={`roles-${user.id}-${(user.roles ?? []).map((r) => r.id).join("-")}`}
              className="space-y-4 rounded-lg border border-nbts-border bg-nbts-panel p-5"
            >
              <input type="hidden" name="intent" value="assign-roles" />
              <h2 className="text-base font-semibold text-nbts-ink">
                Role assignment
              </h2>
              <p className="text-xs text-nbts-muted">
                Replaces all roles for this user (PUT /users/:id/roles). Requires
                roles:manage.
              </p>
              {roles.length === 0 ? (
                <EmptyState
                  title="No roles loaded"
                  description="Roles could not be loaded for assignment."
                />
              ) : (
                <ul className="space-y-2">
                  {roles.map((role) => (
                    <li key={role.id}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="roleIds"
                          value={String(role.id)}
                          defaultChecked={assignedIds.has(role.id)}
                          className="mt-1"
                        />
                        <span>
                          <span className="font-medium text-nbts-ink">
                            {role.name}
                          </span>
                          {role.description ? (
                            <span className="block text-xs text-nbts-muted">
                              {role.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="submit"
                disabled={busy || roles.length === 0}
                className="rounded border border-nbts-teal bg-nbts-teal-soft px-4 py-2 text-sm font-medium text-nbts-teal hover:border-nbts-teal disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save roles"}
              </button>
            </Form>
          ) : (
            <div className="rounded-lg border border-dashed border-nbts-border bg-nbts-panel p-5">
              <h2 className="text-base font-semibold text-nbts-ink">Roles</h2>
              <p className="mt-1 text-sm text-nbts-muted">
                {(user.roles ?? []).map((r) => r.name).filter(Boolean).join(", ") ||
                  "No roles assigned."}
              </p>
              <p className="mt-3 text-xs text-nbts-muted">
                Role editing requires roles:manage. Assignment UI is hidden; API
                still enforces access.
              </p>
            </div>
          )}

          {!isInactive ? (
            <>
              <Form
                ref={deactivateFormRef}
                method="post"
                className="rounded-lg border border-nbts-blood/25 bg-nbts-blood-soft p-5"
              >
                <input type="hidden" name="intent" value="deactivate" />
                <h2 className="text-base font-semibold text-nbts-blood-dark">
                  Soft deactivate
                </h2>
                <p className="mt-1 text-sm text-nbts-muted">
                  Sets status to Inactive via DELETE /users/:id. Does not
                  hard-delete the account.
                </p>
                <Button
                  type="button"
                  variant="danger"
                  className="mt-3"
                  disabled={busy}
                  onClick={() => setDeactivateOpen(true)}
                >
                  Deactivate user
                </Button>
              </Form>
              <ConfirmDialog
                open={deactivateOpen}
                title="Deactivate this user?"
                description="They will no longer be able to sign in. The account is soft-deactivated (Inactive), not hard-deleted."
                confirmLabel="Deactivate user"
                tone="danger"
                busy={busy}
                onCancel={() => setDeactivateOpen(false)}
                onConfirm={() => {
                  setDeactivateOpen(false);
                  deactivateFormRef.current?.requestSubmit();
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
