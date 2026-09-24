import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useNavigation,
  type ClientActionFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ErrorState } from "~/components/ui/ErrorState";
import { Input } from "~/components/ui/Input";
import { Select } from "~/components/ui/Select";
import { ApiRequestError } from "~/lib/api";
import { registerDonorAccount } from "~/lib/auth";
import { BLOOD_GROUP_OPTIONS, parsePositiveInt } from "~/lib/donors";

export const meta: MetaFunction = () => [
  { title: "Register donor · Blood Donation Management System" },
];

type RegisterField =
  | "firstName"
  | "lastName"
  | "dateOfBirth"
  | "sex"
  | "phone"
  | "address"
  | "weightKg"
  | "bloodGroupId"
  | "email"
  | "password"
  | "confirmPassword";

type RegisterFormValues = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: string;
  phone: string;
  address: string;
  weightKg: string;
  bloodGroupId: string;
  email: string;
  smsConsent: boolean;
  emailConsent: boolean;
};

type RegisterActionData = {
  error: string;
  fieldErrors?: Partial<Record<RegisterField, string>>;
  details?: string[];
  values?: RegisterFormValues;
  showLoginLink?: boolean;
};

const registerFields = new Set<RegisterField>([
  "firstName",
  "lastName",
  "dateOfBirth",
  "sex",
  "phone",
  "address",
  "weightKg",
  "bloodGroupId",
  "email",
  "password",
  "confirmPassword",
]);

export function describeRegistrationError(
  error: unknown,
): Omit<RegisterActionData, "values"> {
  if (!(error instanceof ApiRequestError)) {
    return {
      error: "Registration could not be completed. Please try again.",
    };
  }

  const fieldErrors: Partial<Record<RegisterField, string>> = {};
  const details: string[] = [];
  let duplicateRegistration = error.status === 409;

  for (const detail of error.details) {
    const path = detail.path as RegisterField | undefined;
    if (path && registerFields.has(path) && !fieldErrors[path]) {
      fieldErrors[path] = detail.message;
    } else if (detail.message && !details.includes(detail.message)) {
      details.push(detail.message);
    }
    if (
      detail.code === "duplicate_registration" ||
      detail.code === "email_already_registered" ||
      detail.code === "phone_already_registered"
    ) {
      duplicateRegistration = true;
    }
  }

  if (duplicateRegistration) {
    return {
      error:
        "This donor appears to be registered already. Sign in to continue, use different details, or contact blood bank staff.",
      fieldErrors,
      details,
      showLoginLink: true,
    };
  }

  if (error.code === "NETWORK_ERROR" || error.status === 0) {
    return {
      error:
        "The registration service could not be reached. Check your connection and try again.",
    };
  }

  if (error.status >= 500) {
    return {
      error:
        "The server could not complete the registration. Please try again shortly. If it continues, contact blood bank staff.",
      details,
    };
  }

  return {
    error:
      error.code === "VALIDATION_ERROR"
        ? "Please correct the highlighted information and try again."
        : error.message || "Registration could not be completed.",
    fieldErrors,
    details,
  };
}

function getValue(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const formData = await request.formData();
  const values: RegisterFormValues = {
    firstName: getValue(formData, "firstName"),
    lastName: getValue(formData, "lastName"),
    dateOfBirth: getValue(formData, "dateOfBirth"),
    sex: getValue(formData, "sex"),
    phone: getValue(formData, "phone"),
    address: getValue(formData, "address"),
    weightKg: getValue(formData, "weightKg"),
    bloodGroupId: getValue(formData, "bloodGroupId"),
    email: getValue(formData, "email"),
    smsConsent: formData.get("smsConsent") === "true",
    emailConsent: formData.get("emailConsent") === "true",
  };
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const weightKg = Number(values.weightKg);
  const bloodGroupId = parsePositiveInt(values.bloodGroupId);
  const fieldErrors: Partial<Record<RegisterField, string>> = {};

  if (!values.firstName) fieldErrors.firstName = "First name is required.";
  if (!values.lastName) fieldErrors.lastName = "Last name is required.";
  if (!values.dateOfBirth) fieldErrors.dateOfBirth = "Date of birth is required.";
  if (values.sex !== "MALE" && values.sex !== "FEMALE") {
    fieldErrors.sex = "Select your sex.";
  }
  if (!values.phone) fieldErrors.phone = "Phone number is required.";
  if (!values.address) fieldErrors.address = "Address is required.";
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 300) {
    fieldErrors.weightKg = "Enter a valid weight between 1 and 300 kg.";
  }
  if (!Number.isFinite(bloodGroupId)) {
    fieldErrors.bloodGroupId = "Select a blood group.";
  }
  if (!values.email) fieldErrors.email = "Email is required.";
  if (password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters.";
  }
  if (!confirmPassword) {
    fieldErrors.confirmPassword = "Confirm your password.";
  } else if (password !== confirmPassword) {
    fieldErrors.confirmPassword = "Passwords do not match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return data<RegisterActionData>(
      {
        error: "Please correct the highlighted information and try again.",
        fieldErrors,
        values,
      },
      { status: 400 },
    );
  }

  try {
    await registerDonorAccount({
      email: values.email,
      password,
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      dateOfBirth: values.dateOfBirth,
      sex: values.sex as "MALE" | "FEMALE",
      address: values.address,
      weightKg,
      smsConsent: values.smsConsent,
      emailConsent: values.emailConsent,
      bloodGroupId,
    });
    throw redirect("/my-donor-profile");
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    const failure = describeRegistrationError(error);
    return data<RegisterActionData>(
      { ...failure, values },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

function SectionHeading({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="sm:col-span-2">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-nbts-teal text-xs font-bold text-white">
          {number}
        </span>
        <h2 className="text-base font-semibold text-nbts-ink">{title}</h2>
      </div>
      <p className="mt-1 pl-10 text-sm text-nbts-muted">{description}</p>
    </div>
  );
}

export default function RegisterDonorPage() {
  const actionData = useActionData<RegisterActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const values = actionData?.values;
  const errors = actionData?.fieldErrors ?? {};

  return (
    <main className="min-h-screen bg-nbts-surface px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Link to="/" className="text-sm font-semibold text-nbts-ink no-underline">
            Blood Donation Management System
          </Link>
          <Link to="/login" className="text-sm font-medium text-nbts-teal underline">
            Already registered? Sign in
          </Link>
        </div>

        <div className="rounded-xl border border-nbts-border bg-nbts-panel p-5 shadow-sm sm:p-8">
          <div className="mb-7 border-b border-nbts-border pb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-nbts-blood">
              Donor registration
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-nbts-ink">
              Create your donor profile
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-nbts-muted">
              Enter your personal information exactly as it should appear in your donor record.
              Fields marked with * are required.
            </p>
          </div>

          {actionData?.error ? (
            <div className="mb-6" aria-live="polite">
              <ErrorState
                title="Registration was not completed"
                message={actionData.error}
                detail={actionData.details?.join(" ")}
              />
              {actionData.showLoginLink ? (
                <Link
                  to="/login"
                  className="mt-3 inline-flex rounded-md bg-nbts-blood px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-nbts-blood-dark"
                >
                  Sign in to your account
                </Link>
              ) : null}
            </div>
          ) : null}

          <Form method="post" className="grid gap-5 sm:grid-cols-2">
            <SectionHeading
              number={1}
              title="Personal information"
              description="Start with your name and core donor details."
            />

            <Input id="register-first-name" name="firstName" label="First name" required maxLength={120} autoComplete="given-name" defaultValue={values?.firstName} error={errors.firstName} className="bg-white" />
            <Input id="register-last-name" name="lastName" label="Last name" required maxLength={120} autoComplete="family-name" defaultValue={values?.lastName} error={errors.lastName} className="bg-white" />
            <Input id="register-date-of-birth" name="dateOfBirth" type="date" label="Date of birth" required defaultValue={values?.dateOfBirth} error={errors.dateOfBirth} className="bg-white" />
            <Select id="register-sex" name="sex" label="Sex" required defaultValue={values?.sex ?? ""} error={errors.sex} className="bg-white">
              <option value="" disabled>Select sex</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </Select>
            <Input id="register-phone" name="phone" type="tel" label="Phone number" required maxLength={32} autoComplete="tel" placeholder="0712 345 678" hint="Use a Tanzanian mobile number." defaultValue={values?.phone} error={errors.phone} className="bg-white" />
            <Input id="register-address" name="address" label="Address" required maxLength={1000} autoComplete="street-address" defaultValue={values?.address} error={errors.address} className="bg-white" />

            <div className="my-1 border-t border-nbts-border sm:col-span-2" />
            <SectionHeading number={2} title="Donation details" description="These details support donor identification and screening." />

            <Input id="register-weight" name="weightKg" type="number" label="Current weight (kg)" required min={1} max={300} step="0.1" defaultValue={values?.weightKg} error={errors.weightKg} className="bg-white" />
            <Select id="register-blood-group" name="bloodGroupId" label="Blood group" required defaultValue={values?.bloodGroupId ?? ""} error={errors.bloodGroupId} className="bg-white">
              <option value="" disabled>Select blood group</option>
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group.id} value={group.id}>{group.code}</option>
              ))}
            </Select>

            <div className="my-1 border-t border-nbts-border sm:col-span-2" />
            <SectionHeading number={3} title="Account and communication" description="Your email and password will be used to sign in securely." />

            <Input id="register-email" name="email" type="email" label="Email address" required maxLength={255} autoComplete="email" defaultValue={values?.email} error={errors.email} wrapperClassName="sm:col-span-2" className="bg-white" />
            <Input id="register-password" name="password" type="password" label="Password" required minLength={8} maxLength={256} autoComplete="new-password" hint="Use at least 8 characters." error={errors.password} className="bg-white" />
            <Input id="register-confirm-password" name="confirmPassword" type="password" label="Confirm password" required minLength={8} maxLength={256} autoComplete="new-password" error={errors.confirmPassword} className="bg-white" />

            <fieldset className="rounded-lg border border-nbts-border p-4 sm:col-span-2">
              <legend className="px-1 text-sm font-semibold text-nbts-ink">Communication preferences</legend>
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-2 text-sm text-nbts-ink">
                  <input name="smsConsent" type="checkbox" value="true" defaultChecked={values?.smsConsent} className="mt-0.5 h-4 w-4 rounded border-nbts-border text-nbts-blood focus:ring-nbts-teal" />
                  Receive donation reminders by SMS
                </label>
                <label className="flex items-start gap-2 text-sm text-nbts-ink">
                  <input name="emailConsent" type="checkbox" value="true" defaultChecked={values?.emailConsent} className="mt-0.5 h-4 w-4 rounded border-nbts-border text-nbts-blood focus:ring-nbts-teal" />
                  Receive donation reminders by email
                </label>
              </div>
            </fieldset>

            <div className="flex flex-col gap-3 border-t border-nbts-border pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-nbts-muted">
                Your donor profile will use the first and last name entered above.
              </p>
              <button type="submit" disabled={busy} className="rounded-md bg-nbts-blood px-5 py-2.5 text-sm font-semibold text-white hover:bg-nbts-blood-dark disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Creating account…" : "Create donor account"}
              </button>
            </div>
          </Form>
        </div>
      </div>
    </main>
  );
}
