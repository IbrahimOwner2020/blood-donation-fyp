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
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { EmptyState } from "~/components/ui/EmptyState";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import {
  formatApiErrorMessage,
  formatDateOnly,
  formatInventoryBloodGroup,
  formatInventoryFacility,
  formatInventoryStatus,
  getInventoryUnit,
  isForbiddenApiError,
  isInventoryUnavailableError,
  parsePositiveInt,
  updateInventoryUnit,
  type PublicInventoryUnit,
} from "~/lib/inventory";
import { ApiRequestError } from "~/lib/api";

export const meta: MetaFunction = () => [
  { title: "Inventory unit · Blood Donation Management System" },
];

type InventoryDetailLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      unit: PublicInventoryUnit;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      unitId: string;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      unitId: string;
    }
  | {
      status: "not_found";
      session: AuthSession;
      message: string;
      unitId: string;
    }
  | {
      status: "unavailable";
      session: AuthSession;
      message: string;
      unitId: string;
    };

type InventoryDetailActionData = {
  error?: string;
  success?: string;
};

export async function clientLoader({
  request,
  params,
}: ClientLoaderFunctionArgs): Promise<InventoryDetailLoaderData> {
  const unitIdParam = params?.id || "";
  const unitId = parsePositiveInt(unitIdParam);

  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.inventoryRead)) {
    return {
      status: "forbidden",
      session,
      unitId: unitIdParam,
      message:
        "Your session does not include inventory:read. The server remains the access authority.",
    };
  }

  if (!Number.isFinite(unitId)) {
    return {
      status: "not_found",
      session,
      unitId: unitIdParam,
      message: "Invalid inventory unit id.",
    };
  }

  try {
    const unit = await getInventoryUnit(unitId);
    return { status: "ok", session, unit };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        unitId: unitIdParam,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view this inventory unit.",
        ),
      };
    }
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.code === "NOT_FOUND")
    ) {
      // Could be missing unit or unmounted module — prefer not_found for detail UX;
      // network/501/503 still map to unavailable below.
      return {
        status: "not_found",
        session,
        unitId: unitIdParam,
        message: formatApiErrorMessage(
          error,
          "Inventory unit not found (or inventory server not mounted yet).",
        ),
      };
    }
    if (isInventoryUnavailableError(error)) {
      return {
        status: "unavailable",
        session,
        unitId: unitIdParam,
        message: formatApiErrorMessage(
          error,
          "Inventory detail is not available yet. The inventory server may still be landing.",
        ),
      };
    }
    return {
      status: "error",
      session,
      unitId: unitIdParam,
      message: formatApiErrorMessage(error, "Unable to load inventory unit."),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading inventory unit…" />;
}

export async function clientAction({
  request,
  params,
}: ClientActionFunctionArgs) {
  const unitId = parsePositiveInt(params?.id);
  if (!Number.isFinite(unitId)) {
    return data<InventoryDetailActionData>(
      { error: "Invalid inventory unit id." },
      { status: 400 },
    );
  }

  const session = await fetchAuthSession();
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.inventoryUpdate)) {
    return data<InventoryDetailActionData>(
      { error: "You do not have permission to update inventory." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  if (intent !== "issue") {
    return data<InventoryDetailActionData>(
      { error: "Unknown inventory action." },
      { status: 400 },
    );
  }

  try {
    await updateInventoryUnit(unitId, { status: "ISSUED" });
    return data<InventoryDetailActionData>({ success: "Usage recorded." });
  } catch (error) {
    const message =
      error instanceof ApiRequestError
        ? error.message
        : "Unable to record usage.";
    return data<InventoryDetailActionData>(
      { error: message },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

export default function InventoryDetailPage() {
  const data = useLoaderData<InventoryDetailLoaderData>();
  const actionData = useActionData<InventoryDetailActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  if (data?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Inventory unit" description="Unit detail." />
        <ForbiddenState
          title="Inventory access restricted"
          message={
            data.message ||
            "You do not have permission to view inventory (inventory:read)."
          }
          detail="UI gate only — the server enforces authorization."
          action={
            <Link
              to="/inventory"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to inventory
            </Link>
          }
        />
      </div>
    );
  }

  if (data?.status === "unavailable") {
    return (
      <div>
        <PageHeader
          title={`Inventory unit #${data.unitId}`}
          description="Unit detail from GET /inventory/:id."
        />
        <EmptyState
          title="Inventory server not available yet"
          description={data.message}
          action={
            <Link
              to="/inventory"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to inventory
            </Link>
          }
        />
      </div>
    );
  }

  if (data?.status === "not_found") {
    return (
      <div>
        <PageHeader title="Inventory unit" description="Unit detail." />
        <ErrorState
          title="Unit not found"
          message={data.message || `No inventory unit matches id ${data.unitId}.`}
        />
        <div className="mt-4">
          <Link
            to="/inventory"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to inventory
          </Link>
        </div>
      </div>
    );
  }

  if (data?.status === "error") {
    return (
      <div>
        <PageHeader title="Inventory unit" description="Unit detail." />
        <ErrorState
          title="Could not load unit"
          message={data.message || "Unable to load inventory unit from the server."}
        />
        <div className="mt-4">
          <Link
            to="/inventory"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to inventory
          </Link>
        </div>
      </div>
    );
  }

  const unit = data.unit;
  const canRecordUsage =
    hasUiPermission(data.session, UI_PERMISSIONS.inventoryUpdate) &&
    (unit.status === "AVAILABLE" || unit.status === "RESERVED");

  return (
    <div>
      <PageHeader
        title={`Inventory unit #${unit.id}`}
        description="Status, dates, and facility assignment are server-owned. Expired units must be excluded from available stock by the server."
        actions={
          <Link
            to="/inventory"
            className="inline-flex rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to list
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState title="Could not record usage" message={actionData.error} />
        </div>
      ) : null}
      {actionData?.success ? (
        <p className="mb-4 rounded border border-nbts-teal/30 bg-nbts-teal-soft px-4 py-3 text-sm text-nbts-ink">
          {actionData.success}
        </p>
      ) : null}

      <dl className="grid gap-4 rounded-lg border border-nbts-border bg-nbts-panel p-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Blood group
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatInventoryBloodGroup(unit)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Status
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatInventoryStatus(unit.status)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Collection date
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDateOnly(unit.collectionDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Expiry date
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDateOnly(unit.expiryDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Facility
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatInventoryFacility(unit.facility)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
            Linked donation
          </dt>
          <dd className="mt-1 text-sm">
            {unit.donationId ? (
              <Link
                to={`/donations/${unit.donationId}`}
                className="text-nbts-teal underline-offset-2 hover:underline"
              >
                Donation #{unit.donationId}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      {canRecordUsage ? (
        <Form
          method="post"
          className="mt-5 rounded-lg border border-nbts-border bg-nbts-panel p-5"
        >
          <input type="hidden" name="intent" value="issue" />
          <h2 className="text-base font-semibold text-nbts-ink">Record usage</h2>
          <p className="mt-1 text-sm text-nbts-muted">
            Marks this unit as issued through the inventory server.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="mt-4 rounded bg-nbts-blood px-4 py-2 text-sm font-medium text-white hover:bg-nbts-blood-dark disabled:opacity-60"
          >
            {busy ? "Recording..." : "Mark as issued"}
          </button>
        </Form>
      ) : null}
    </div>
  );
}
