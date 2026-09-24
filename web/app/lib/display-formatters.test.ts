import { describe, expect, it } from "vitest";

import {
  formatInventoryBloodGroup,
  formatInventoryStatus,
  type PublicInventoryUnit,
} from "~/lib/inventory";

const unit: PublicInventoryUnit = {
  id: 11,
  donationId: 3,
  bloodGroupId: 7,
  bloodGroup: { id: 7, code: "O+", abo: "O", rh: "+" },
  collectionDate: "2026-01-01",
  expiryDate: "2026-02-01",
  status: "AVAILABLE",
  facilityId: null,
  facility: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("inventory display formatters", () => {
  it("formats inventory list status and blood group", () => {
    expect(formatInventoryStatus(unit.status)).toBe("Available");
    expect(formatInventoryBloodGroup(unit)).toBe("O+");
  });
});
