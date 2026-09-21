import {
  Link,
  redirect,
  useLoaderData,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/Table";
import {
  formatApiErrorMessage,
  getAiAnalysisReport,
  type PublicAiAnalysisRun,
} from "~/lib/ai-analysis";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import { formatDateTime, formatPredictedUnits, parsePositiveInt } from "~/lib/predictions";

export const meta: MetaFunction<typeof clientLoader> = ({ data }) => [
  {
    title:
      data?.status === "ok"
        ? `AI Report #${data.report.id} · NBTS Blood AI`
        : "AI Report · NBTS Blood AI",
  },
];

type LoaderData =
  | { status: "ok"; session: AuthSession; report: PublicAiAnalysisRun }
  | { status: "forbidden"; session: AuthSession; message: string }
  | { status: "error"; session: AuthSession; message: string };

export async function clientLoader({
  request,
  params,
}: ClientLoaderFunctionArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const session = await fetchAuthSession();
  if (!session) {
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (!hasUiPermission(session, UI_PERMISSIONS.reportsRead)) {
    return {
      status: "forbidden",
      session,
      message: "Your session does not include reports:read.",
    };
  }
  const id = parsePositiveInt(params.id);
  if (!Number.isFinite(id)) {
    return { status: "error", session, message: "Invalid AI report id." };
  }

  try {
    return {
      status: "ok",
      session,
      report: await getAiAnalysisReport(id),
    };
  } catch (error) {
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load AI report."),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading AI report…" />;
}

function donorName(donor: { firstName: string; lastName: string; donorNumber: string }) {
  return `${donor.firstName} ${donor.lastName}`.trim() || donor.donorNumber || "Donor";
}

export default function AiReportDetailPage() {
  const loaderData = useLoaderData<LoaderData>();

  if (loaderData.status === "forbidden") {
    return <ForbiddenState title="AI report unavailable" message={loaderData.message} />;
  }
  if (loaderData.status === "error") {
    return <ErrorState title="Unable to load AI report" message={loaderData.message} />;
  }

  const { report } = loaderData;
  const recs = report.recommendations;

  return (
    <div>
      <PageHeader
        title={`AI Report #${report.id}`}
        description="AI supply conclusion, donor recommendations, notification mode, and audit context."
        actions={
          <Link
            to="/ai-reports"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            All AI reports
          </Link>
        }
      />

      <section className="mb-6 rounded-lg border border-nbts-border bg-nbts-panel p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
          AI conclusion
        </h2>
        <p className="text-sm leading-6 text-nbts-ink">{report.conclusion}</p>
      </section>

      <dl className="mb-6 grid gap-4 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Status</dt>
          <dd className="mt-1 font-semibold text-nbts-ink">{report.status}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Risk</dt>
          <dd className="mt-1 font-semibold text-nbts-ink">{report.riskLevel}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Trigger</dt>
          <dd className="mt-1 text-nbts-ink">{report.triggerType}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Notification mode</dt>
          <dd className="mt-1 text-nbts-ink">{report.notificationMode}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Horizon</dt>
          <dd className="mt-1 text-nbts-ink">{report.horizonDays} days</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Predictions</dt>
          <dd className="mt-1 text-nbts-ink">{report.predictionIds.length}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Alerts</dt>
          <dd className="mt-1 text-nbts-ink">{report.alertIds.length}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">Generated</dt>
          <dd className="mt-1 text-nbts-ink">{formatDateTime(report.createdAt)}</dd>
        </div>
      </dl>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
          Shortage forecast
        </h2>
        {recs.shortages.length === 0 ? (
          <EmptyState title="No projected shortage" description="The AI analysis did not create shortage recommendations for this run." />
        ) : (
          <div className="rounded-lg border border-nbts-border bg-nbts-panel">
            <Table caption="AI shortage recommendations">
              <THead>
                <Tr>
                  <Th>Blood group</Th>
                  <Th>Gap</Th>
                  <Th>Available</Th>
                  <Th>Predicted</Th>
                  <Th>Alert</Th>
                </Tr>
              </THead>
              <TBody>
                {recs.shortages.map((item) => (
                  <Tr key={item.alertId}>
                    <Td>{item.bloodGroupCode ?? `#${item.bloodGroupId}`}</Td>
                    <Td>{formatPredictedUnits(item.projectedGap)}</Td>
                    <Td>{formatPredictedUnits(item.availableUnits)}</Td>
                    <Td>{formatPredictedUnits(item.predictedUnits)}</Td>
                    <Td>
                      <Link className="text-nbts-blood underline" to={`/alerts/${item.alertId}`}>
                        Alert #{item.alertId}
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
            Recommended donors
          </h2>
          {recs.donors.length === 0 ? (
            <EmptyState title="No donor recommendations" description="No eligible donor matches were attached to this report." />
          ) : (
            <div className="rounded-lg border border-nbts-border bg-nbts-panel">
              <Table caption="Recommended donors">
                <THead>
                  <Tr>
                    <Th>Donor</Th>
                    <Th>Blood group</Th>
                    <Th>Alert</Th>
                  </Tr>
                </THead>
                <TBody>
                  {recs.donors.slice(0, 50).map((donor) => (
                    <Tr key={`${donor.alertId}-${donor.id}`}>
                      <Td>
                        <Link className="font-medium text-nbts-blood underline" to={`/donors/${donor.id}`}>
                          {donorName(donor)}
                        </Link>
                        <p className="text-xs text-nbts-muted">{donor.donorNumber}</p>
                      </Td>
                      <Td>{donor.bloodGroupCode ?? "—"}</Td>
                      <Td>#{donor.alertId}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
            Donation places
          </h2>
          {recs.centres.length === 0 ? (
            <EmptyState title="No active centres" description="No active donation centres were attached to this report." />
          ) : (
            <div className="rounded-lg border border-nbts-border bg-nbts-panel">
              <Table caption="Recommended donation centres">
                <THead>
                  <Tr>
                    <Th>Centre</Th>
                    <Th>Region</Th>
                  </Tr>
                </THead>
                <TBody>
                  {recs.centres.slice(0, 20).map((centre) => (
                    <Tr key={centre.id}>
                      <Td>{centre.name}</Td>
                      <Td>{centre.region}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-nbts-border bg-nbts-panel p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
          Notification and audit
        </h2>
        <p className="text-sm text-nbts-ink">
          Approval emails: {recs.approvalEmailRecipients.length}. Auto-sent donor notifications: {recs.notificationIds.length}.{" "}
          <Link className="font-semibold text-nbts-blood underline" to={`/admin/activity?entityType=ai_analysis&entityId=${report.id}`}>
            View audit trail
          </Link>
        </p>
        {recs.failures.length || report.failureDetails ? (
          <pre className="mt-3 whitespace-pre-wrap rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {[...recs.failures, report.failureDetails].filter(Boolean).join("\n")}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
