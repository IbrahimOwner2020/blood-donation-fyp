import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  data,
  type ClientActionFunctionArgs,
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
  AI_ANALYSIS_NOTIFICATION_MODE_OPTIONS,
  formatApiErrorMessage,
  getAiAnalysisSettings,
  listAiAnalysisReports,
  runAiAnalysis,
  updateAiAnalysisSettings,
  type AiAnalysisNotificationMode,
  type PublicAiAnalysisRun,
} from "~/lib/ai-analysis";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import { formatDateTime } from "~/lib/predictions";

export const meta: MetaFunction = () => [
  { title: "AI Reports · NBTS Blood AI" },
];

type LoaderData =
  | {
      status: "ok";
      session: AuthSession;
      reports: PublicAiAnalysisRun[];
      total: number;
      settingsMode: AiAnalysisNotificationMode;
      canRun: boolean;
      canManageSettings: boolean;
    }
  | { status: "forbidden"; session: AuthSession; message: string }
  | { status: "error"; session: AuthSession; message: string };

type ActionData = {
  error?: string;
  success?: string;
  reportId?: number;
};

export async function clientLoader({
  request,
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

  try {
    const [list, settings] = await Promise.all([
      listAiAnalysisReports({ limit: 50 }),
      getAiAnalysisSettings(),
    ]);
    return {
      status: "ok",
      session,
      reports: list.reports,
      total: list.total,
      settingsMode: settings.notificationMode,
      canRun: hasUiPermission(session, UI_PERMISSIONS.predictionsRun),
      canManageSettings:
        hasUiPermission(session, UI_PERMISSIONS.predictionsRun) &&
        hasUiPermission(session, UI_PERMISSIONS.notificationsSend),
    };
  } catch (error) {
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load AI reports."),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading AI reports…" />;
}

function parseMode(value: FormDataEntryValue | null): AiAnalysisNotificationMode | null {
  const raw = String(value ?? "").trim();
  return AI_ANALYSIS_NOTIFICATION_MODE_OPTIONS.some((item) => item.value === raw)
    ? (raw as AiAnalysisNotificationMode)
    : null;
}

export async function clientAction({
  request,
}: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  if (!session) {
    return data<ActionData>({ error: "Sign in first." }, { status: 401 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();

  try {
    if (intent === "run") {
      if (!hasUiPermission(session, UI_PERMISSIONS.predictionsRun)) {
        return data<ActionData>({ error: "You do not have permission to run AI analysis." }, { status: 403 });
      }
      const mode = parseMode(formData.get("notificationMode")) ?? undefined;
      const report = await runAiAnalysis({ horizonDays: 60, notificationMode: mode });
      return data<ActionData>({
        success: `AI report #${report.id} completed with ${report.recommendations.shortages.length} shortage recommendation(s).`,
        reportId: report.id,
      });
    }

    if (intent === "settings") {
      if (
        !hasUiPermission(session, UI_PERMISSIONS.predictionsRun) ||
        !hasUiPermission(session, UI_PERMISSIONS.notificationsSend)
      ) {
        return data<ActionData>({ error: "You do not have permission to update AI analysis settings." }, { status: 403 });
      }
      const mode = parseMode(formData.get("notificationMode"));
      if (!mode) {
        return data<ActionData>({ error: "Choose a valid notification mode." }, { status: 400 });
      }
      await updateAiAnalysisSettings(mode);
      return data<ActionData>({ success: "AI notification setting updated." });
    }
  } catch (error) {
    return data<ActionData>(
      { error: formatApiErrorMessage(error, "Unable to update AI analysis.") },
      { status: 500 },
    );
  }

  return data<ActionData>({ error: "Unknown action." }, { status: 400 });
}

const selectClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full border border-nbts-border px-2 py-1 text-xs font-medium text-nbts-ink">
      {status}
    </span>
  );
}

export default function AiReportsIndexPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  if (loaderData.status === "forbidden") {
    return <ForbiddenState title="AI reports unavailable" message={loaderData.message} />;
  }
  if (loaderData.status === "error") {
    return <ErrorState title="Unable to load AI reports" message={loaderData.message} />;
  }

  return (
    <div>
      <PageHeader
        title="AI Reports"
        description="Daily supply analysis, shortage conclusions, donor recommendations, and AI audit context."
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-lg border border-nbts-border bg-nbts-panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
            Daily analysis
          </h2>
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="run" />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-nbts-ink">Notification mode</span>
              <select
                name="notificationMode"
                defaultValue={loaderData.settingsMode}
                className={selectClass}
                disabled={!loaderData.canRun}
              >
                {AI_ANALYSIS_NOTIFICATION_MODE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={!loaderData.canRun || isSubmitting}
              className="rounded bg-nbts-blood px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isSubmitting ? "Running…" : "Run 60-day analysis"}
            </button>
          </Form>
        </section>

        <section className="rounded-lg border border-nbts-border bg-nbts-panel p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
            Default setting
          </h2>
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="settings" />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-nbts-ink">Scheduled behavior</span>
              <select
                name="notificationMode"
                defaultValue={loaderData.settingsMode}
                className={selectClass}
                disabled={!loaderData.canManageSettings}
              >
                {AI_ANALYSIS_NOTIFICATION_MODE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={!loaderData.canManageSettings || isSubmitting}
              className="rounded border border-nbts-border px-4 py-2 text-sm font-semibold text-nbts-ink disabled:opacity-50"
            >
              Save setting
            </button>
          </Form>
        </section>
      </div>

      {actionData?.error ? (
        <ErrorState title="AI report action failed" message={actionData.error} />
      ) : null}
      {actionData?.success ? (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {actionData.success}{" "}
          {actionData.reportId ? <Link className="font-semibold underline" to={`/ai-reports/${actionData.reportId}`}>Open report</Link> : null}
        </div>
      ) : null}

      {loaderData.reports.length === 0 ? (
        <EmptyState title="No AI reports" description="Daily AI analysis reports will appear here after the first run." />
      ) : (
        <div className="rounded-lg border border-nbts-border bg-nbts-panel">
          <Table caption="AI analysis reports">
            <THead>
              <Tr>
                <Th>Report</Th>
                <Th>Status</Th>
                <Th>Risk</Th>
                <Th>Trigger</Th>
                <Th>Shortages</Th>
                <Th>Generated</Th>
              </Tr>
            </THead>
            <TBody>
              {loaderData.reports.map((report) => (
                <Tr key={report.id}>
                  <Td>
                    <Link className="font-semibold text-nbts-blood underline" to={`/ai-reports/${report.id}`}>
                      AI report #{report.id}
                    </Link>
                    <p className="mt-1 max-w-xl truncate text-xs text-nbts-muted">
                      {report.conclusion}
                    </p>
                  </Td>
                  <Td><StatusPill status={report.status} /></Td>
                  <Td>{report.riskLevel}</Td>
                  <Td>{report.triggerType}</Td>
                  <Td>{report.recommendations.shortages.length}</Td>
                  <Td>{formatDateTime(report.createdAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}
