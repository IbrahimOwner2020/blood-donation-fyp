import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { Input } from "~/components/ui/Input";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { ApiRequestError } from "~/lib/api";
import {
  createFacility,
  listFacilities,
  patchFacility,
  type PublicFacility,
} from "~/lib/blood-requests";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";

export const meta: MetaFunction = () => [
  { title: "Facilities · Blood Donation Management System" },
];

type FacilitiesLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      facilities: PublicFacility[];
      canCreate: boolean;
      canUpdate: boolean;
    }
  | { status: "forbidden" }
  | { status: "error"; message: string; detail?: string }
  | { status: "unauthenticated" };

type FacilitiesActionData = {
  error?: string;
  intent?: "create" | "update";
  facilityId?: number;
};

function parseFacilityId(value: FormDataEntryValue | null): number {
  const id = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(id) && id > 0 ? id : Number.NaN;
}

export async function clientLoader(
  _args: ClientLoaderFunctionArgs,
): Promise<FacilitiesLoaderData> {
  let session: AuthSession | null = null;
  try {
    session = await fetchAuthSession();
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to verify your session.";
    return { status: "error", message };
  }

  if (!session) {
    return { status: "unauthenticated" };
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.facilitiesRead)) {
    return { status: "forbidden" };
  }

  try {
    const facilities = await listFacilities();
    return {
      status: "ok",
      session,
      facilities,
      canCreate: hasUiPermission(session, UI_PERMISSIONS.facilitiesCreate),
      canUpdate: hasUiPermission(session, UI_PERMISSIONS.facilitiesUpdate),
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { status: "forbidden" };
    }
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to load facilities.";
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return { status: "error", message, detail };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading facilities..." />;
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  if (!session) {
    return data<FacilitiesActionData>(
      { error: "Sign in again to manage facilities." },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const region = String(formData.get("region") || "").trim();
  const district = String(formData.get("district") || "").trim();
  const active = String(formData.get("active") || "true") === "true";

  if (intent === "create") {
    if (!hasUiPermission(session, UI_PERMISSIONS.facilitiesCreate)) {
      return data<FacilitiesActionData>(
        { error: "facilities:create is required.", intent: "create" },
        { status: 403 },
      );
    }
    if (!name || !region || !district) {
      return data<FacilitiesActionData>(
        { error: "Name, region, and district are required.", intent: "create" },
        { status: 400 },
      );
    }
    try {
      await createFacility({ name, region, district, active });
      return null;
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.message
          : "Unable to create facility.";
      return data<FacilitiesActionData>(
        { error: message, intent: "create" },
        { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
      );
    }
  }

  if (intent === "update") {
    if (!hasUiPermission(session, UI_PERMISSIONS.facilitiesUpdate)) {
      return data<FacilitiesActionData>(
        { error: "facilities:update is required.", intent: "update" },
        { status: 403 },
      );
    }
    const facilityId = parseFacilityId(formData.get("facilityId"));
    if (!Number.isFinite(facilityId)) {
      return data<FacilitiesActionData>(
        { error: "Invalid facility id.", intent: "update" },
        { status: 400 },
      );
    }
    if (!name || !region || !district) {
      return data<FacilitiesActionData>(
        {
          error: "Name, region, and district are required.",
          intent: "update",
          facilityId,
        },
        { status: 400 },
      );
    }
    try {
      await patchFacility(facilityId, { name, region, district, active });
      return null;
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? error.message
          : "Unable to update facility.";
      return data<FacilitiesActionData>(
        { error: message, intent: "update", facilityId },
        { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
      );
    }
  }

  return data<FacilitiesActionData>(
    { error: "Unknown action." },
    { status: 400 },
  );
}

export default function AdminFacilitiesPage() {
  const loaderData = useLoaderData<FacilitiesLoaderData>();
  const actionData = useActionData<FacilitiesActionData>();
  const navigation = useNavigation();
  const busy =
    navigation.state === "submitting" || navigation.state === "loading";

  if (loaderData?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to manage facilities."
      />
    );
  }

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Admin · Facilities" />
        <ForbiddenState
          title="Missing permission"
          message="facilities:read is required to view facilities."
          detail="UI gate: facilities:read"
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader title="Admin · Facilities" />
        <ErrorState
          title="Could not load facilities"
          message={loaderData.message}
          detail={loaderData.detail}
        />
      </div>
    );
  }

  if (loaderData?.status !== "ok") {
    return <LoadingState label="Loading facilities..." />;
  }

  const facilities = loaderData.facilities ?? [];

  return (
    <div>
      <PageHeader
        title="Admin · Facilities"
        description="Create and update healthcare facilities. The server controls who can mutate facility records."
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState title="Could not save facility" message={actionData.error} />
        </div>
      ) : null}

      {loaderData.canCreate ? (
        <section className="mb-8 max-w-2xl rounded-lg border border-nbts-border bg-nbts-panel p-5">
          <h2 className="text-base font-semibold text-nbts-ink">
            Create facility
          </h2>
          <Form method="post" className="mt-4 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="intent" value="create" />
            <Input id="facility-name" name="name" label="Name" required />
            <Input id="facility-region" name="region" label="Region" required />
            <Input
              id="facility-district"
              name="district"
              label="District"
              required
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-nbts-ink">Status</span>
              <select
                name="active"
                defaultValue="true"
                className="rounded border border-nbts-border bg-white px-3 py-2"
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-nbts-blood px-4 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark disabled:opacity-60"
              >
                {busy && actionData?.intent !== "update"
                  ? "Saving..."
                  : "Create facility"}
              </button>
            </div>
          </Form>
        </section>
      ) : null}

      {facilities.length === 0 ? (
        <EmptyState
          title="No facilities"
          description="Seed or create healthcare facilities before assigning facility managers."
        />
      ) : (
        <ul className="divide-y divide-nbts-border overflow-hidden rounded-lg border border-nbts-border bg-nbts-panel">
          {facilities.map((facility) => (
            <li key={facility.id} className="px-4 py-4">
              {loaderData.canUpdate ? (
                <Form method="post" className="grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="intent" value="update" />
                  <input
                    type="hidden"
                    name="facilityId"
                    value={String(facility.id)}
                  />
                  <Input
                    id={`facility-name-${facility.id}`}
                    name="name"
                    label="Name"
                    defaultValue={facility.name}
                    required
                  />
                  <Input
                    id={`facility-region-${facility.id}`}
                    name="region"
                    label="Region"
                    defaultValue={facility.region}
                    required
                  />
                  <Input
                    id={`facility-district-${facility.id}`}
                    name="district"
                    label="District"
                    defaultValue={facility.district}
                    required
                  />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-nbts-ink">Status</span>
                    <select
                      name="active"
                      defaultValue={facility.active ? "true" : "false"}
                      className="rounded border border-nbts-border bg-white px-3 py-2"
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </label>
                  <div className="sm:col-span-4 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded border border-nbts-border bg-white px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted disabled:opacity-60"
                    >
                      {busy && actionData?.facilityId === facility.id
                        ? "Saving..."
                        : "Save changes"}
                    </button>
                    <span className="font-mono text-xs text-nbts-muted">
                      id: {facility.id}
                    </span>
                  </div>
                </Form>
              ) : (
                <>
                  <p className="font-medium text-nbts-ink">{facility.name}</p>
                  <p className="mt-1 text-sm text-nbts-muted">
                    {facility.district}, {facility.region}
                  </p>
                  <p className="mt-2 text-xs text-nbts-muted">
                    {facility.active ? "Active" : "Inactive"}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
