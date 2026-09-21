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
import { ApiRequestError } from "~/lib/api";
import { registerDonorAccount } from "~/lib/auth";
import { BLOOD_GROUP_OPTIONS, parsePositiveInt } from "~/lib/donors";

export const meta: MetaFunction = () => [
  { title: "Register donor · NBTS Blood AI" },
];

type RegisterActionData = {
  error?: string;
  fieldErrors?: string[];
};

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const firstName = String(formData.get("firstName") || "").trim();
  const lastName = String(formData.get("lastName") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const bloodGroupId = parsePositiveInt(String(formData.get("bloodGroupId") || ""));

  if (!name || !email || !password || !firstName || !lastName || !phone) {
    return data<RegisterActionData>(
      { error: "All fields are required." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return data<RegisterActionData>(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(bloodGroupId)) {
    return data<RegisterActionData>(
      { error: "Select a blood group." },
      { status: 400 },
    );
  }

  try {
    await registerDonorAccount({
      name,
      email,
      password,
      firstName,
      lastName,
      phone,
      bloodGroupId,
    });
    throw redirect("/my-donor-profile");
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to register donor.";
    const fieldErrors =
      error instanceof ApiRequestError
        ? (error.details ?? [])
            .map((detail) => detail?.message || "")
            .filter(Boolean)
        : [];
    return data<RegisterActionData>(
      { error: message, fieldErrors },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

const inputClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-nbts-ink outline-none focus:border-nbts-teal";

export default function RegisterDonorPage() {
  const actionData = useActionData<RegisterActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <div className="flex min-h-screen items-center justify-center bg-nbts-surface px-4 py-8">
      <div className="w-full max-w-2xl rounded-xl border border-nbts-border bg-nbts-panel p-8 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded bg-nbts-blood text-sm font-bold text-white">
                N
              </span>
              <span className="text-lg font-semibold text-nbts-ink">
                NBTS Blood AI
              </span>
            </div>
            <h1 className="text-xl font-semibold text-nbts-ink">
              Register as a donor
            </h1>
          </div>
          <Link to="/login" className="text-sm font-medium text-nbts-teal underline">
            Sign in
          </Link>
        </div>

        {actionData?.error ? (
          <div className="mb-4">
            <ErrorState
              title="Could not register"
              message={actionData.error}
              detail={actionData.fieldErrors?.join("; ")}
            />
          </div>
        ) : null}

        <Form method="post" className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-nbts-ink">Account name</span>
            <input name="name" required autoComplete="name" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Email</span>
            <input name="email" type="email" required autoComplete="email" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Password</span>
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">First name</span>
            <input name="firstName" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Last name</span>
            <input name="lastName" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Phone</span>
            <input name="phone" required autoComplete="tel" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Blood group</span>
            <select name="bloodGroupId" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Select blood group
              </option>
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.code}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-nbts-blood px-4 py-2.5 text-sm font-semibold text-white hover:bg-nbts-blood-dark disabled:opacity-60"
            >
              {busy ? "Registering..." : "Register donor"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
