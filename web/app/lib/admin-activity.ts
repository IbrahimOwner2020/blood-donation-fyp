/**
 * Admin activity / audit log API helpers (docs/05 /admin/activity, docs/10).
 * Presentation-only — RBAC and redaction authority live in the API.
 */

import { apiFetch, ApiRequestError } from "~/lib/api";
import {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
} from "~/lib/donors";

export type ActivityMetadataValue = string | number | boolean | null;

export type ActivityMetadata = Record<string, ActivityMetadataValue | undefined>;

export type PublicActivityLog = {
  id: number;
  userId: number | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: ActivityMetadata | null;
  ipAddress: string | null;
  createdAt: string;
};

export type ListActivityLogsParams = {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
};

export type ListActivityLogsResult = {
  activityLogs: PublicActivityLog[];
  total: number;
  limit: number;
  offset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrimitiveMetaValue(
  value: unknown,
): value is ActivityMetadataValue | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function normalizeMetadata(value: unknown): ActivityMetadata | null {
  if (!isRecord(value)) {
    return null;
  }
  const output: ActivityMetadata = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isPrimitiveMetaValue(entry)) {
      continue;
    }
    output[key] = entry;
  }
  return Object.keys(output).length > 0 ? output : null;
}

function normalizeCreatedAt(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return "";
}

/** Normalize an activity log DTO from the API (defensive). */
export function normalizeActivityLog(value: unknown): PublicActivityLog | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const userId =
    typeof value.userId === "number" && Number.isFinite(value.userId)
      ? value.userId
      : null;
  const actorName =
    typeof value.actorName === "string" && value.actorName.trim()
      ? value.actorName.trim()
      : null;
  const action = typeof value.action === "string" ? value.action.trim() : "";
  const entityType =
    typeof value.entityType === "string" ? value.entityType.trim() : "";
  const entityId =
    typeof value.entityId === "string" && value.entityId.trim()
      ? value.entityId.trim()
      : null;
  const ipAddress =
    typeof value.ipAddress === "string" && value.ipAddress.trim()
      ? value.ipAddress.trim()
      : null;

  return {
    id: value.id,
    userId,
    actorName,
    action: action || "—",
    entityType: entityType || "—",
    entityId,
    metadata: normalizeMetadata(value.metadata),
    ipAddress,
    createdAt: normalizeCreatedAt(value.createdAt),
  };
}

function buildActivityLogsQuery(params: ListActivityLogsParams = {}): string {
  const search = new URLSearchParams();

  if (
    typeof params.userId === "number" &&
    Number.isFinite(params.userId) &&
    params.userId > 0
  ) {
    search.set("userId", String(params.userId));
  }

  const action = params.action?.trim() || "";
  if (action) {
    search.set("action", action);
  }

  const entityType = params.entityType?.trim() || "";
  if (entityType) {
    search.set("entityType", entityType);
  }

  const entityId = params.entityId?.trim() || "";
  if (entityId) {
    search.set("entityId", entityId);
  }

  const q = params.q?.trim() || "";
  if (q) {
    search.set("q", q);
  }

  const createdFrom = params.createdFrom?.trim() || "";
  if (createdFrom) {
    search.set("createdFrom", createdFrom);
  }

  const createdTo = params.createdTo?.trim() || "";
  if (createdTo) {
    search.set("createdTo", createdTo);
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

/** GET /activity-logs */
export async function listActivityLogs(
  params: ListActivityLogsParams = {},
): Promise<ListActivityLogsResult> {
  const data = await apiFetch<{
    activityLogs?: unknown;
    total?: unknown;
    limit?: unknown;
    offset?: unknown;
  }>("/activity-logs" + buildActivityLogsQuery(params), {
    method: "GET",
  });

  const raw = Array.isArray(data?.activityLogs) ? data.activityLogs : [];
  const activityLogs = raw
    .map(normalizeActivityLog)
    .filter((row): row is PublicActivityLog => row !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : activityLogs.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { activityLogs, total, limit, offset };
}

export function formatActivityActor(
  log: PublicActivityLog | null | undefined,
): string {
  if (!log) {
    return "System";
  }
  if (log.actorName) {
    return log.actorName;
  }
  if (typeof log.userId === "number") {
    return `User #${log.userId}`;
  }
  return "System";
}

export function formatActivityEntity(
  log: PublicActivityLog | null | undefined,
): string {
  if (!log) {
    return "—";
  }
  const type = log.entityType?.trim() || "—";
  const id = log.entityId?.trim();
  return id ? `${type} #${id}` : type;
}

export function formatActivityMetadata(
  metadata: ActivityMetadata | null | undefined,
): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "—";
  }
  try {
    return JSON.stringify(metadata);
  } catch {
    return "—";
  }
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

/** datetime-local input → ISO string for API query (or empty). */
export function datetimeLocalToIso(
  value: string | null | undefined,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

/** ISO / Date string → datetime-local value for controlled defaults. */
export function isoToDatetimeLocal(
  value: string | null | undefined,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
  ApiRequestError,
};
