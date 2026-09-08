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
import { ApiRequestError } from "~/lib/api";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import {
  formatApiErrorMessage,
  formatDateOnly,
  formatDateTime,
  formatMetric,
  formatPredictedUnits,
  formatPredictionBloodGroup,
  formatPredictionFacility,
  getPrediction,
  isForbiddenApiError,
  parsePositiveInt,
  type PublicPrediction,
} from "~/lib/predictions";

export const meta: MetaFunction = () => [
  { title: "Prediction detail · NBTS Blood AI" },
];

type PredictionDetailLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      prediction: PublicPrediction;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      predictionId: string;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      predictionId: string;
    }
  | {
      status: "not_found";
      session: AuthSession;
      message: string;
      predictionId: string;
    };

export async function clientLoader({
  request,
  params,
}: ClientLoaderFunctionArgs): Promise<PredictionDetailLoaderData> {
  const predictionIdParam = params?.id || "";
  const predictionId = parsePositiveInt(predictionIdParam);

  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.predictionsRead)) {
    return {
      status: "forbidden",
      session,
      predictionId: predictionIdParam,
      message:
        "Your session does not include predictions:read. The API remains the access authority.",
    };
  }

  if (!Number.isFinite(predictionId)) {
    return {
      status: "not_found",
      session,
      predictionId: predictionIdParam,
      message: "Invalid prediction id.",
    };
  }

  try {
    const prediction = await getPrediction(predictionId);
    return { status: "ok", session, prediction };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        predictionId: predictionIdParam,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view this prediction.",
        ),
      };
    }
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.code === "NOT_FOUND")
    ) {
      return {
        status: "not_found",
        session,
        predictionId: predictionIdParam,
        message: formatApiErrorMessage(error, "Prediction not found."),
      };
    }
    return {
      status: "error",
      session,
      predictionId: predictionIdParam,
      message: formatApiErrorMessage(error, "Unable to load prediction."),
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading prediction…" />;
}

export default function PredictionDetailPage() {
  const loaderData = useLoaderData<PredictionDetailLoaderData>();

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader title="Prediction detail" description="Forecast detail." />
        <ForbiddenState
          title="Predictions access restricted"
          message={
            loaderData.message ||
            "You do not have permission to view predictions (predictions:read)."
          }
          detail="UI gate only — the API enforces authorization."
          action={
            <Link
              to="/predictions"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to forecasts
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "not_found") {
    return (
      <div>
        <PageHeader
          title={`Prediction #${loaderData.predictionId}`}
          description="GET /predictions/:id"
        />
        <EmptyState
          title="Prediction not found"
          description={loaderData.message}
          action={
            <Link
              to="/predictions"
              className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
            >
              Back to forecasts
            </Link>
          }
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader
          title={`Prediction #${loaderData.predictionId}`}
          description="GET /predictions/:id"
        />
        <ErrorState
          title="Unable to load prediction"
          message={loaderData.message}
        />
        <div className="mt-3">
          <Link
            to="/predictions"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Back to forecasts
          </Link>
        </div>
      </div>
    );
  }

  const prediction = loaderData?.prediction;
  if (!prediction) {
    return (
      <div>
        <PageHeader title="Prediction detail" />
        <EmptyState
          title="Prediction not loaded"
          description="Unexpected empty loader state."
        />
      </div>
    );
  }

  const series = prediction.series ?? [];
  const metrics = prediction.metrics;

  return (
    <div>
      <PageHeader
        title={`Prediction #${prediction.id}`}
        description="Forecast values are labeled separately from any historical demand the API may supply elsewhere. Metrics and model fields are API-owned."
        actions={
          <Link
            to="/predictions"
            className="inline-flex rounded border border-nbts-border px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            All forecasts
          </Link>
        }
      />

      <dl className="mb-8 grid gap-4 rounded-lg border border-nbts-border bg-nbts-panel p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Blood group
          </dt>
          <dd className="mt-1 text-lg font-semibold text-nbts-ink">
            {formatPredictionBloodGroup(prediction)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Predicted units (forecast)
          </dt>
          <dd className="mt-1 text-lg font-semibold text-nbts-ink">
            {formatPredictedUnits(prediction.predictedUnits)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Forecast period
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDateOnly(prediction.forecastStart)} →{" "}
            {formatDateOnly(prediction.forecastEnd)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Model
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {prediction.modelName || "—"}
            {prediction.modelVersion ? (
              <span className="text-nbts-muted">
                {" "}
                · {prediction.modelVersion}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Generated
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatDateTime(prediction.createdAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Facility
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {formatPredictionFacility(
              prediction.facility,
              prediction.facilityId ?? 0,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Horizon (days)
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            {metrics?.horizonDays ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-nbts-muted">
            Evaluation metrics
          </dt>
          <dd className="mt-1 text-sm text-nbts-ink">
            MAE {formatMetric(metrics?.mae)} · RMSE {formatMetric(metrics?.rmse)}{" "}
            · WAPE {formatMetric(metrics?.wape)}
          </dd>
        </div>
        {metrics?.train ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs uppercase tracking-wide text-nbts-muted">
              Train summary
            </dt>
            <dd className="mt-1 text-sm text-nbts-ink">
              Selected {metrics.train.selectedModel}
              {metrics.train.modelVersion
                ? ` (${metrics.train.modelVersion})`
                : ""}
              {metrics.train.metrics
                ? ` — MAE ${formatMetric(metrics.train.metrics.mae)}, RMSE ${formatMetric(metrics.train.metrics.rmse)}, WAPE ${formatMetric(metrics.train.metrics.wape)}`
                : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
          Daily forecast series
        </h2>
        <p className="mb-3 text-sm text-nbts-muted">
          These rows are <strong className="font-medium text-nbts-ink">forecast</strong>{" "}
          demand units from the AI run — not historical actual demand.
        </p>
        {series.length === 0 ? (
          <EmptyState
            title="No daily series"
            description="The API did not include a predictions[] series in metrics for this record."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">
                    Forecast units
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr
                    key={point.date}
                    className="border-b border-nbts-border last:border-0"
                  >
                    <td className="px-4 py-3">
                      {formatDateOnly(point.date)}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatPredictedUnits(point.units)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
