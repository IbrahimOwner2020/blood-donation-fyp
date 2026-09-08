/**
 * Auth session helpers for the web app.
 * Presentation-only: real session validation and RBAC live in the API.
 * Uses HTTP-only `nbts_session` cookie via credentials: 'include' (docs/10).
 */

import { ApiRequestError, apiFetch } from "~/lib/api";

/** Common UI gate codes that mirror API permission codes (display only). */
export const UI_PERMISSIONS = {
  usersManage: "users:manage",
  rolesManage: "roles:manage",
  activityRead: "activity:read",
  donorsRead: "donors:read",
  donorsCreate: "donors:create",
  donorsUpdate: "donors:update",
  donationsRead: "donations:read",
  donationsCreate: "donations:create",
  inventoryRead: "inventory:read",
  inventoryUpdate: "inventory:update",
  requestsRead: "requests:read",
  requestsCreate: "requests:create",
  requestsUpdate: "requests:update",
  predictionsRead: "predictions:read",
  predictionsRun: "predictions:run",
  alertsRead: "alerts:read",
  alertsUpdate: "alerts:update",
  notificationsRead: "notifications:read",
  notificationsSend: "notifications:send",
  reportsRead: "reports:read",
} as const;

export type UiPermissionCode =
  (typeof UI_PERMISSIONS)[keyof typeof UI_PERMISSIONS];

/** UI session shape — display fields only, not authorization authority. */
export type AuthSession = {
  userId: string;
  email: string;
  displayName: string;
  /**
   * Display labels only — not authoritative permission checks.
   * Populated from /auth/me roles when available.
   */
  roleLabels: string[];
  /**
   * Permission codes from /auth/me for UI gating only.
   * API still enforces every protected action.
   */
  permissions: string[];
};

/** @deprecated Use AuthSession — kept as an alias during shell → login migration. */
export type MockSession = AuthSession;

/** Legacy mock cookie from web-shell; cleared on logout when present. */
export const LEGACY_MOCK_SESSION_COOKIE = "nbts_mock_session";

export type PublicUserDto = {
  id: number;
  name: string;
  email: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

type LoginResponse = {
  user: PublicUserDto;
  roles?: string[];
  permissions?: string[];
};

type MeResponse = {
  user: PublicUserDto;
  roles?: string[];
  permissions?: string[];
};

type LogoutResponse = {
  ok: boolean;
};

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toAuthSession(
  user: PublicUserDto | null | undefined,
  access: { roles?: unknown; permissions?: unknown } = {},
): AuthSession | null {
  if (!user || typeof user.id !== "number") {
    return null;
  }

  const email = user.email?.trim() || "";
  const displayName = user.name?.trim() || email || "Signed in";
  const roleLabels = normalizeStringList(access.roles);
  const permissions = normalizeStringList(access.permissions);

  return {
    userId: String(user.id),
    email,
    displayName,
    roleLabels,
    permissions,
  };
}

/** Map API public user → UI session. */
export function sessionFromUser(
  user: PublicUserDto,
  access: { roles?: unknown; permissions?: unknown } = {},
): AuthSession {
  const session = toAuthSession(user, access);
  if (!session) {
    throw new Error("Invalid user payload from API");
  }
  return session;
}

/**
 * GET /auth/me with cookies.
 * Returns null when unauthenticated (401); throws on network/server errors.
 */
export async function fetchAuthSession(): Promise<AuthSession | null> {
  try {
    const data = await apiFetch<MeResponse>("/auth/me", { method: "GET" });
    return toAuthSession(data?.user, {
      roles: data?.roles,
      permissions: data?.permissions,
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

/** POST /auth/login — sets HTTP-only session cookie on the API origin. */
export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<AuthSession> {
  const data = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    json: { email, password },
  });
  return sessionFromUser(data.user, {
    roles: data?.roles,
    permissions: data?.permissions,
  });
}

/** POST /auth/logout — revokes session and clears API cookie. */
export async function logoutFromApi(): Promise<void> {
  try {
    await apiFetch<LogoutResponse>("/auth/logout", { method: "POST" });
  } catch (error) {
    // Best-effort logout: still clear local navigation even if API is down.
    if (error instanceof ApiRequestError && error.status === 401) {
      return;
    }
    // Network errors: allow redirect to login anyway after logging.
    if (error instanceof ApiRequestError && error.code === "NETWORK_ERROR") {
      return;
    }
    throw error;
  }
}

/** Clear leftover web-shell mock cookie (HttpOnly on the web origin). */
export function clearLegacyMockSessionCookie(): string {
  return `${LEGACY_MOCK_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Presentation-only permission check against session.permissions from /me.
 * Never treat as authorization authority — the API enforces access.
 */
export function hasUiPermission(
  session: AuthSession | null | undefined,
  permission: string = "",
): boolean {
  const code = permission?.trim() || "";
  if (!session?.userId || !code) {
    return false;
  }
  const permissions = session.permissions ?? [];
  return permissions.includes(code);
}

/**
 * Stub gate for UI only — never treat as API authorization.
 * When `gateCode` is a permission-like string (contains ":"), checks permissions.
 * Otherwise requires an authenticated session.
 */
export function hasUiGate(
  session: AuthSession | null | undefined,
  gateCode: string = "",
): boolean {
  if (!session?.userId) {
    return false;
  }
  const code = gateCode?.trim() || "";
  if (!code || code === "authenticated") {
    return true;
  }
  return hasUiPermission(session, code);
}
