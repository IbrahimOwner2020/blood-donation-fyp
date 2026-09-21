import { apiFetch } from "~/lib/api";
import { formatApiErrorMessage as formatDonorApiErrorMessage } from "~/lib/donors";

export type AiAnalysisNotificationMode =
  | "REQUIRE_APPROVAL"
  | "AUTO_SEND"
  | "REPORT_ONLY";

export const AI_ANALYSIS_NOTIFICATION_MODE_OPTIONS = [
  { value: "REQUIRE_APPROVAL", label: "Require approval" },
  { value: "AUTO_SEND", label: "Auto-send" },
  { value: "REPORT_ONLY", label: "Report only" },
] as const satisfies readonly {
  value: AiAnalysisNotificationMode;
  label: string;
}[];

export type AiAnalysisRunStatus =
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";

export type AiAnalysisRunTrigger = "USER" | "SCHEDULED";
export type AiAnalysisRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AiAnalysisShortage = {
  alertId: number;
  predictionId: number;
  bloodGroupId: number;
  bloodGroupCode: string | null;
  severity: string;
  status: string;
  availableUnits: number;
  predictedUnits: number;
  projectedGap: number;
};

export type AiAnalysisDonorRecommendation = {
  id: number;
  donorNumber: string;
  firstName: string;
  lastName: string;
  bloodGroupCode: string | null;
  alertId: number;
  contactAvailable: boolean;
};

export type AiAnalysisCentreRecommendation = {
  id: number;
  name: string;
  region: string;
  address: string | null;
};

export type AiAnalysisRecommendations = {
  shortages: AiAnalysisShortage[];
  donors: AiAnalysisDonorRecommendation[];
  centres: AiAnalysisCentreRecommendation[];
  notificationIds: number[];
  approvalEmailRecipients: string[];
  failures: string[];
};

export type PublicAiAnalysisRun = {
  id: number;
  triggerType: AiAnalysisRunTrigger;
  triggeredByUserId: number | null;
  status: AiAnalysisRunStatus;
  horizonDays: number;
  riskLevel: AiAnalysisRiskLevel;
  notificationMode: AiAnalysisNotificationMode;
  conclusion: string;
  predictionIds: number[];
  alertIds: number[];
  recommendations: AiAnalysisRecommendations;
  failureDetails: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type AiAnalysisSettings = {
  notificationMode: AiAnalysisNotificationMode;
};

export type ListAiAnalysisResult = {
  reports: PublicAiAnalysisRun[];
  total: number;
  limit: number;
  offset: number;
};

const EMPTY_RECOMMENDATIONS: AiAnalysisRecommendations = {
  shortages: [],
  donors: [],
  centres: [],
  notificationIds: [],
  approvalEmailRecipients: [],
  failures: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toNumber(item, Number.NaN)).filter(Number.isFinite);
}

function normalizeRecommendations(value: unknown): AiAnalysisRecommendations {
  if (!isRecord(value)) return EMPTY_RECOMMENDATIONS;
  const shortages = Array.isArray(value.shortages)
    ? value.shortages.flatMap((item) => {
        if (!isRecord(item)) return [];
        return [{
          alertId: toNumber(item.alertId),
          predictionId: toNumber(item.predictionId),
          bloodGroupId: toNumber(item.bloodGroupId),
          bloodGroupCode: toStringOrNull(item.bloodGroupCode),
          severity: String(item.severity ?? ""),
          status: String(item.status ?? ""),
          availableUnits: toNumber(item.availableUnits),
          predictedUnits: toNumber(item.predictedUnits),
          projectedGap: toNumber(item.projectedGap),
        }];
      })
    : [];
  const donors = Array.isArray(value.donors)
    ? value.donors.flatMap((item) => {
        if (!isRecord(item)) return [];
        return [{
          id: toNumber(item.id),
          donorNumber: String(item.donorNumber ?? ""),
          firstName: String(item.firstName ?? ""),
          lastName: String(item.lastName ?? ""),
          bloodGroupCode: toStringOrNull(item.bloodGroupCode),
          alertId: toNumber(item.alertId),
          contactAvailable: Boolean(item.contactAvailable),
        }];
      })
    : [];
  const centres = Array.isArray(value.centres)
    ? value.centres.flatMap((item) => {
        if (!isRecord(item)) return [];
        return [{
          id: toNumber(item.id),
          name: String(item.name ?? ""),
          region: String(item.region ?? ""),
          address: toStringOrNull(item.address),
        }];
      })
    : [];
  const approvalEmailRecipients = Array.isArray(value.approvalEmailRecipients)
    ? value.approvalEmailRecipients.filter((item): item is string => typeof item === "string")
    : [];
  const failures = Array.isArray(value.failures)
    ? value.failures.filter((item): item is string => typeof item === "string")
    : [];

  return {
    shortages,
    donors,
    centres,
    notificationIds: toNumberArray(value.notificationIds),
    approvalEmailRecipients,
    failures,
  };
}

function normalizeReport(value: unknown): PublicAiAnalysisRun | null {
  if (!isRecord(value) || typeof value.id !== "number") return null;
  return {
    id: value.id,
    triggerType: value.triggerType === "SCHEDULED" ? "SCHEDULED" : "USER",
    triggeredByUserId:
      typeof value.triggeredByUserId === "number" ? value.triggeredByUserId : null,
    status: ["RUNNING", "COMPLETED", "PARTIAL", "FAILED"].includes(String(value.status))
      ? (String(value.status) as AiAnalysisRunStatus)
      : "FAILED",
    horizonDays: toNumber(value.horizonDays),
    riskLevel: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(value.riskLevel))
      ? (String(value.riskLevel) as AiAnalysisRiskLevel)
      : "LOW",
    notificationMode: ["REQUIRE_APPROVAL", "AUTO_SEND", "REPORT_ONLY"].includes(String(value.notificationMode))
      ? (String(value.notificationMode) as AiAnalysisNotificationMode)
      : "REQUIRE_APPROVAL",
    conclusion: String(value.conclusion ?? ""),
    predictionIds: toNumberArray(value.predictionIds),
    alertIds: toNumberArray(value.alertIds),
    recommendations: normalizeRecommendations(value.recommendations),
    failureDetails: toStringOrNull(value.failureDetails),
    startedAt: String(value.startedAt ?? ""),
    completedAt: toStringOrNull(value.completedAt),
    createdAt: String(value.createdAt ?? ""),
  };
}

export async function listAiAnalysisReports(params: {
  limit?: number;
  offset?: number;
} = {}): Promise<ListAiAnalysisResult> {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.offset) search.set("offset", String(params.offset));
  const data = await apiFetch<Record<string, unknown>>(
    `/ai-analysis${search.toString() ? `?${search.toString()}` : ""}`,
    { method: "GET" },
  );
  const reports = Array.isArray(data.reports)
    ? data.reports.map(normalizeReport).filter((item): item is PublicAiAnalysisRun => item !== null)
    : [];
  return {
    reports,
    total: toNumber(data.total, reports.length),
    limit: toNumber(data.limit, params.limit ?? 50),
    offset: toNumber(data.offset, params.offset ?? 0),
  };
}

export async function getAiAnalysisReport(id: number): Promise<PublicAiAnalysisRun> {
  const data = await apiFetch<Record<string, unknown>>(`/ai-analysis/${id}`, {
    method: "GET",
  });
  const report = normalizeReport(data.report);
  if (!report) throw new Error("Invalid AI analysis report payload from API");
  return report;
}

export async function runAiAnalysis(input: {
  horizonDays?: number;
  notificationMode?: AiAnalysisNotificationMode;
} = {}): Promise<PublicAiAnalysisRun> {
  const data = await apiFetch<Record<string, unknown>>("/ai-analysis/run", {
    method: "POST",
    json: input,
  });
  const report = normalizeReport(data.report);
  if (!report) throw new Error("Invalid AI analysis report payload from API");
  return report;
}

export async function getAiAnalysisSettings(): Promise<AiAnalysisSettings> {
  const data = await apiFetch<Record<string, unknown>>("/ai-analysis/settings", {
    method: "GET",
  });
  const raw = isRecord(data.settings) ? data.settings : {};
  const mode = String(raw.notificationMode ?? "");
  return {
    notificationMode: ["REQUIRE_APPROVAL", "AUTO_SEND", "REPORT_ONLY"].includes(mode)
      ? (mode as AiAnalysisNotificationMode)
      : "REQUIRE_APPROVAL",
  };
}

export async function updateAiAnalysisSettings(
  notificationMode: AiAnalysisNotificationMode,
): Promise<AiAnalysisSettings> {
  const data = await apiFetch<Record<string, unknown>>("/ai-analysis/settings", {
    method: "PATCH",
    json: { notificationMode },
  });
  const raw = isRecord(data.settings) ? data.settings : {};
  return {
    notificationMode: String(raw.notificationMode ?? notificationMode) as AiAnalysisNotificationMode,
  };
}

export const formatApiErrorMessage = formatDonorApiErrorMessage;
