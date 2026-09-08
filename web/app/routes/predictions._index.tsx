import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  data,
  type ClientActionFunctionArgs,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { ProtectedUi } from "~/components/auth/ProtectedUi";
import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { LoadingState } from "~/components/ui/LoadingState";
import { PageHeader } from "~/components/ui/PageHeader";
import {
  UI_PERMISSIONS,
  fetchAuthSession,
  hasUiPermission,
  type AuthSession,
} from "~/lib/auth";
import { listFacilities, type PublicFacility } from "~/lib/blood-requests";
import {
  BLOOD_GROUP_OPTIONS,
  ApiRequestError,
  formatApiErrorMessage,
  formatDateOnly,
  formatDateTime,
  formatMetric,
  formatPredictedUnits,
  formatPredictionBloodGroup,
  formatPredictionFacility,
  getLatestPrediction,
  isForbiddenApiError,
  isValidDateOnly,
  listPredictions,
  parseHorizonDays,
  parsePositiveInt,
  parsePreferredForecastModel,
  runPrediction,
  type HorizonDays,
  type PublicPrediction,
  HORIZON_DAY_OPTIONS,
  DEFAULT_PREFERRED_FORECAST_MODEL,
  PREFERRED_FORECAST_MODEL_OPTIONS,
} from "~/lib/predictions";

export const meta: MetaFunction = () => [
  { title: "Forecasts · NBTS Blood AI" },
];

type PredictionFilters = {
  bloodGroup: string;
  facilityId: string;
  from: string;
  to: string;
  latestBloodGroup: string;
  limit: number;
  offset: number;
};

type PredictionsIndexLoaderData =
  | {
      status: "ok";
      session: AuthSession;
      filters: PredictionFilters;
      predictions: PublicPrediction[];
      latest: PublicPrediction | null;
      latestError?: string;
      facilities: PublicFacility[];
      total: number;
      limit: number;
      offset: number;
      canRun: boolean;
    }
  | {
      status: "forbidden";
      session: AuthSession;
      message?: string;
      filters: PredictionFilters;
    }
  | {
      status: "error";
      session: AuthSession;
      message: string;
      filters: PredictionFilters;
    };

type PredictionsActionData = {
  error?: string;
  success?: string;
  predictionId?: number;
};

function parseFilters(url: URL): PredictionFilters {
  const bloodGroupRaw = (url.searchParams.get("bloodGroup") || "").trim();
  const bloodGroup = BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroupRaw)
    ? bloodGroupRaw
    : "";
  const latestRaw = (url.searchParams.get("latestBloodGroup") || "").trim();
  const latestBloodGroup = BLOOD_GROUP_OPTIONS.some((g) => g.code === latestRaw)
    ? latestRaw
    : bloodGroup || BLOOD_GROUP_OPTIONS[0]?.code || "O+";
  const facilityId = (url.searchParams.get("facilityId") || "").trim();
  const fromRaw = (url.searchParams.get("from") || "").trim();
  const toRaw = (url.searchParams.get("to") || "").trim();
  const from = isValidDateOnly(fromRaw) ? fromRaw : "";
  const to = isValidDateOnly(toRaw) ? toRaw : "";
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get("limit"), 50) || 50,
    100,
  );
  const offsetRaw = Number.parseInt(
    String(url.searchParams.get("offset") ?? "0").trim(),
    10,
  );
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  return {
    bloodGroup,
    facilityId,
    from,
    to,
    latestBloodGroup,
    limit,
    offset,
  };
}

export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<PredictionsIndexLoaderData> {
  const url = new URL(request.url);
  const filters = parseFilters(url);

  const session = await fetchAuthSession();
  if (!session) {
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!hasUiPermission(session, UI_PERMISSIONS.predictionsRead)) {
    return {
      status: "forbidden",
      session,
      message:
        "Your session does not include predictions:read. The API remains the access authority.",
      filters,
    };
  }

  const facilityIdNum = parsePositiveInt(filters.facilityId);

  try {
    const [listResult, facilities, latestResult] = await Promise.all([
      listPredictions({
        bloodGroup: filters.bloodGroup || undefined,
        facilityId: Number.isFinite(facilityIdNum) ? facilityIdNum : undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        limit: filters.limit,
        offset: filters.offset,
      }),
      listFacilities({ active: true }).catch(() => [] as PublicFacility[]),
      getLatestPrediction({
        bloodGroup: filters.latestBloodGroup || undefined,
        facilityId: Number.isFinite(facilityIdNum) ? facilityIdNum : undefined,
      })
        .then((prediction) => ({
          prediction,
          error: undefined as string | undefined,
        }))
        .catch((error: unknown) => {
          if (
            error instanceof ApiRequestError &&
            (error.status === 404 || error.code === "NOT_FOUND")
          ) {
            return {
              prediction: null as PublicPrediction | null,
              error: undefined as string | undefined,
            };
          }
          return {
            prediction: null as PublicPrediction | null,
            error: formatApiErrorMessage(
              error,
              "Unable to load latest prediction for this blood group.",
            ),
          };
        }),
    ]);

    return {
      status: "ok",
      session,
      filters,
      predictions: listResult.predictions ?? [],
      latest: latestResult.prediction,
      latestError: latestResult.error,
      facilities: facilities ?? [],
      total: listResult.total ?? 0,
      limit: listResult.limit ?? filters.limit,
      offset: listResult.offset ?? filters.offset,
      canRun: hasUiPermission(session, UI_PERMISSIONS.predictionsRun),
    };
  } catch (error) {
    if (isForbiddenApiError(error)) {
      return {
        status: "forbidden",
        session,
        message: formatApiErrorMessage(
          error,
          "You do not have permission to view predictions.",
        ),
        filters,
      };
    }
    return {
      status: "error",
      session,
      message: formatApiErrorMessage(error, "Unable to load predictions."),
      filters,
    };
  }
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingState label="Loading forecasts…" />;
}

export async function clientAction({
  request,
}: ClientActionFunctionArgs) {
  const session = await fetchAuthSession().catch(() => null);
  if (!session || !hasUiPermission(session, UI_PERMISSIONS.predictionsRun)) {
    return data<PredictionsActionData>(
      { error: "You do not have permission to run forecasts (predictions:run)." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "run").trim();
  if (intent !== "run") {
    return data<PredictionsActionData>(
      { error: "Unknown action." },
      { status: 400 },
    );
  }

  const bloodGroup = String(formData.get("bloodGroup") || "").trim();
  if (!BLOOD_GROUP_OPTIONS.some((g) => g.code === bloodGroup)) {
    return data<PredictionsActionData>(
      { error: "Select a valid blood group." },
      { status: 400 },
    );
  }

  const facilityRaw = String(formData.get("facilityId") || "").trim();
  const facilityId = facilityRaw ? parsePositiveInt(facilityRaw) : Number.NaN;
  const horizonDays = parseHorizonDays(
    String(formData.get("horizonDays") || "7"),
    7,
  ) as HorizonDays;
  const preferredModel =
    parsePreferredForecastModel(
      String(formData.get("preferredModel") || ""),
    ) ?? DEFAULT_PREFERRED_FORECAST_MODEL;
  const syncDemand = String(formData.get("syncDemand") || "") === "on";
  const train = String(formData.get("train") || "") === "on";
  const fromRaw = String(formData.get("from") || "").trim();
  const toRaw = String(formData.get("to") || "").trim();
  const from = isValidDateOnly(fromRaw) ? fromRaw : undefined;
  const to = isValidDateOnly(toRaw) ? toRaw : undefined;

  if (from && to && from > to) {
    return data<PredictionsActionData>(
      { error: "`from` must be on or before `to`." },
      { status: 400 },
    );
  }

  try {
    const result = await runPrediction({
      bloodGroup,
      facilityId: Number.isFinite(facilityId) ? facilityId : undefined,
      horizonDays,
      preferredModel,
      syncDemand,
      train,
      from,
      to,
    });
    return data<PredictionsActionData>({
      success: `Forecast #${result.prediction.id} saved (${formatPredictedUnits(result.prediction.predictedUnits)} units).`,
      predictionId: result.prediction.id,
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    return data<PredictionsActionData>(
      {
        error: formatApiErrorMessage(error, "Unable to run forecast."),
      },
      {
        status:
          error instanceof ApiRequestError && error.status >= 400
            ? error.status
            : 500,
      },
    );
  }
}

const inputClass =
  "rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal";

function buildPageQuery(
  filters: PredictionFilters,
  offset: number,
  limit: number,
): string {
  return new URLSearchParams({
    ...(filters.bloodGroup ? { bloodGroup: filters.bloodGroup } : {}),
    ...(filters.facilityId ? { facilityId: filters.facilityId } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    latestBloodGroup: filters.latestBloodGroup,
    limit: String(limit),
    offset: String(offset),
  }).toString();
}

export default function PredictionsIndexPage() {
  const loaderData = useLoaderData<PredictionsIndexLoaderData>();
  const actionData = useActionData<PredictionsActionData>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isFiltering =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/predictions";
  const isRunning =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "run";

  const filters =
    loaderData?.filters ??
    parseFilters(new URL("http://local/predictions"));

  if (loaderData?.status === "forbidden") {
    return (
      <div>
        <PageHeader
          title="Forecasts"
          description="Historical demand vs forecast values, model metadata, and evaluation metrics — all from the API."
        />
        <ForbiddenState
          title="Predictions access restricted"
          message={
            loaderData.message ||
            "You do not have permission to view forecasts (predictions:read)."
          }
          detail="UI gate only — the API enforces authorization."
        />
      </div>
    );
  }

  if (loaderData?.status === "error") {
    return (
      <div>
        <PageHeader
          title="Forecasts"
          description="Historical demand vs forecast values, model metadata, and evaluation metrics — all from the API."
        />
        <ErrorState
          title="Unable to load forecasts"
          message={loaderData.message}
        />
      </div>
    );
  }

  const predictions = loaderData?.predictions ?? [];
  const facilities = loaderData?.facilities ?? [];
  const latest = loaderData?.latest ?? null;
  const total = loaderData?.total ?? 0;
  const limit = loaderData?.limit ?? filters.limit;
  const offset = loaderData?.offset ?? filters.offset;
  const canRun = loaderData?.canRun === true;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;

  return (
    <div>
      <PageHeader
        title="Forecasts"
        description="Forecast values, model metadata, and evaluation metrics come from the API. This UI never invents demand numbers."
        actions={
          canRun ? (
            <a
              href="#run-forecast"
              className="inline-flex rounded bg-nbts-blood px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Run forecast
            </a>
          ) : null
        }
      />

      {actionData?.error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionData.error}
        </div>
      ) : null}
      {actionData?.success ? (
        <div className="mb-4 rounded border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-nbts-teal">
          {actionData.success}{" "}
          {actionData.predictionId ? (
            <Link
              to={`/predictions/${actionData.predictionId}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              View detail
            </Link>
          ) : null}
        </div>
      ) : null}

      <section className="mb-8 rounded-lg border border-nbts-border bg-nbts-panel p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-nbts-muted">
          Latest forecast
        </h2>
        <p className="mt-1 text-sm text-nbts-muted">
          GET /predictions/latest — blood group required. Series below are{" "}
          <span className="font-medium text-nbts-ink">forecast values</span>, not
          historical actuals.
        </p>
        <Form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-nbts-muted">
            Blood group
            <select
              name="latestBloodGroup"
              defaultValue={filters.latestBloodGroup}
              className={inputClass}
            >
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.code}
                </option>
              ))}
            </select>
          </label>
          {filters.bloodGroup ? (
            <input type="hidden" name="bloodGroup" value={filters.bloodGroup} />
          ) : null}
          {filters.facilityId ? (
            <input type="hidden" name="facilityId" value={filters.facilityId} />
          ) : null}
          {filters.from ? (
            <input type="hidden" name="from" value={filters.from} />
          ) : null}
          {filters.to ? <input type="hidden" name="to" value={filters.to} /> : null}
          <input type="hidden" name="limit" value={String(limit)} />
          <input type="hidden" name="offset" value="0" />
          <button
            type="submit"
            className="rounded border border-nbts-border bg-white px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Refresh latest
          </button>
        </Form>

        {loaderData?.latestError ? (
          <p className="mt-3 text-sm text-nbts-amber">
            {loaderData.latestError}
          </p>
        ) : null}

        {latest ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-nbts-muted">Prediction</p>
              <Link
                to={`/predictions/${latest.id}`}
                className="text-lg font-semibold text-nbts-teal underline-offset-2 hover:underline"
              >
                #{latest.id}
              </Link>
            </div>
            <div>
              <p className="text-xs uppercase text-nbts-muted">Blood group</p>
              <p className="text-lg font-semibold text-nbts-ink">
                {formatPredictionBloodGroup(latest)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-nbts-muted">
                Predicted units (forecast)
              </p>
              <p className="text-lg font-semibold text-nbts-ink">
                {formatPredictedUnits(latest.predictedUnits)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-nbts-muted">Model</p>
              <p className="text-sm font-medium text-nbts-ink">
                {latest.modelName || "—"}
                {latest.modelVersion ? (
                  <span className="text-nbts-muted">
                    {" "}
                    · {latest.modelVersion}
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-nbts-muted">Forecast period</p>
              <p className="text-sm text-nbts-ink">
                {formatDateOnly(latest.forecastStart)} →{" "}
                {formatDateOnly(latest.forecastEnd)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-nbts-muted">Generated</p>
              <p className="text-sm text-nbts-ink">
                {formatDateTime(latest.createdAt)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-nbts-muted">Metrics</p>
              <p className="text-sm text-nbts-ink">
                MAE {formatMetric(latest.metrics?.mae)} · RMSE{" "}
                {formatMetric(latest.metrics?.rmse)} · WAPE{" "}
                {formatMetric(latest.metrics?.wape)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-nbts-muted">Facility</p>
              <p className="text-sm text-nbts-ink">
                {formatPredictionFacility(latest.facility, latest.facilityId ?? 0)}
              </p>
            </div>
          </div>
        ) : !loaderData?.latestError ? (
          <EmptyState
            title="No latest forecast"
            description={`No persisted prediction for ${filters.latestBloodGroup}. Run a forecast below.`}
          />
        ) : null}
      </section>

      <ProtectedUi
        session={loaderData?.session}
        gate={UI_PERMISSIONS.predictionsRun}
        fallback={null}
      >
        <section
          id="run-forecast"
          className="mb-8 rounded-lg border border-nbts-border bg-nbts-panel p-4"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-nbts-muted">
            Run forecast
          </h2>
          <p className="mt-1 text-sm text-nbts-muted">
            POST /predictions/run — the API calls the AI service and persists
            the result. Optional demand sync / train are API-owned.
          </p>
          <Form method="post" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="intent" value="run" />
            <label className="flex flex-col gap-1 text-xs text-nbts-muted">
              Blood group
              <select
                name="bloodGroup"
                required
                defaultValue={filters.latestBloodGroup || "O+"}
                className={inputClass}
              >
                {BLOOD_GROUP_OPTIONS.map((group) => (
                  <option key={group.code} value={group.code}>
                    {group.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-nbts-muted">
              Facility (optional)
              <select name="facilityId" defaultValue="" className={inputClass}>
                <option value="">National / all</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={String(facility.id)}>
                    {facility.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-nbts-muted">
              Horizon (days)
              <select
                name="horizonDays"
                defaultValue="7"
                className={inputClass}
              >
                {HORIZON_DAY_OPTIONS.map((days) => (
                  <option key={days} value={String(days)}>
                    {days}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-nbts-muted">
              Forecast model
              <select
                name="preferredModel"
                defaultValue={DEFAULT_PREFERRED_FORECAST_MODEL}
                className={inputClass}
              >
                {PREFERRED_FORECAST_MODEL_OPTIONS.map((option) => (
                  <option key={option.value || "baselines"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-nbts-muted">
              History from (optional)
              <input type="date" name="from" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-nbts-muted">
              History to (optional)
              <input type="date" name="to" className={inputClass} />
            </label>
            <div className="flex flex-col gap-2 text-sm text-nbts-ink sm:col-span-2 lg:col-span-1">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="syncDemand" />
                Sync demand before forecast
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="train" />
                Train models first (slower)
              </label>
              <p className="text-xs text-nbts-muted">
                Default LLM path uses OpenAI (
                <code className="text-nbts-ink">OPENAI_API_KEY</code>, model{" "}
                <code className="text-nbts-ink">gpt-4o-mini</code>). For local
                phi4 set <code className="text-nbts-ink">LLM_PROVIDER=ollama</code>
                . Choose Statistical / ML to skip the LLM.
              </p>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <button
                type="submit"
                disabled={isRunning}
                className="inline-flex rounded bg-nbts-blood px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {isRunning ? "Running…" : "Run forecast"}
              </button>
            </div>
          </Form>
        </section>
      </ProtectedUi>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-nbts-muted">
          Prediction history
        </h2>
        <Form
          method="get"
          className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-nbts-border bg-nbts-panel p-4"
        >
          <label className="flex flex-col gap-1 text-xs text-nbts-muted">
            Blood group
            <select
              name="bloodGroup"
              defaultValue={filters.bloodGroup}
              className={inputClass}
            >
              <option value="">All</option>
              {BLOOD_GROUP_OPTIONS.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-nbts-muted">
            Facility
            <select
              name="facilityId"
              defaultValue={filters.facilityId}
              className={inputClass}
            >
              <option value="">All</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={String(facility.id)}>
                  {facility.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-nbts-muted">
            From
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-nbts-muted">
            To
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className={inputClass}
            />
          </label>
          <input
            type="hidden"
            name="latestBloodGroup"
            value={filters.latestBloodGroup}
          />
          <input type="hidden" name="limit" value={String(limit)} />
          <input type="hidden" name="offset" value="0" />
          <button
            type="submit"
            className="rounded border border-nbts-border bg-white px-3 py-2 text-sm font-medium text-nbts-ink hover:border-nbts-muted"
          >
            Apply filters
          </button>
          {(filters.bloodGroup ||
            filters.facilityId ||
            filters.from ||
            filters.to ||
            searchParams.toString()) && (
            <Link
              to="/predictions"
              className="rounded px-3 py-2 text-sm text-nbts-muted underline-offset-2 hover:underline"
            >
              Clear
            </Link>
          )}
        </Form>

        {isFiltering ? (
          <LoadingState label="Updating forecasts…" />
        ) : predictions.length === 0 ? (
          <EmptyState
            title="No predictions yet"
            description="Run a forecast via the form above, or adjust filters. Values only appear after the API persists them."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-nbts-border bg-nbts-panel">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-nbts-border bg-nbts-surface text-xs uppercase tracking-wide text-nbts-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Blood group</th>
                    <th className="px-4 py-3 font-medium">Period</th>
                    <th className="px-4 py-3 font-medium">
                      Predicted units
                    </th>
                    <th className="px-4 py-3 font-medium">Model</th>
                    <th className="px-4 py-3 font-medium">Generated</th>
                    <th className="px-4 py-3 font-medium">Facility</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((prediction) => (
                    <tr
                      key={prediction.id}
                      className="border-b border-nbts-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/predictions/${prediction.id}`}
                          className="font-medium text-nbts-teal underline-offset-2 hover:underline"
                        >
                          #{prediction.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {formatPredictionBloodGroup(prediction)}
                      </td>
                      <td className="px-4 py-3 text-nbts-muted">
                        {formatDateOnly(prediction.forecastStart)} →{" "}
                        {formatDateOnly(prediction.forecastEnd)}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatPredictedUnits(prediction.predictedUnits)}
                      </td>
                      <td className="px-4 py-3">
                        {prediction.modelName || "—"}
                        {prediction.modelVersion ? (
                          <span className="block text-xs text-nbts-muted">
                            {prediction.modelVersion}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-nbts-muted">
                        {formatDateTime(prediction.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-nbts-muted">
                        {formatPredictionFacility(
                          prediction.facility,
                          prediction.facilityId ?? 0,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-nbts-muted">
              <span>
                Showing {offset + 1}–{Math.min(offset + predictions.length, total)}{" "}
                of {total}
              </span>
              <div className="flex gap-2">
                {hasPrev ? (
                  <Link
                    to={`/predictions?${buildPageQuery(filters, prevOffset, limit)}`}
                    className="rounded border border-nbts-border px-3 py-1.5 text-nbts-ink hover:border-nbts-muted"
                  >
                    Previous
                  </Link>
                ) : null}
                {hasNext ? (
                  <Link
                    to={`/predictions?${buildPageQuery(filters, nextOffset, limit)}`}
                    className="rounded border border-nbts-border px-3 py-1.5 text-nbts-ink hover:border-nbts-muted"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
