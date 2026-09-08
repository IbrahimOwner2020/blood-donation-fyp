import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DonorFormFields } from "~/components/donors/DonorFormFields";
import {
  formatBloodGroup,
  formatDonorName,
  type PublicDonor,
} from "~/lib/donors";

const sampleDonor: PublicDonor = {
  id: 1,
  donorNumber: "DN-100",
  firstName: "Asha",
  lastName: "Mwangi",
  phone: "+255711111111",
  email: "asha@example.local",
  bloodGroupId: 7,
  bloodGroup: { id: 7, code: "O+", abo: "O", rh: "+" },
  eligibilityStatus: "POTENTIALLY_ELIGIBLE",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("donor form + formatters", () => {
  it("renders create/edit donor fields with operational eligibility wording", () => {
    render(
      <DonorFormFields
        idPrefix="test-donor"
        defaults={sampleDonor}
        showActive
      />,
    );

    expect(screen.getByLabelText(/Donor number/i)).toBeTruthy();
    expect(screen.getByLabelText(/First name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Last name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Blood group/i)).toBeTruthy();
    expect(screen.getByLabelText(/Eligibility status/i)).toBeTruthy();
    expect(
      screen.getAllByText(/Potentially eligible/i).length,
    ).toBeGreaterThan(0);
  });

  it("formats donor display name and blood group", () => {
    expect(formatDonorName(sampleDonor)).toBe("Asha Mwangi");
    expect(formatDonorName(null)).toBe("Donor");
    expect(formatBloodGroup(sampleDonor)).toBe("O+");
    expect(
      formatBloodGroup({
        ...sampleDonor,
        bloodGroup: null,
        bloodGroupId: 1,
      }),
    ).toBe("A+");
  });
});
