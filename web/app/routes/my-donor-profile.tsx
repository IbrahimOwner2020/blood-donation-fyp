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

import { ErrorState } from "~/components/ui/ErrorState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { ApiRequestError } from "~/lib/api";
import { fetchAuthSession, type AuthSession } from "~/lib/auth";
import { BLOOD_GROUP_OPTIONS, formatDonorName, parsePositiveInt, type PublicDonor } from "~/lib/donors";
import { formatDateOnly } from "~/lib/donations";
import { listOwnDonorDonations, updateOwnDonor } from "~/lib/me-donor";
import type { PublicDonation } from "~/lib/donations";

export const meta: MetaFunction = () => [
  { title: "My donor profile · NBTS Blood AI" },
];

type LoaderData =
  | {
      status: "ok";
      session: AuthSession;
      donor: PublicDonor;
      donations: PublicDonation[];
      total: number;
    }
  | { status: "error"; message: string; detail?: string };

type ActionData = {
  error?: string;
  success?: string;
};

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }

  try {
    const result = await listOwnDonorDonations();
    return {
      status: "ok",
      session,
      donor: result.donor,
      donations: result.donations,
      total: result.total,
    };
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to load donor profile.";
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return { status: "error", message, detail };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading donor profile..." />;
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect("/login?next=/my-donor-profile");
  }

  const formData = await request.formData();
  const firstName = String(formData.get("firstName") || "").trim();
  const lastName = String(formData.get("lastName") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const bloodGroupId = parsePositiveInt(String(formData.get("bloodGroupId") || ""));

  if (!firstName || !lastName || !phone || !Number.isFinite(bloodGroupId)) {
    return data<ActionData>(
      { error: "First name, last name, phone, and blood group are required." },
      { status: 400 },
    );
  }

  try {
    await updateOwnDonor({ firstName, lastName, phone, bloodGroupId });
    return data<ActionData>({ success: "Donor profile updated." });
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to update donor profile.";
    return data<ActionData>(
      { error: message },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

const inputClass =
  "rounded border border-nbts-border bg-nbts-surface px-3 py-2 text-sm";

export default function MyDonorProfilePage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  if (loaderData.status === "error") {
    return (
      <div>
        <PageHeader title="My donor profile" />
        <ErrorState
          title="Could not load profile"
          message={loaderData.message}
          detail={loaderData.detail}
        />
      </div>
    );
  }

  const donor = loaderData.donor;

  return (
    <div>
      <PageHeader
        title="My donor profile"
        description={`${formatDonorName(donor)} · ${donor.donorNumber}`}
        actions={
          <Link
            to="/dashboard"
            className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Dashboard
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState title="Could not save profile" message={actionData.error} />
        </div>
      ) : null}
      {actionData?.success ? (
        <p className="mb-4 rounded border border-nbts-teal/30 bg-nbts-teal-soft px-4 py-3 text-sm text-nbts-ink">
          {actionData.success}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <Form
          method="post"
          className="space-y-4 rounded-lg border border-nbts-border bg-nbts-panel p-5"
        >
          <h2 className="text-base font-semibold text-nbts-ink">Profile</h2>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">First name</span>
            <input name="firstName" required defaultValue={donor.firstName} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Last name</span>
            <input name="lastName" required defaultValue={donor.lastName} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Phone</span>
            <input name="phone" required defaultValue={donor.phone ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Blood group</span>
            <select name="bloodGroupId" required defaultValue={donor.bloodGroupId} className={inputClass}>
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.code}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-nbts-blood px-4 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save profile"}
          </button>
        </Form>

        <section className="rounded-lg border border-nbts-border bg-nbts-panel p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-nbts-ink">
              Donation history
            </h2>
            <span className="text-sm text-nbts-muted">{loaderData.total} records</span>
          </div>
          {loaderData.donations.length === 0 ? (
            <p className="text-sm text-nbts-muted">No donations recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-nbts-border text-xs uppercase text-nbts-muted">
                  <tr>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Blood group</th>
                    <th className="py-2 pr-4">Units</th>
                    <th className="py-2 pr-4">Centre</th>
                  </tr>
                </thead>
                <tbody>
                  {loaderData.donations.map((donation) => (
                    <tr key={donation.id} className="border-b border-nbts-border/70">
                      <td className="py-2 pr-4">{formatDateOnly(donation.donationDate)}</td>
                      <td className="py-2 pr-4">{donation.bloodGroup?.code ?? `#${donation.bloodGroupId}`}</td>
                      <td className="py-2 pr-4">{donation.units}</td>
                      <td className="py-2 pr-4">{donation.donationCentre?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
