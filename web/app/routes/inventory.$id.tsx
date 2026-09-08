import {
  Link,
  redirect,
  useLoaderData,
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
  type PublicInventoryUnit,
} from "~/lib/inventory";
import { ApiRequestError } from "~/lib/api";

export const meta: MetaFunction = () => [
  { title: "Inventory unit · NBTS Blood AI" },
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
        "Your session does not include inventory:read. The API remains the access authority.",
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
          "Inventory unit not found (or inventory API not mounted yet).",
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
          "Inventory detail is not available yet. The inventory API may still be landing.",
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

export default function InventoryDetailPage() {
  const data = useLoaderData<InventoryDetailLoaderData>();

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
          detail="UI gate only — the API enforces authorization."
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
          title="Inventory API not available yet"
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
          message={data.message || "Unable to load inventory unit from the API."}
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

  return (
    <div>
      <PageHeader
        title={`Inventory unit #${unit.id}`}
        description="Status, dates, and facility assignment are API-owned. Expired units must be excluded from available stock by the API."
        actions={
          <Link
            to="/inventory"
            className="inline-flex rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to list
          </Link>
        }
      />

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
    </div>
  );
}
