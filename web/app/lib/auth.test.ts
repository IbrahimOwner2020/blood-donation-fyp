import { describe, expect, it } from "vitest";

import {
  hasUiPermission,
  toAuthSession,
  UI_PERMISSIONS,
  type AuthSession,
  type PublicUserDto,
} from "~/lib/auth";

const baseUser: PublicUserDto = {
  id: 7,
  name: "Demo Admin",
  email: "admin@nbts.local",
  status: "ACTIVE",
};

describe("auth session mapping (login / permission UI)", () => {
  it("maps /auth/me user payload into a UI session", () => {
    const session = toAuthSession(baseUser, {
      roles: ["Admin"],
      permissions: [UI_PERMISSIONS.donorsCreate, UI_PERMISSIONS.inventoryRead],
    });

    expect(session).toEqual({
      userId: "7",
      email: "admin@nbts.local",
      displayName: "Demo Admin",
      roleLabels: ["Admin"],
      permissions: ["donors:create", "inventory:read"],
    });
  });

  it("returns null for missing user (unauthenticated)", () => {
    expect(toAuthSession(null)).toBeNull();
    expect(toAuthSession(undefined)).toBeNull();
  });

  it("gates UI by permission codes without inventing authority", () => {
    const session: AuthSession = {
      userId: "7",
      email: "admin@nbts.local",
      displayName: "Demo Admin",
      roleLabels: ["Admin"],
      permissions: [UI_PERMISSIONS.donorsCreate],
    };

    expect(hasUiPermission(session, UI_PERMISSIONS.donorsCreate)).toBe(true);
    expect(hasUiPermission(session, UI_PERMISSIONS.usersManage)).toBe(false);
    expect(hasUiPermission(null, UI_PERMISSIONS.donorsCreate)).toBe(false);
    expect(hasUiPermission(session, "")).toBe(false);
  });
});
