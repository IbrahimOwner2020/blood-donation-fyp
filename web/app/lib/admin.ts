/**
 * Admin users / roles API helpers (docs/04, docs/05).
 * Presentation-only — API remains authorization authority.
 */

import { apiFetch } from "~/lib/api";

export type UserStatus = "ACTIVE" | "INACTIVE";

export type AdminRoleSummary = {
  id: number;
  name: string;
};

export type AdminUser = {
  id: number;
  name: string;
  email: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  roles: AdminRoleSummary[];
};

export type RoleListItem = {
  id: number;
  name: string;
  description: string | null;
};

export type ListUsersParams = {
  status?: UserStatus | "";
  q?: string;
};

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  status?: UserStatus;
  roleIds?: number[];
};

export type PatchUserInput = {
  name?: string;
  email?: string;
  password?: string;
  status?: UserStatus;
};

export type AssignUserRolesInput = {
  roleIds: number[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRoleSummary(value: unknown): AdminRoleSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "number" || typeof value.name !== "string") {
    return null;
  }
  return { id: value.id, name: value.name.trim() || `Role ${value.id}` };
}

/** Normalize a user DTO from the API (defensive). */
export function normalizeAdminUser(value: unknown): AdminUser | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const status = typeof value.status === "string" ? value.status : "INACTIVE";
  const rolesRaw = Array.isArray(value.roles) ? value.roles : [];
  const roles = rolesRaw
    .map(toRoleSummary)
    .filter((role): role is AdminRoleSummary => role !== null);

  return {
    id: value.id,
    name: name || email || `User ${value.id}`,
    email,
    status,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    roles,
  };
}

function normalizeRoleListItem(value: unknown): RoleListItem | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description =
    typeof value.description === "string"
      ? value.description
      : value.description === null
        ? null
        : null;

  return {
    id: value.id,
    name: name || `Role ${value.id}`,
    description,
  };
}

function buildUsersQuery(params: ListUsersParams = {}): string {
  const search = new URLSearchParams();
  const status = params.status?.trim() || "";
  const q = params.q?.trim() || "";
  if (status === "ACTIVE" || status === "INACTIVE") {
    search.set("status", status);
  }
  if (q) {
    search.set("q", q);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** GET /users */
export async function listAdminUsers(
  params: ListUsersParams = {},
): Promise<AdminUser[]> {
  const data = await apiFetch<{ users?: unknown }>("/users" + buildUsersQuery(params), {
    method: "GET",
  });
  const raw = Array.isArray(data?.users) ? data.users : [];
  return raw
    .map(normalizeAdminUser)
    .filter((user): user is AdminUser => user !== null);
}

/** GET /users/:id */
export async function getAdminUser(userId: number): Promise<AdminUser> {
  const data = await apiFetch<{ user?: unknown }>(`/users/${userId}`, {
    method: "GET",
  });
  const user = normalizeAdminUser(data?.user);
  if (!user) {
    throw new Error("Invalid user payload from API");
  }
  return user;
}

/** POST /users */
export async function createAdminUser(
  input: CreateUserInput,
): Promise<AdminUser> {
  const body: Record<string, unknown> = {
    name: input.name?.trim() || "",
    email: input.email?.trim() || "",
    password: input.password || "",
  };
  if (input.status) {
    body.status = input.status;
  }
  if (Array.isArray(input.roleIds) && input.roleIds.length > 0) {
    body.roleIds = input.roleIds;
  }

  const data = await apiFetch<{ user?: unknown }>("/users", {
    method: "POST",
    json: body,
  });
  const user = normalizeAdminUser(data?.user);
  if (!user) {
    throw new Error("Invalid user payload from API");
  }
  return user;
}

/** PATCH /users/:id */
export async function patchAdminUser(
  userId: number,
  input: PatchUserInput,
): Promise<AdminUser> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) {
    body.name = input.name.trim();
  }
  if (input.email !== undefined) {
    body.email = input.email.trim();
  }
  if (input.password !== undefined && input.password.length > 0) {
    body.password = input.password;
  }
  if (input.status !== undefined) {
    body.status = input.status;
  }

  const data = await apiFetch<{ user?: unknown }>(`/users/${userId}`, {
    method: "PATCH",
    json: body,
  });
  const user = normalizeAdminUser(data?.user);
  if (!user) {
    throw new Error("Invalid user payload from API");
  }
  return user;
}

/** DELETE /users/:id — soft-deactivate */
export async function deactivateAdminUser(userId: number): Promise<AdminUser> {
  const data = await apiFetch<{ user?: unknown }>(`/users/${userId}`, {
    method: "DELETE",
  });
  const user = normalizeAdminUser(data?.user);
  if (!user) {
    throw new Error("Invalid user payload from API");
  }
  return user;
}

/** PUT /users/:id/roles */
export async function assignAdminUserRoles(
  userId: number,
  input: AssignUserRolesInput,
): Promise<AdminUser> {
  const data = await apiFetch<{ user?: unknown }>(`/users/${userId}/roles`, {
    method: "PUT",
    json: { roleIds: input.roleIds ?? [] },
  });
  const user = normalizeAdminUser(data?.user);
  if (!user) {
    throw new Error("Invalid user payload from API");
  }
  return user;
}

/** GET /roles */
export async function listAdminRoles(): Promise<RoleListItem[]> {
  const data = await apiFetch<{ roles?: unknown }>("/roles", { method: "GET" });
  const raw = Array.isArray(data?.roles) ? data.roles : [];
  return raw
    .map(normalizeRoleListItem)
    .filter((role): role is RoleListItem => role !== null);
}

export type CreateRoleInput = {
  name: string;
  description?: string | null;
};

export type UpdateRoleInput = {
  name?: string;
  description?: string | null;
};

/** POST /roles */
export async function createAdminRole(
  input: CreateRoleInput,
): Promise<RoleListItem> {
  const body: Record<string, unknown> = {
    name: input.name?.trim() || "",
  };
  if (input.description !== undefined) {
    body.description = input.description?.trim() || null;
  }

  const data = await apiFetch<{ role?: unknown }>("/roles", {
    method: "POST",
    json: body,
  });
  const role = normalizeRoleListItem(data?.role);
  if (!role) {
    throw new Error("Invalid role payload from API");
  }
  return role;
}

/** PATCH /roles/:id */
export async function updateAdminRole(
  roleId: number,
  input: UpdateRoleInput,
): Promise<RoleListItem> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) {
    body.name = input.name.trim();
  }
  if (input.description !== undefined) {
    body.description = input.description?.trim() || null;
  }

  const data = await apiFetch<{ role?: unknown }>(`/roles/${roleId}`, {
    method: "PATCH",
    json: body,
  });
  const role = normalizeRoleListItem(data?.role);
  if (!role) {
    throw new Error("Invalid role payload from API");
  }
  return role;
}

export function formatUserStatus(status: string = ""): string {
  const value = status.trim().toUpperCase();
  if (value === "ACTIVE") {
    return "Active";
  }
  if (value === "INACTIVE") {
    return "Inactive";
  }
  return status.trim() || "Unknown";
}

export function formatRoleNames(roles: AdminRoleSummary[] = []): string {
  if (!roles.length) {
    return "No roles";
  }
  return roles.map((role) => role?.name || "").filter(Boolean).join(", ") || "No roles";
}

export function parsePositiveInt(
  value: string | null | undefined,
  fallback: number = NaN,
): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/** Collect checked role ids from a FormData field named `roleIds`. */
export function roleIdsFromFormData(formData: FormData): number[] {
  const values = formData.getAll("roleIds");
  const ids: number[] = [];
  for (const value of values) {
    const id = parsePositiveInt(String(value ?? ""));
    if (Number.isFinite(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}
