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

import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { Input } from "~/components/ui/Input";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import {
  createAdminRole,
  listAdminPermissions,
  listAdminRoles,
  permissionCodesFromFormData,
  updateAdminRole,
  type PermissionListItem,
  type RoleListItem,
} from "~/lib/admin";
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";

export const meta: MetaFunction = () => [
  { title: "Roles · NBTS Blood AI" },
];

type RolesLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      roles: RoleListItem[];
      permissions: PermissionListItem[];
      canManageUsers: boolean;
      canManageFacilityUsers: boolean;
      canManageRoles: boolean;
      canAssignFacilityRoles: boolean;
    }
  | { status: "forbidden" }
  | { status: "error"; message: string; detail?: string }
  | { status: "unauthenticated" };

type RolesActionData = {
  error?: string;
  intent?: "create" | "update";
  roleId?: number;
};

export async function clientLoader(
  _args: ClientLoaderFunctionArgs,
): Promise<RolesLoaderData> {
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

  const canManageUsers = hasUiPermission(session, UI_PERMISSIONS.usersManage);
  const canManageFacilityUsers = hasUiPermission(
    session,
    UI_PERMISSIONS.usersManageFacility,
  );
  const canManageRoles = hasUiPermission(session, UI_PERMISSIONS.rolesManage);
  const canAssignFacilityRoles = hasUiPermission(
    session,
    UI_PERMISSIONS.rolesAssignFacility,
  );

  // GET /roles allows global/scoped user management or role assignment access.
  if (
    !canManageUsers &&
    !canManageFacilityUsers &&
    !canManageRoles &&
    !canAssignFacilityRoles
  ) {
    return { status: "forbidden" };
  }

  try {
    const [roles, permissions] = await Promise.all([
      listAdminRoles(),
      canManageRoles
        ? listAdminPermissions()
        : Promise.resolve([] as PermissionListItem[]),
    ]);
    return {
      status: "ok",
      session,
      roles,
      permissions,
      canManageUsers,
      canManageFacilityUsers,
      canManageRoles,
      canAssignFacilityRoles,
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { status: "forbidden" };
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to load roles.";
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return { status: "error", message, detail };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading roles…" />;
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.rolesManage)) {
    return data<RolesActionData>(
      { error: "You do not have permission to manage roles (roles:manage)." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const descriptionRaw = String(formData.get("description") || "");
  const description = descriptionRaw.trim() || null;
  const permissionCodes = permissionCodesFromFormData(formData);

  if (intent === "create") {
    if (!name) {
      return data<RolesActionData>(
        { error: "Role name is required.", intent: "create" },
        { status: 400 },
      );
    }
    try {
      await createAdminRole({ name, description, permissionCodes });
      return null;
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.message
          : "Unable to create role.";
      return data<RolesActionData>(
        { error: message, intent: "create" },
        { status: 400 },
      );
    }
  }

  if (intent === "update") {
    const roleId = Number.parseInt(String(formData.get("roleId") || ""), 10);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return data<RolesActionData>(
        { error: "Invalid role id.", intent: "update" },
        { status: 400 },
      );
    }
    if (!name) {
      return data<RolesActionData>(
        {
          error: "Role name is required.",
          intent: "update",
          roleId,
        },
        { status: 400 },
      );
    }
    try {
      await updateAdminRole(roleId, { name, description, permissionCodes });
      return null;
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.message
          : "Unable to update role.";
      return data<RolesActionData>(
        { error: message, intent: "update", roleId },
        { status: 400 },
      );
    }
  }

  return data<RolesActionData>(
    { error: "Unknown action." },
    { status: 400 },
  );
}

export default function AdminRolesPage() {
  const data = useLoaderData<RolesLoaderData>();
  const actionData = useActionData<RolesActionData>();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" || navigation.state === "loading";

  if (data?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to view roles."
      />
    );
  }

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Admin · Roles"
          description="Role catalogue for assignment UIs. Authority remains server-side."
        />
        <ForbiddenState
          title="Missing permission"
          message="User or role assignment permission is required to list roles."
          detail="UI gate: users:manage | users:manage:facility | roles:manage | roles:assign:facility"
        />
      </div>
    );
  }

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader title="Admin · Roles" />
        <ErrorState
          title="Could not load roles"
          message={data.message}
          detail={data.detail}
        />
      </div>
    );
  }

  if (data?.status !== "ok") {
    return <LoadingState label="Loading roles…" />;
  }

  const roles = data.roles ?? [];
  const permissions = data.permissions ?? [];

  return (
    <div>
      <PageHeader
        title="Admin · Roles"
        description="List, create, and edit roles via GET/POST/PATCH /roles. Assign roles from a user detail page when permitted."
        actions={
          data.canManageUsers || data.canManageFacilityUsers ? (
            <Link
              to="/admin/users"
              className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Manage users
            </Link>
          ) : null
        }
      />

      {!data.canManageRoles ? (
        <p className="mb-4 rounded border border-dashed border-nbts-border bg-nbts-panel px-4 py-3 text-xs text-nbts-muted">
          You can view assignable roles, but creating roles or editing
          permission mappings requires roles:manage. The API enforces both
          checks.
        </p>
      ) : null}

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState
            title={
              actionData.intent === "update"
                ? "Could not update role"
                : "Could not create role"
            }
            message={actionData.error}
          />
        </div>
      ) : null}

      {data.canManageRoles ? (
        <section className="mb-8 max-w-xl rounded-lg border border-nbts-border bg-nbts-panel p-5">
          <h2 className="text-base font-semibold text-nbts-ink">Create role</h2>
          <p className="mt-1 text-sm text-nbts-muted">
            Name, optional description, and permission mapping.
          </p>
          <Form method="post" className="mt-4 grid gap-3">
            <input type="hidden" name="intent" value="create" />
            <Input
              id="role-create-name"
              name="name"
              type="text"
              label="Name"
              required
              maxLength={100}
              autoComplete="off"
              className="bg-white"
            />
            <Input
              id="role-create-description"
              name="description"
              type="text"
              label="Description"
              maxLength={500}
              autoComplete="off"
              className="bg-white"
            />
            {permissions.length > 0 ? (
              <fieldset className="grid gap-2 rounded border border-nbts-border bg-white p-3">
                <legend className="px-1 text-sm font-medium text-nbts-ink">
                  Permissions
                </legend>
                {permissions.map((permission) => (
                  <label
                    key={permission.code}
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="permissionCodes"
                      value={permission.code}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-mono text-xs text-nbts-ink">
                        {permission.code}
                      </span>
                      {permission.description ? (
                        <span className="block text-xs text-nbts-muted">
                          {permission.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-nbts-blood px-4 py-2.5 text-sm font-semibold text-white hover:bg-nbts-blood-dark disabled:opacity-60"
              >
                {busy && actionData?.intent !== "update"
                  ? "Saving…"
                  : "Create role"}
              </button>
            </div>
          </Form>
        </section>
      ) : null}

      {roles.length === 0 ? (
        <EmptyState
          title="No roles"
          description="The roles endpoint returned an empty list. Seed roles/permissions on the API if this is unexpected."
        />
      ) : (
        <ul className="divide-y divide-nbts-border overflow-hidden rounded-lg border border-nbts-border bg-nbts-panel">
          {roles.map((role) => (
            <li key={role.id} className="px-4 py-4">
              {data.canManageRoles ? (
                <Form method="post" className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="roleId" value={role.id} />
                  <Input
                    id={`role-edit-name-${role.id}`}
                    name="name"
                    type="text"
                    label="Name"
                    required
                    maxLength={100}
                    defaultValue={role.name}
                    autoComplete="off"
                    className="bg-white"
                  />
                  <Input
                    id={`role-edit-description-${role.id}`}
                    name="description"
                    type="text"
                    label="Description"
                    maxLength={500}
                    defaultValue={role.description ?? ""}
                    autoComplete="off"
                    className="bg-white"
                  />
                  {permissions.length > 0 ? (
                    <fieldset className="sm:col-span-2 grid gap-2 rounded border border-nbts-border bg-white p-3">
                      <legend className="px-1 text-sm font-medium text-nbts-ink">
                        Permissions
                      </legend>
                      {permissions.map((permission) => (
                        <label
                          key={permission.code}
                          className="flex items-start gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            name="permissionCodes"
                            value={permission.code}
                            defaultChecked={(role.permissionCodes ?? []).includes(
                              permission.code,
                            )}
                            className="mt-1"
                          />
                          <span>
                            <span className="font-mono text-xs text-nbts-ink">
                              {permission.code}
                            </span>
                            {permission.description ? (
                              <span className="block text-xs text-nbts-muted">
                                {permission.description}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded border border-nbts-border bg-white px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted disabled:opacity-60"
                    >
                      {busy && actionData?.roleId === role.id
                        ? "Saving…"
                        : "Save changes"}
                    </button>
                    <p className="font-mono text-xs text-nbts-muted">
                      id: {role.id}
                    </p>
                  </div>
                </Form>
              ) : (
                <>
                  <p className="font-medium text-nbts-ink">{role.name}</p>
                  <p className="mt-1 text-sm text-nbts-muted">
                    {role.description?.trim() || "No description provided."}
                  </p>
                  <p className="mt-2 font-mono text-xs text-nbts-muted">
                    id: {role.id}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
