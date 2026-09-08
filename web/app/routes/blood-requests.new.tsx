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

import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import {
  BLOOD_GROUP_OPTIONS,
  BLOOD_REQUEST_PRIORITIES,
  createBloodRequest,
  datetimeLocalToIso,
  formatApiErrorMessage,
  formatFacilityLabel,
  formatRequestPriority,
  listFacilities,
  parseBloodRequestPriority,
  parsePositiveInt,
  type PublicFacility,
} from "~/lib/blood-requests";

export const meta: MetaFunction = () => [
  { title: "New blood request · NBTS Blood AI" },
];

type NewRequestLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      facilities: PublicFacility[];
    }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "unauthenticated" };

type NewRequestActionData = {
  error?: string;
  fieldErrors?: string[];
};

export async function clientLoader(
  _args: ClientLoaderFunctionArgs,
): Promise<NewRequestLoaderData> {
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

  if (!hasUiPermission(session, UI_PERMISSIONS.requestsCreate)) {
    return { status: "forbidden" };
  }

  try {
    const facilities = await listFacilities({ active: true });
    return { status: "ok", session, facilities: facilities ?? [] };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { status: "forbidden" };
    }
    return {
      status: "error",
      message: formatApiErrorMessage(error, "Unable to load facilities."),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading new request form…" />;
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.requestsCreate)) {
    return data<NewRequestActionData>(
      { error: "You do not have permission to create blood requests." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const facilityId = parsePositiveInt(String(formData.get("facilityId") || ""));
  const bloodGroupId = parsePositiveInt(
    String(formData.get("bloodGroupId") || ""),
  );
  const unitsRequested = parsePositiveInt(
    String(formData.get("unitsRequested") || ""),
  );
  const priority =
    parseBloodRequestPriority(String(formData.get("priority") || "")) ||
    "MEDIUM";
  const requestedAt = datetimeLocalToIso(
    String(formData.get("requestedAt") || ""),
  );
  const requiredAtRaw = datetimeLocalToIso(
    String(formData.get("requiredAt") || ""),
  );

  if (!Number.isFinite(facilityId)) {
    return data<NewRequestActionData>(
      { error: "Select a facility." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(bloodGroupId)) {
    return data<NewRequestActionData>(
      { error: "Select a blood group." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(unitsRequested) || unitsRequested < 1) {
    return data<NewRequestActionData>(
      { error: "Units requested must be at least 1." },
      { status: 400 },
    );
  }

  try {
    const bloodRequest = await createBloodRequest({
      facilityId,
      bloodGroupId,
      unitsRequested,
      priority,
      ...(requestedAt ? { requestedAt } : {}),
      ...(requiredAtRaw !== undefined
        ? { requiredAt: requiredAtRaw }
        : {}),
    });
    throw redirect(`/blood-requests/${bloodRequest.id}`);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    const message = formatApiErrorMessage(
      error,
      "Unable to create blood request.",
    );
    const fieldErrors =
      error instanceof ApiRequestError
        ? (error.details ?? [])
            .map((detail) => detail?.message || "")
            .filter(Boolean)
        : [];
    return data<NewRequestActionData>(
      { error: message, fieldErrors },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

export default function BloodRequestNewPage() {
  const loaderData = useLoaderData<NewRequestLoaderData>();
  const actionData = useActionData<NewRequestActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  if (loaderData?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to create blood requests."
      />
    );
  }

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Create blood request" />
        <ForbiddenState
          title="Missing permission"
          message="requests:create is required to create blood requests."
          detail="UI gate: requests:create"
          action={
            <Link
              to="/blood-requests"
              className="text-sm text-nbts-teal underline"
            >
              Back to requests
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader title="Create blood request" />
        <ErrorState title="Could not load form" message={loaderData.message} />
      </div>
    );
  }

  if (loaderData?.status !== "ok") {
    return <LoadingState label="Loading new request form…" />;
  }

  const facilities = loaderData.facilities ?? [];

  return (
    <div>
      <PageHeader
        title="Create blood request"
        description="Posts to POST /blood-requests. New requests start as PENDING with 0 fulfilled units."
        actions={
          <Link
            to="/blood-requests"
            className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Cancel
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState
            title="Could not create request"
            message={actionData.error}
            detail={actionData.fieldErrors?.join("; ")}
          />
        </div>
      ) : null}

      {facilities.length === 0 ? (
        <EmptyState
          title="No active facilities"
          description="An active healthcare facility is required before creating a request. Seed or create facilities via the API."
          action={
            <Link
              to="/blood-requests"
              className="text-sm text-nbts-teal underline"
            >
              Back to requests
            </Link>
          }
        />
      ) : (
        <Form
          method="post"
          className="max-w-xl space-y-4 rounded-lg border border-nbts-border bg-nbts-panel p-5"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Facility</span>
            <select
              name="facilityId"
              required
              defaultValue=""
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            >
              <option value="" disabled>
                Select facility
              </option>
              {facilities.map((facility) => (
                <option key={facility.id} value={String(facility.id)}>
                  {formatFacilityLabel(facility)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Blood group</span>
            <select
              name="bloodGroupId"
              required
              defaultValue=""
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            >
              <option value="" disabled>
                Select blood group
              </option>
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group.id} value={String(group.id)}>
                  {group.code}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Units requested</span>
            <input
              type="number"
              name="unitsRequested"
              required
              min={1}
              max={10000}
              defaultValue={1}
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">Priority</span>
            <select
              name="priority"
              defaultValue="MEDIUM"
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            >
              {BLOOD_REQUEST_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {formatRequestPriority(priority)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">
              Requested at{" "}
              <span className="font-normal text-nbts-muted">(optional)</span>
            </span>
            <input
              type="datetime-local"
              name="requestedAt"
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            />
            <span className="text-xs text-nbts-muted">
              Leave blank to use the API default (now).
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-nbts-ink">
              Required by{" "}
              <span className="font-normal text-nbts-muted">(optional)</span>
            </span>
            <input
              type="datetime-local"
              name="requiredAt"
              className="rounded border border-nbts-border bg-nbts-surface px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="rounded bg-nbts-blood px-4 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create request"}
          </button>
        </Form>
      )}
    </div>
  );
}
