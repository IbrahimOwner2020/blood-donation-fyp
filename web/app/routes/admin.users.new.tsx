import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { ErrorState } from "~/components/ui/ErrorState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import {
  createAdminUser,
  listAdminRoles,
  parsePositiveInt,
  roleIdsFromFormData,
  type RoleListItem,
  type UserStatus,
} from "~/lib/admin";
import { ApiRequestError } from "~/lib/api";
import { listFacilities, type PublicFacility } from "~/lib/blood-requests";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";

export const meta: MetaFunction = () => [
  { title: "New user · Blood Donation Management System" },
];

type NewUserLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      roles: RoleListItem[];
      facilities: PublicFacility[];
      canAssignRoles: boolean;
      isFacilityScoped: boolean;
    }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "unauthenticated" };

type NewUserActionData = {
  error?: string;
  fieldErrors?: string[];
};

export async function clientLoader(
  _args: ClientLoaderFunctionArgs,
): Promise<NewUserLoaderData> {
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

  const canManageAllUsers = hasUiPermission(session, UI_PERMISSIONS.usersManage);
  const canManageFacilityUsers = hasUiPermission(
    session,
    UI_PERMISSIONS.usersManageFacility,
  );

  if (!canManageAllUsers && !canManageFacilityUsers) {
    return { status: "forbidden" };
  }

  const canAssignRoles =
    hasUiPermission(session, UI_PERMISSIONS.rolesManage) ||
    hasUiPermission(session, UI_PERMISSIONS.rolesAssignFacility);
  const canReadFacilities = hasUiPermission(session, UI_PERMISSIONS.facilitiesRead);
  const isFacilityScoped = !canManageAllUsers && canManageFacilityUsers;
  let roles: RoleListItem[] = [];
  let facilities: PublicFacility[] = [];

  if (canAssignRoles) {
    try {
      [roles, facilities] = await Promise.all([
        listAdminRoles(),
        listFacilities({ active: true }),
      ]);
    } catch (error) {
      // Role list is optional for create when assignment UI fails — still allow create.
      if (!(error instanceof ApiRequestError && error.status === 403)) {
        const message =
          error instanceof ApiRequestError
            ? error.message
            : "Unable to load roles for assignment.";
        return { status: "error", message };
      }
    }
  } else if (canReadFacilities) {
    facilities = await listFacilities({ active: true }).catch(
      () => [] as PublicFacility[],
    );
  }

  return {
    status: "ok",
    session,
    roles,
    facilities,
    canAssignRoles,
    isFacilityScoped,
  };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading new user form…" />;
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  const canManageUsers =
    Boolean(session) &&
    (hasUiPermission(session, UI_PERMISSIONS.usersManage) ||
      hasUiPermission(session, UI_PERMISSIONS.usersManageFacility));
  if (!session || !canManageUsers) {
    return data<NewUserActionData>(
      { error: "You do not have permission to create users." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const statusRaw = String(formData.get("status") || "ACTIVE")
    .trim()
    .toUpperCase();
  const status: UserStatus =
    statusRaw === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const canAssignRoles =
    hasUiPermission(session, UI_PERMISSIONS.rolesManage) ||
    hasUiPermission(session, UI_PERMISSIONS.rolesAssignFacility);
  const roleIds = canAssignRoles ? roleIdsFromFormData(formData) : [];
  const facilityRaw = String(formData.get("facilityId") || "").trim();
  const facilityId = facilityRaw ? parsePositiveInt(facilityRaw) : NaN;

  if (!name || !email || !password) {
    return data<NewUserActionData>(
      { error: "Name, email, and password are required." },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return data<NewUserActionData>(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (facilityRaw && !Number.isFinite(facilityId)) {
    return data<NewUserActionData>(
      { error: "Facility is invalid." },
      { status: 400 },
    );
  }

  try {
    const user = await createAdminUser({
      name,
      email,
      password,
      status,
      facilityId: Number.isFinite(facilityId) ? facilityId : null,
      roleIds: canAssignRoles && roleIds.length > 0 ? roleIds : undefined,
    });
    throw redirect(`/admin/users/${user.id}`);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to create user.";
    const fieldErrors =
      error instanceof ApiRequestError
        ? (error.details ?? [])
            .map((detail) => detail?.message || "")
            .filter(Boolean)
        : [];
    return data<NewUserActionData>(
      { error: message, fieldErrors },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

export default function AdminUsersNewPage() {
  const data = useLoaderData<NewUserLoaderData>();
  const actionData = useActionData<NewUserActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  if (data?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to create users."
      />
    );
  }

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="New user" />
        <ForbiddenState
          title="Missing permission"
          message="users:manage is required to create users."
          detail="UI gate: users:manage | users:manage:facility"
          action={
            <Link to="/admin/users" className="text-sm text-nbts-teal underline">
              Back to users
            </Link>
          }
        />
      </div>
    );
  }

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader title="New user" />
        <ErrorState title="Could not load form" message={data.message} />
      </div>
    );
  }

  if (data?.status !== "ok") {
    return <LoadingState label="Loading new user form…" />;
  }

  const roles = data.roles ?? [];
  const facilities = data.facilities ?? [];
  const defaultFacilityId =
    data.isFacilityScoped && facilities.length > 0
      ? String(facilities[0].id)
      : "";

  return (
    <div>
      <PageHeader
        title="New user"
        description="Creates a staff account via POST /users. Password is never shown after save."
        actions={
          <Link
            to="/admin/users"
            className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Cancel
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState
            title="Could not create user"
            message={actionData.error}
            detail={actionData.fieldErrors?.join("; ")}
          />
        </div>
      ) : null}

      <Form
        method="post"
        className="max-w-xl space-y-4 rounded-lg border border-nbts-border bg-nbts-panel p-5"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Name</span>
          <input
            name="name"
            required
            autoComplete="name"
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Password</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
          />
          <span className="text-xs text-nbts-muted">At least 8 characters.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Status</span>
          <select
            name="status"
            defaultValue="ACTIVE"
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-nbts-ink">Healthcare facility</span>
          <select
            name="facilityId"
            defaultValue={defaultFacilityId}
            className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
          >
            {data.isFacilityScoped ? null : <option value="">No facility</option>}
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name} ({facility.district}, {facility.region})
              </option>
            ))}
          </select>
          <span className="text-xs text-nbts-muted">
            {data.isFacilityScoped
              ? "Your facility is applied by the server."
              : "Required when assigning Hospital Staff or Facility Manager."}
          </span>
        </label>

        {data.canAssignRoles ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-nbts-ink">
              Initial roles
            </legend>
            <p className="text-xs text-nbts-muted">
              Optional. The server limits facility managers to facility-safe roles.
            </p>
            {roles.length === 0 ? (
              <p className="text-sm text-nbts-muted">No roles available.</p>
            ) : (
              <ul className="space-y-2">
                {roles.map((role) => (
                  <li key={role.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="roleIds"
                        value={String(role.id)}
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
          </fieldset>
        ) : (
          <p className="rounded border border-dashed border-nbts-border px-3 py-2 text-xs text-nbts-muted">
            Role assignment is hidden without role assignment permission. You
            can still create the user, then ask an administrator to assign roles.
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded bg-nbts-blood px-4 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create user"}
        </button>
      </Form>
    </div>
  );
}
