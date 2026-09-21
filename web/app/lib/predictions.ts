/**
 * Predictions API helpers for the web app
 * (docs/05 Prediction Screen, docs/04 predictions/, TODO.md).
 * Presentation-only — forecast values, metrics, and severity stay API-owned.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  BLOOD_GROUP_OPTIONS,
  type PublicBloodGroup,
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
} from "~/lib/donors";

export type HorizonDays = 7 | 14 | 30 | 60;

export const HORIZON_DAY_OPTIONS = [7, 14, 30, 60] as const satisfies readonly HorizonDays[];

export type CandidateModelName =
  | "historical_average"
  | "moving_average"
  | "seasonal_naive"
  | "random_forest"
  | "hist_gradient_boosting";

/** Forecast preference sent as API `preferredModel` → AI `preferred_model`. */
export type PreferredForecastModel = CandidateModelName | "llm";

export const PREFERRED_FORECAST_MODEL_OPTIONS = [
  { value: "llm", label: "LLM (OpenAI — default)" },
  { value: "", label: "Statistical / ML (baselines)" },
] as const;

/** UI + API default when the Forecast form does not override. */
export const DEFAULT_PREFERRED_FORECAST_MODEL: PreferredForecastModel = "llm";

export type PredictionSeriesPoint = {
  date: string;
  units: number;
};

export type PredictionTrainSummary = {
  selectedModel: string;
  modelVersion: string;
  metrics?: {
    mae?: number | null;
    rmse?: number | null;
    wape?: number | null;
  } | null;
};

export type PredictionMetrics = {
  mae?: number | null;
  rmse?: number | null;
  wape?: number | null;
  horizonDays?: number;
  /** Daily forecast series (also mirrored on PublicPrediction.series). */
  predictions?: PredictionSeriesPoint[];
  train?: PredictionTrainSummary | null;
};

export type PublicPredictionFacility = {
  id: number;
  name: string;
  region?: string;
  district?: string;
};

export type PublicPrediction = {
  id: number;
  bloodGroupId: number;
  bloodGroup: PublicBloodGroup | null;
  facilityId: number | null;
  facility: PublicPredictionFacility | null;
  forecastStart: string;
  forecastEnd: string;
  predictedUnits: number;
  modelName: string;
  modelVersion: string | null;
  metrics: PredictionMetrics | null;
  /** Forecast daily series from API metrics (not historical actuals). */
  series: PredictionSeriesPoint[];
  createdAt: string;
};

export type ListPredictionsParams = {
  bloodGroupId?: number;
  bloodGroup?: string;
  facilityId?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type ListPredictionsResult = {
  predictions: PublicPrediction[];
  total: number;
  limit: number;
  offset: number;
};

export type LatestPredictionParams = {
  bloodGroupId?: number;
  bloodGroup?: string;
  facilityId?: number;
};

export type RunPredictionInput = {
  bloodGroupId?: number;
  bloodGroup?: string;
  facilityId?: number;
  horizonDays?: HorizonDays;
  syncDemand?: boolean;
  train?: boolean;
  candidateModels?: CandidateModelName[];
  /** Omit for AI default path; `llm` uses configured OpenAI (primary) or Ollama. */
  preferredModel?: PreferredForecastModel;
  from?: string;
  to?: string;
};

export type RunPredictionResult = {
  prediction: PublicPrediction;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toDateOnlyString(value: unknown): string {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match?.[1] ?? value.trim().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return "";
}

function toIsoString(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return "";
}

function toFiniteNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeBloodGroup(value: unknown): PublicBloodGroup | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  const code = typeof value.code === "string" ? value.code.trim() : "";
  if (!code) {
    return null;
  }
  return {
    id: value.id,
    code,
    abo: typeof value.abo === "string" ? value.abo : "",
    rh: typeof value.rh === "string" ? value.rh : "",
  };
}

function normalizeFacility(
  value: unknown,
): PublicPredictionFacility | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name.trim() : "",
    region:
      typeof value.region === "string" ? value.region.trim() : undefined,
    district:
      typeof value.district === "string" ? value.district.trim() : undefined,
  };
}

function normalizeSeriesPoint(value: unknown): PredictionSeriesPoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const date = toDateOnlyString(value.date);
  const units = toFiniteNumber(value.units, Number.NaN);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(units)) {
    return null;
  }
  return { date, units };
}

function normalizeTrainSummary(
  value: unknown,
): PredictionTrainSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const selectedModel =
    (typeof value.selected_model === "string"
      ? value.selected_model
      : typeof value.selectedModel === "string"
        ? value.selectedModel
        : ""
    ).trim();
  const modelVersion =
    (typeof value.model_version === "string"
      ? value.model_version
      : typeof value.modelVersion === "string"
        ? value.modelVersion
        : ""
    ).trim();
  if (!selectedModel) {
    return null;
  }

  let metrics: PredictionTrainSummary["metrics"] = null;
  if (isRecord(value.metrics)) {
    metrics = {
      mae:
        value.metrics.mae === null || value.metrics.mae === undefined
          ? null
          : toFiniteNumber(value.metrics.mae, Number.NaN),
      rmse:
        value.metrics.rmse === null || value.metrics.rmse === undefined
          ? null
          : toFiniteNumber(value.metrics.rmse, Number.NaN),
      wape:
        value.metrics.wape === null || value.metrics.wape === undefined
          ? null
          : toFiniteNumber(value.metrics.wape, Number.NaN),
    };
  }

  return {
    selectedModel,
    modelVersion: modelVersion || "—",
    metrics,
  };
}

function normalizeMetrics(value: unknown): PredictionMetrics | null {
  if (!isRecord(value)) {
    return null;
  }

  const seriesRaw = Array.isArray(value.predictions) ? value.predictions : [];
  const predictions = seriesRaw
    .map(normalizeSeriesPoint)
    .filter((point): point is PredictionSeriesPoint => point !== null);

  const horizonRaw = value.horizon_days ?? value.horizonDays;
  const horizonDays =
    typeof horizonRaw === "number" && Number.isFinite(horizonRaw)
      ? horizonRaw
      : undefined;

  return {
    mae:
      value.mae === null || value.mae === undefined
        ? null
        : toFiniteNumber(value.mae, Number.NaN),
    rmse:
      value.rmse === null || value.rmse === undefined
        ? null
        : toFiniteNumber(value.rmse, Number.NaN),
    wape:
      value.wape === null || value.wape === undefined
        ? null
        : toFiniteNumber(value.wape, Number.NaN),
    horizonDays,
    predictions,
    train: normalizeTrainSummary(value.train),
  };
}

/** Normalize a prediction DTO from the API (defensive). */
export function normalizePrediction(value: unknown): PublicPrediction | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const bloodGroupId =
    typeof value.bloodGroupId === "number" ? value.bloodGroupId : 0;
  if (!bloodGroupId) {
    return null;
  }

  const metrics = normalizeMetrics(value.metrics);
  const seriesFromRoot = Array.isArray(value.series)
    ? value.series
        .map(normalizeSeriesPoint)
        .filter((point): point is PredictionSeriesPoint => point !== null)
    : [];
  const series =
    seriesFromRoot.length > 0
      ? seriesFromRoot
      : (metrics?.predictions ?? []);

  const facilityId =
    typeof value.facilityId === "number" && value.facilityId > 0
      ? value.facilityId
      : null;

  return {
    id: value.id,
    bloodGroupId,
    bloodGroup: normalizeBloodGroup(value.bloodGroup),
    facilityId,
    facility: normalizeFacility(value.facility),
    forecastStart: toDateOnlyString(value.forecastStart),
    forecastEnd: toDateOnlyString(value.forecastEnd),
    predictedUnits: toFiniteNumber(value.predictedUnits),
    modelName:
      typeof value.modelName === "string" ? value.modelName.trim() : "",
    modelVersion:
      typeof value.modelVersion === "string" && value.modelVersion.trim()
        ? value.modelVersion.trim()
        : null,
    metrics,
    series,
    createdAt: toIsoString(value.createdAt),
  };
}

function extractPredictionList(
  data: Record<string, unknown> | null | undefined,
): unknown[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data.predictions)) {
    return data.predictions;
  }
  if (Array.isArray(data.items)) {
    return data.items;
  }
  return [];
}

function buildListQuery(params: ListPredictionsParams = {}): string {
  const search = new URLSearchParams();
  if (
    typeof params.bloodGroupId === "number" &&
    Number.isFinite(params.bloodGroupId) &&
    params.bloodGroupId > 0
  ) {
    search.set("bloodGroupId", String(params.bloodGroupId));
  }
  const bloodGroup = params.bloodGroup?.trim() || "";
  if (bloodGroup) {
    search.set("bloodGroup", bloodGroup);
  }
  if (
    typeof params.facilityId === "number" &&
    Number.isFinite(params.facilityId) &&
    params.facilityId > 0
  ) {
    search.set("facilityId", String(params.facilityId));
  }
  const from = params.from?.trim() || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    search.set("from", from);
  }
  const to = params.to?.trim() || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    search.set("to", to);
  }
  if (
    typeof params.limit === "number" &&
    Number.isFinite(params.limit) &&
    params.limit > 0
  ) {
    search.set("limit", String(params.limit));
  }
  if (
    typeof params.offset === "number" &&
    Number.isFinite(params.offset) &&
    params.offset >= 0
  ) {
    search.set("offset", String(params.offset));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function buildLatestQuery(params: LatestPredictionParams = {}): string {
  const search = new URLSearchParams();
  if (
    typeof params.bloodGroupId === "number" &&
    Number.isFinite(params.bloodGroupId) &&
    params.bloodGroupId > 0
  ) {
    search.set("bloodGroupId", String(params.bloodGroupId));
  }
  const bloodGroup = params.bloodGroup?.trim() || "";
  if (bloodGroup) {
    search.set("bloodGroup", bloodGroup);
  }
  if (
    typeof params.facilityId === "number" &&
    Number.isFinite(params.facilityId) &&
    params.facilityId > 0
  ) {
    search.set("facilityId", String(params.facilityId));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** GET /predictions */
export async function listPredictions(
  params: ListPredictionsParams = {},
): Promise<ListPredictionsResult> {
  const data = await apiFetch<Record<string, unknown>>(
    "/predictions" + buildListQuery(params),
    { method: "GET" },
  );

  const raw = extractPredictionList(data);
  const predictions = raw
    .map(normalizePrediction)
    .filter((item): item is PublicPrediction => item !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : predictions.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { predictions, total, limit, offset };
}

/**
 * GET /predictions/latest
 * Requires bloodGroup or bloodGroupId. Returns null when API has no row.
 */
export async function getLatestPrediction(
  params: LatestPredictionParams,
): Promise<PublicPrediction | null> {
  const data = await apiFetch<Record<string, unknown>>(
    "/predictions/latest" + buildLatestQuery(params),
    { method: "GET" },
  );

  const candidate = data?.prediction ?? data;
  if (candidate === null || candidate === undefined) {
    return null;
  }
  return normalizePrediction(candidate);
}

/** GET /predictions/:id */
export async function getPrediction(
  predictionId: number,
): Promise<PublicPrediction> {
  const data = await apiFetch<Record<string, unknown>>(
    `/predictions/${predictionId}`,
    { method: "GET" },
  );

  const candidate = data?.prediction ?? data;
  const prediction = normalizePrediction(candidate);
  if (!prediction) {
    throw new Error("Invalid prediction payload from API");
  }
  return prediction;
}

/** POST /predictions/run */
export async function runPrediction(
  input: RunPredictionInput,
): Promise<RunPredictionResult> {
  const body: Record<string, unknown> = {};

  if (
    typeof input.bloodGroupId === "number" &&
    Number.isFinite(input.bloodGroupId) &&
    input.bloodGroupId > 0
  ) {
    body.bloodGroupId = input.bloodGroupId;
  }
  const bloodGroup = input.bloodGroup?.trim() || "";
  if (bloodGroup) {
    body.bloodGroup = bloodGroup;
  }
  if (
    typeof input.facilityId === "number" &&
    Number.isFinite(input.facilityId) &&
    input.facilityId > 0
  ) {
    body.facilityId = input.facilityId;
  }
  if (
    input.horizonDays === 7 ||
    input.horizonDays === 14 ||
    input.horizonDays === 30 ||
    input.horizonDays === 60
  ) {
    body.horizonDays = input.horizonDays;
  }
  if (input.syncDemand === true) {
    body.syncDemand = true;
  }
  if (input.train === true) {
    body.train = true;
  }
  if (Array.isArray(input.candidateModels) && input.candidateModels.length > 0) {
    body.candidateModels = input.candidateModels;
  }
  const preferredModel = input.preferredModel?.trim() || "";
  if (isPreferredForecastModel(preferredModel)) {
    body.preferredModel = preferredModel;
  }
  const from = input.from?.trim() || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    body.from = from;
  }
  const to = input.to?.trim() || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    body.to = to;
  }

  const data = await apiFetch<Record<string, unknown>>("/predictions/run", {
    method: "POST",
    json: body,
  });

  const candidate = data?.prediction ?? data;
  const prediction = normalizePrediction(candidate);
  if (!prediction) {
    throw new Error("Invalid run-prediction payload from API");
  }
  return { prediction };
}

export function formatPredictionBloodGroup(
  prediction: PublicPrediction | null | undefined,
): string {
  const fromNested = prediction?.bloodGroup?.code?.trim();
  if (fromNested) {
    return fromNested;
  }
  const match = BLOOD_GROUP_OPTIONS.find(
    (group) => group.id === prediction?.bloodGroupId,
  );
  return match?.code || "—";
}

export function formatPredictionFacility(
  facility: PublicPredictionFacility | null | undefined,
  facilityId: number = 0,
): string {
  const name = facility?.name?.trim() || "";
  if (!name) {
    return facilityId > 0 ? `Facility #${facilityId}` : "National / all";
  }
  const region = facility?.region?.trim() || "";
  const district = facility?.district?.trim() || "";
  const place = [district, region].filter(Boolean).join(", ");
  return place ? `${name} (${place})` : name;
}

export function formatDateOnly(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "—";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) {
    return raw;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "—";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleString();
}

export function formatMetric(
  value: number | null | undefined,
  digits: number = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

export function formatPredictedUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function parseHorizonDays(
  value: string | null | undefined,
  fallback: HorizonDays = 7,
): HorizonDays {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (parsed === 7 || parsed === 14 || parsed === 30 || parsed === 60) {
    return parsed;
  }
  return fallback;
}

const PREFERRED_FORECAST_MODEL_SET = new Set<string>([
  "historical_average",
  "moving_average",
  "seasonal_naive",
  "random_forest",
  "hist_gradient_boosting",
  "llm",
]);

function isPreferredForecastModel(
  value: string,
): value is PreferredForecastModel {
  return PREFERRED_FORECAST_MODEL_SET.has(value);
}

/**
 * Parse form/API preferred model. Empty / unknown → undefined (AI default path).
 */
export function parsePreferredForecastModel(
  value: string | null | undefined,
): PreferredForecastModel | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return undefined;
  }
  return isPreferredForecastModel(raw) ? raw : undefined;
}

export function isValidDateOnly(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return false;
  }
  const [y, m, d] = raw.split("-").map(Number);
  if (
    typeof y !== "number" ||
    typeof m !== "number" ||
    typeof d !== "number" ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
  BLOOD_GROUP_OPTIONS,
};

export { ApiRequestError };
