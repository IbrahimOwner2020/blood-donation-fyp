import { describe, expect, it } from "vitest";

import {
  formatInventoryBloodGroup,
  formatInventoryStatus,
  type PublicInventoryUnit,
} from "~/lib/inventory";
import {
  formatPredictedUnits,
  formatPredictionBloodGroup,
  type PublicPrediction,
} from "~/lib/predictions";
import { formatDashboardCount } from "~/lib/dashboard";

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

const prediction: PublicPrediction = {
  id: 9,
  bloodGroupId: 7,
  bloodGroup: { id: 7, code: "O+", abo: "O", rh: "+" },
  facilityId: null,
  facility: null,
  modelName: "historical_average",
  modelVersion: "1",
  predictedUnits: 42.5,
  forecastStart: "2026-09-01",
  forecastEnd: "2026-09-07",
  metrics: null,
  series: [],
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("inventory list + prediction display formatters", () => {
  it("formats inventory list status and blood group", () => {
    expect(formatInventoryStatus(unit.status)).toBe("Available");
    expect(formatInventoryBloodGroup(unit)).toBe("O+");
  });

  it("formats prediction display values", () => {
    expect(formatPredictionBloodGroup(prediction)).toBe("O+");
    expect(formatPredictedUnits(prediction.predictedUnits)).toMatch(/42/);
  });

  it("formats dashboard KPI loading-friendly values", () => {
    expect(formatDashboardCount(12)).toBe("12");
    expect(formatDashboardCount(null)).toBe("0");
    expect(formatDashboardCount(undefined)).toBe("0");
  });
});
