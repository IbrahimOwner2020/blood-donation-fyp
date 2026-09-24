/**
 * Shared donor create/edit fields.
 * Eligibility wording is operational only — never medical approval.
 */

import { Input } from "~/components/ui/Input";
import { Select } from "~/components/ui/Select";
import {
  BLOOD_GROUP_OPTIONS,
  DONOR_ELIGIBILITY_STATUSES,
  formatEligibilityStatus,
  type PublicDonor,
} from "~/lib/donors";

export type DonorFormDefaults = {
  donorNumber?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  sex?: string;
  address?: string;
  weightKg?: number;
  smsConsent?: boolean;
  emailConsent?: boolean;
  bloodGroupId?: number;
  eligibilityStatus?: string;
  active?: boolean;
};

type DonorFormFieldsProps = {
  defaults?: DonorFormDefaults | PublicDonor | null;
  /** When true, include active checkbox (edit / soft-reactivate). */
  showActive?: boolean;
  showMembershipNumber?: boolean;
  idPrefix?: string;
};

export function DonorFormFields({
  defaults = null,
  showActive = false,
  showMembershipNumber = false,
  idPrefix = "donor",
}: DonorFormFieldsProps = {}) {
  const donorNumber = defaults?.donorNumber ?? "";
  const firstName = defaults?.firstName ?? "";
  const lastName = defaults?.lastName ?? "";
  const phone = defaults?.phone ?? "";
  const email = defaults?.email ?? "";
  const dateOfBirth = defaults?.dateOfBirth ?? "";
  const sex = defaults?.sex ?? "";
  const address = defaults?.address ?? "";
  const weightKg = defaults?.weightKg ?? "";
  const bloodGroupId =
    typeof defaults?.bloodGroupId === "number" ? defaults.bloodGroupId : "";
  const eligibilityStatus = defaults?.eligibilityStatus || "UNKNOWN";
  const active = defaults?.active !== false;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showMembershipNumber ? (
        <Input
          id={`${idPrefix}-number`}
          name="donorNumber"
          type="text"
          label="Membership number"
          required
          maxLength={64}
          defaultValue={donorNumber}
          autoComplete="off"
          className="bg-white"
          wrapperClassName="sm:col-span-2"
        />
      ) : (
        <p className="text-sm text-nbts-muted sm:col-span-2">
          A unique membership number will be generated automatically.
        </p>
      )}

      <Input
        id={`${idPrefix}-first-name`}
        name="firstName"
        type="text"
        label="First name"
        required
        maxLength={120}
        defaultValue={firstName}
        autoComplete="given-name"
        className="bg-white"
      />

      <Input
        id={`${idPrefix}-last-name`}
        name="lastName"
        type="text"
        label="Last name"
        required
        maxLength={120}
        defaultValue={lastName}
        autoComplete="family-name"
        className="bg-white"
      />

      <Input
        id={`${idPrefix}-phone`}
        name="phone"
        type="tel"
        label="Phone"
        required
        maxLength={32}
        defaultValue={phone || ""}
        autoComplete="tel"
        className="bg-white"
      />

      <Input
        id={`${idPrefix}-email`}
        name="email"
        type="email"
        label="Email"
        required
        maxLength={255}
        defaultValue={email || ""}
        autoComplete="email"
        className="bg-white"
      />

      <Input id={`${idPrefix}-dob`} name="dateOfBirth" type="date" label="Date of birth" required defaultValue={dateOfBirth || ""} className="bg-white" />

      <Select id={`${idPrefix}-sex`} name="sex" label="Sex" required defaultValue={sex} className="bg-white">
        <option value="" disabled>Select sex</option>
        <option value="MALE">Male</option>
        <option value="FEMALE">Female</option>
      </Select>

      <Input id={`${idPrefix}-weight`} name="weightKg" type="number" label="Current weight (kg)" required min={1} max={300} step="0.1" defaultValue={weightKg} className="bg-white" />

      <Input id={`${idPrefix}-address`} name="address" type="text" label="Address" required maxLength={1000} defaultValue={address || ""} autoComplete="street-address" className="bg-white" wrapperClassName="sm:col-span-2" />

      <Select
        id={`${idPrefix}-blood-group`}
        name="bloodGroupId"
        label="Blood group"
        required
        defaultValue={bloodGroupId === "" ? "" : String(bloodGroupId)}
        className="bg-white"
      >
        <option value="" disabled>
          Select blood group
        </option>
        {BLOOD_GROUP_OPTIONS.map((group) => (
          <option key={group.id} value={group.id}>
            {group.code}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 text-sm">
        <input name="smsConsent" type="checkbox" value="true" defaultChecked={defaults?.smsConsent === true} />
        <span>Donor consents to SMS reminders</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="emailConsent" type="checkbox" value="true" defaultChecked={defaults?.emailConsent === true} />
        <span>Donor consents to email reminders</span>
      </label>

      <Select
        id={`${idPrefix}-eligibility`}
        name="eligibilityStatus"
        label="Eligibility status"
        defaultValue={eligibilityStatus}
        className="bg-white"
        hint="“Potentially eligible” is an operational outreach flag, not a medical clearance."
      >
        {DONOR_ELIGIBILITY_STATUSES.map((status) => (
          <option key={status} value={status}>
            {formatEligibilityStatus(status)}
          </option>
        ))}
      </Select>

      {showActive ? (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            id={`${idPrefix}-active`}
            name="active"
            type="checkbox"
            value="true"
            defaultChecked={active}
            className="h-4 w-4 rounded border-nbts-border text-nbts-blood focus:ring-nbts-teal"
          />
          <span className="font-medium text-nbts-ink">Active</span>
          <span className="text-nbts-muted">
            Uncheck to soft-deactivate (history is retained).
          </span>
        </label>
      ) : null}
    </div>
  );
}
