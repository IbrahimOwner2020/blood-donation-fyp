import { useRef, useState } from "react";
import {
  Form,
  Link,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { Button } from "~/components/ui/Button";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { Input } from "~/components/ui/Input";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { Select } from "~/components/ui/Select";
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasAnyUiPermission,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import {
  allowedNextStatusesForPermissions,
  canApplyRequestStatus,
  formatApiErrorMessage,
  formatBloodGroupCode,
  formatDateTime,
  formatFacilityLabel,
  formatRequestPriority,
  formatRequestStatus,
  getBloodRequest,
  isTerminalRequestStatus,
  parseBloodRequestStatus,
  parseNonNegativeInt,
  parsePositiveInt,
  patchBloodRequest,
  statusNeedsFulfilledUnits,
  type BloodRequestStatus,
  type PublicBloodRequest,
} from "~/lib/blood-requests";

export const meta: MetaFunction = () => [
  { title: "Request detail · Blood Donation Management System" },
];

type DetailLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      bloodRequest: PublicBloodRequest;
      canUpdate: boolean;
      canApprove: boolean;
      canIssue: boolean;
      nextStatuses: BloodRequestStatus[];
    }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "error"; message: string; detail?: string }
  | { status: "unauthenticated" };

type DetailActionData = {
  error?: string;
  success?: string;
  fieldErrors?: string[];
};

export async function clientLoader({
  params,
}: ClientLoaderFunctionArgs): Promise<DetailLoaderData> {
  const requestId = parsePositiveInt(params?.id);
  if (!Number.isFinite(requestId)) {
    return { status: "not_found" };
  }

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

  if (!hasUiPermission(session, UI_PERMISSIONS.requestsRead)) {
    return { status: "forbidden" };
  }

  try {
    const bloodRequest = await getBloodRequest(requestId);
    const canApprove = hasUiPermission(
      session,
      UI_PERMISSIONS.requestsApprove,
    );
    const canIssue = hasUiPermission(session, UI_PERMISSIONS.requestsIssue);
    const canUpdate = canApprove || canIssue;
    const nextStatuses = allowedNextStatusesForPermissions(bloodRequest.status, {
      canApprove,
      canIssue,
    });
    return {
      status: "ok",
      session,
      bloodRequest,
      canUpdate,
      canApprove,
      canIssue,
      nextStatuses,
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { status: "forbidden" };
    }
    if (error instanceof ApiRequestError && error.status === 404) {
      return { status: "not_found" };
    }
    const message = formatApiErrorMessage(
      error,
      "Unable to load blood request.",
    );
    const detail =
      error instanceof ApiRequestError
        ? `${error.code} (${error.status})`
        : undefined;
    return { status: "error", message, detail };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading request…" />;
}

export async function clientAction({
  request,
  params,
}: ClientActionFunctionArgs) {
  const requestId = parsePositiveInt(params?.id);
  if (!Number.isFinite(requestId)) {
    return data<DetailActionData>(
      { error: "Invalid blood request id." },
      { status: 400 },
    );
  }

  const session = await fetchAuthSession().catch(() => null);
  if (
    !session ||
    !hasAnyUiPermission(session, [
      UI_PERMISSIONS.requestsApprove,
      UI_PERMISSIONS.requestsIssue,
    ])
  ) {
    return data<DetailActionData>(
      { error: "You do not have permission to update blood requests." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const nextStatus = parseBloodRequestStatus(
    String(formData.get("status") || ""),
  );
  if (!nextStatus) {
    return data<DetailActionData>(
      { error: "Select a valid next status." },
      { status: 400 },
    );
  }

  const canApprove = hasUiPermission(session, UI_PERMISSIONS.requestsApprove);
  const canIssue = hasUiPermission(session, UI_PERMISSIONS.requestsIssue);
  if (!canApplyRequestStatus(nextStatus, { canApprove, canIssue })) {
    return data<DetailActionData>(
      {
        error:
          "Your role cannot apply this status. Managers approve or cancel; Blood Bank Staff issue approved requests.",
      },
      { status: 403 },
    );
  }

  const fulfilledRaw = String(formData.get("fulfilledUnits") || "").trim();
  let fulfilledUnits: number | undefined;
  if (fulfilledRaw) {
    fulfilledUnits = parseNonNegativeInt(fulfilledRaw);
    if (!Number.isFinite(fulfilledUnits)) {
      return data<DetailActionData>(
        { error: "Fulfilled units must be a non-negative integer." },
        { status: 400 },
      );
    }
  }

  if (statusNeedsFulfilledUnits(nextStatus) && fulfilledUnits === undefined) {
    return data<DetailActionData>(
      {
        error:
          "Enter how many units have been fulfilled. Use at least 1 and fewer than the number requested.",
      },
      { status: 400 },
    );
  }

  try {
    await patchBloodRequest(requestId, {
      status: nextStatus,
      ...(fulfilledUnits !== undefined ? { fulfilledUnits } : {}),
    });
    return data<DetailActionData>({
      success: `Status updated to ${formatRequestStatus(nextStatus)}.`,
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    const message = formatApiErrorMessage(
      error,
      "Unable to update request status.",
    );
    const fieldErrors =
      error instanceof ApiRequestError
        ? (error.details ?? [])
            .map((detail) => detail?.message || "")
            .filter(Boolean)
        : [];
    return data<DetailActionData>(
      { error: message, fieldErrors },
      { status: error instanceof ApiRequestError ? error.status || 400 : 500 },
    );
  }
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1 border-b border-nbts-border py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-nbts-muted">
        {label}
      </dt>
      <dd className="text-sm text-nbts-ink">{value}</dd>
    </div>
  );
}

function StatusChangeForm({
  bloodRequest,
  nextStatuses,
  busy = false,
}: {
  bloodRequest: PublicBloodRequest;
  nextStatuses: BloodRequestStatus[];
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<BloodRequestStatus>(
    nextStatuses?.[0] ?? bloodRequest.status,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const needsUnits = statusNeedsFulfilledUnits(selected);
  const maxPartial = Math.max(1, (bloodRequest.unitsRequested ?? 1) - 1);
  const needsConfirm =
    selected === "CANCELLED" || selected === "FULFILLED";

  if (!nextStatuses?.length) {
    return (
      <p className="text-sm text-nbts-muted">
        No further transitions are available from{" "}
        {formatRequestStatus(bloodRequest.status)}.
      </p>
    );
  }

  return (
    <>
      <Form ref={formRef} method="post" className="space-y-4">
        <Select
          name="status"
          label="Next status"
          value={selected}
          onChange={(event) => {
            const parsed = parseBloodRequestStatus(event.target.value);
            if (parsed) {
              setSelected(parsed);
            }
          }}
        >
          {nextStatuses.map((status) => (
            <option key={status} value={status}>
              {formatRequestStatus(status)}
              {status === bloodRequest.status ? " (update fulfilment)" : ""}
            </option>
          ))}
        </Select>

        {needsUnits ? (
          <Input
            type="number"
            name="fulfilledUnits"
            label="Fulfilled units"
            required
            min={1}
            max={maxPartial}
            defaultValue={Math.min(
              Math.max(bloodRequest.fulfilledUnits || 1, 1),
              maxPartial,
            )}
            hint={`Enter 1 to ${maxPartial}. That must be less than the ${bloodRequest.unitsRequested} units requested.`}
          />
        ) : selected === "FULFILLED" ? (
          <p className="text-xs text-nbts-muted">
            This marks all {bloodRequest.unitsRequested} requested units as
            fulfilled.
          </p>
        ) : (
          <p className="text-xs text-nbts-muted">
            Fulfilled units stay at {bloodRequest.fulfilledUnits}.
          </p>
        )}

        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            if (needsConfirm) {
              setConfirmOpen(true);
              return;
            }
            formRef.current?.requestSubmit();
          }}
        >
          {busy ? "Updating…" : "Apply status change"}
        </Button>
      </Form>
      <ConfirmDialog
        open={confirmOpen}
        title={`Apply ${formatRequestStatus(selected)}?`}
        description={`Request #${bloodRequest.id} will be marked ${formatRequestStatus(selected)}.`}
        confirmLabel="Apply status"
        tone={selected === "CANCELLED" ? "danger" : "primary"}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}

export default function BloodRequestDetailPage() {
  const loaderData = useLoaderData<DetailLoaderData>();
  const actionData = useActionData<DetailActionData>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  if (loaderData?.status === "unauthenticated") {
    return (
      <ErrorState
        title="Sign in required"
        message="Your session expired. Sign in again to view this request."
      />
    );
  }

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Blood request" />
        <ForbiddenState
          title="Missing permission"
          message="You do not have permission to view this request. Contact an administrator if you need access."
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

  if (loaderData?.status === "not_found") {
    return (
      <div>
        <PageHeader title="Blood request" />
        <EmptyState
          title="Request not found"
          description="No blood request exists for this id, or it is no longer available."
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
        <PageHeader title="Blood request" />
        <ErrorState
          title="Could not load request"
          message={loaderData.message}
          detail={loaderData.detail}
        />
      </div>
    );
  }

  if (loaderData?.status !== "ok") {
    return <LoadingState label="Loading request…" />;
  }

  const bloodRequest = loaderData.bloodRequest;
  const nextStatuses = loaderData.nextStatuses ?? [];
  const terminal = isTerminalRequestStatus(bloodRequest.status);

  return (
    <div>
      <PageHeader
        title={`Request #${bloodRequest.id}`}
        description="Blood request details."
        actions={
          <Link
            to="/blood-requests"
            className="rounded border border-nbts-border bg-nbts-panel px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to list
          </Link>
        }
      />

      {actionData?.error ? (
        <div className="mb-4">
          <ErrorState
            title="Status change rejected"
            message={actionData.error}
            detail={actionData.fieldErrors?.join("; ")}
          />
        </div>
      ) : null}

      {actionData?.success ? (
        <p
          className="mb-4 rounded border border-nbts-teal/30 bg-nbts-surface px-4 py-3 text-sm text-nbts-teal"
          role="status"
        >
          {actionData.success}
        </p>
      ) : null}

      <div className="mb-6 rounded-lg border border-nbts-border bg-nbts-panel p-5">
        <dl>
          <DetailRow
            label="Status"
            value={formatRequestStatus(bloodRequest.status)}
          />
          <DetailRow
            label="Facility"
            value={formatFacilityLabel(
              bloodRequest.facility,
              bloodRequest.facilityId,
            )}
          />
          <DetailRow
            label="Blood group"
            value={formatBloodGroupCode(
              bloodRequest.bloodGroup,
              bloodRequest.bloodGroupId,
            )}
          />
          <DetailRow
            label="Units"
            value={`${bloodRequest.fulfilledUnits} fulfilled / ${bloodRequest.unitsRequested} requested`}
          />
          <DetailRow
            label="Priority"
            value={formatRequestPriority(bloodRequest.priority)}
          />
          <DetailRow
            label="Requested at"
            value={formatDateTime(bloodRequest.requestedAt)}
          />
          <DetailRow
            label="Required by"
            value={formatDateTime(bloodRequest.requiredAt)}
          />
          <DetailRow
            label="Updated"
            value={formatDateTime(bloodRequest.updatedAt)}
          />
        </dl>
      </div>

      {loaderData.canUpdate ? (
        <section className="rounded-lg border border-nbts-border bg-nbts-panel p-5">
          <h2 className="text-base font-semibold text-nbts-ink">Update status</h2>
          <p className="mt-1 text-sm text-nbts-muted">
            Choose what should happen next with this request.
          </p>

          <div className="mt-4">
            {terminal ? (
              <p className="text-sm text-nbts-muted">
                This request is {formatRequestStatus(bloodRequest.status)}. It
                cannot be changed.
              </p>
            ) : nextStatuses.length === 0 ? (
              <p className="text-sm text-nbts-muted">
                No further updates are available for this request.
              </p>
            ) : (
              <StatusChangeForm
                key={`${bloodRequest.status}-${bloodRequest.fulfilledUnits}-${bloodRequest.updatedAt || ""}`}
                bloodRequest={bloodRequest}
                nextStatuses={nextStatuses}
                busy={busy}
              />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
