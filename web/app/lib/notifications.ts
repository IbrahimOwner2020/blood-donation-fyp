/**
 * Notification API helpers for the web app
 * (docs/05 Notify screens, docs/09 workflow, docs/04 /notifications*).
 * Presentation-only — providers, RBAC, and send orchestration live in the API.
 *
 * Notifications routes may land in parallel with alerts/matches; callers should
 * treat missing routes as empty/unavailable, never crash or auto-send.
 */

import { ApiRequestError, apiFetch } from "~/lib/api";
import {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
} from "~/lib/donors";

export type NotificationChannel = "SMS" | "EMAIL";

export const NOTIFICATION_CHANNELS = [
  "SMS",
  "EMAIL",
] as const satisfies readonly NotificationChannel[];

export type NotificationStatus =
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "CANCELLED";

export const NOTIFICATION_STATUSES = [
  "PENDING",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const satisfies readonly NotificationStatus[];

export type PublicNotification = {
  id: number;
  donorId: number;
  alertId: number | null;
  channel: NotificationChannel;
  recipient: string;
  message: string;
  status: NotificationStatus;
  providerMessageId: string | null;
  sentAt: string | null;
  createdBy: number | null;
  createdAt: string;
  donorLabel?: string;
};

export type NotificationPreviewItem = {
  donorId: number;
  donorLabel: string;
  channel: NotificationChannel;
  recipient: string;
  message: string;
};

export type ListNotificationsParams = {
  alertId?: number;
  donorId?: number;
  channel?: NotificationChannel | "";
  status?: NotificationStatus | "";
  limit?: number;
  offset?: number;
};

export type ListNotificationsResult = {
  notifications: PublicNotification[];
  total: number;
  limit: number;
  offset: number;
};

export type PreviewNotificationsInput = {
  alertId?: number | null;
  donorIds: number[];
  channel: NotificationChannel;
  message?: string;
};

export type PreviewNotificationsResult = {
  previews: NotificationPreviewItem[];
  channel: NotificationChannel;
  alertId: number | null;
  message: string;
  /** True when built locally because preview API was unavailable. */
  localDraft: boolean;
};

export type SendNotificationsInput = {
  alertId?: number | null;
  donorIds: number[];
  channel: NotificationChannel;
  message: string;
};

export type SendNotificationsResult = {
  notifications: PublicNotification[];
  sentCount: number;
  failedCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDateOnlyOrIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return "";
}

function normalizeChannel(value: unknown): NotificationChannel {
  if (value === "SMS" || value === "EMAIL") {
    return value;
  }
  return "SMS";
}

function normalizeStatus(value: unknown): NotificationStatus {
  if (
    value === "PENDING" ||
    value === "SENT" ||
    value === "FAILED" ||
    value === "CANCELLED"
  ) {
    return value;
  }
  return "PENDING";
}

function donorLabelFromRecord(value: Record<string, unknown>): string {
  if (typeof value.donorLabel === "string" && value.donorLabel.trim()) {
    return value.donorLabel.trim();
  }
  const first =
    typeof value.firstName === "string" ? value.firstName.trim() : "";
  const last = typeof value.lastName === "string" ? value.lastName.trim() : "";
  const full = `${first} ${last}`.trim();
  if (full) {
    return full;
  }
  const number =
    typeof value.donorNumber === "string" ? value.donorNumber.trim() : "";
  if (number) {
    return number;
  }
  if (typeof value.donorId === "number" && Number.isFinite(value.donorId)) {
    return `Donor #${value.donorId}`;
  }
  return "Donor";
}

/** Normalize a notification DTO from the API (defensive). */
export function normalizeNotification(
  value: unknown,
): PublicNotification | null {
  if (!isRecord(value) || typeof value.id !== "number") {
    return null;
  }

  const donorId = typeof value.donorId === "number" ? value.donorId : 0;
  if (!donorId) {
    return null;
  }

  const alertId =
    typeof value.alertId === "number" && value.alertId > 0
      ? value.alertId
      : null;

  const sentRaw = value.sentAt;
  const sentAt =
    sentRaw === null || sentRaw === undefined
      ? null
      : toDateOnlyOrIso(sentRaw) || null;

  const createdBy =
    typeof value.createdBy === "number" && value.createdBy > 0
      ? value.createdBy
      : null;

  const providerRaw = value.providerMessageId;
  const providerMessageId =
    providerRaw === null || providerRaw === undefined
      ? null
      : typeof providerRaw === "string"
        ? providerRaw.trim() || null
        : null;

  return {
    id: value.id,
    donorId,
    alertId,
    channel: normalizeChannel(value.channel),
    recipient:
      typeof value.recipient === "string" ? value.recipient.trim() : "",
    message: typeof value.message === "string" ? value.message : "",
    status: normalizeStatus(value.status),
    providerMessageId,
    sentAt,
    createdBy,
    createdAt: toDateOnlyOrIso(value.createdAt),
    donorLabel: donorLabelFromRecord(value),
  };
}

function normalizePreviewItem(value: unknown): NotificationPreviewItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const donorId = typeof value.donorId === "number" ? value.donorId : 0;
  if (!donorId) {
    return null;
  }
  const recipient =
    typeof value.recipient === "string"
      ? value.recipient.trim()
      : typeof value.to === "string"
        ? value.to.trim()
        : "";
  const message =
    typeof value.message === "string"
      ? value.message
      : typeof value.body === "string"
        ? value.body
        : "";
  return {
    donorId,
    donorLabel: donorLabelFromRecord(value),
    channel: normalizeChannel(value.channel),
    recipient,
    message,
  };
}

function extractNotificationList(
  data: Record<string, unknown> | null | undefined,
): unknown[] {
  if (!data) {
    return [];
  }
  if (Array.isArray(data.notifications)) {
    return data.notifications;
  }
  if (Array.isArray(data.items)) {
    return data.items;
  }
  return [];
}

function buildListQuery(params: ListNotificationsParams = {}): string {
  const search = new URLSearchParams();
  if (
    typeof params.alertId === "number" &&
    Number.isFinite(params.alertId) &&
    params.alertId > 0
  ) {
    search.set("alertId", String(params.alertId));
  }
  if (
    typeof params.donorId === "number" &&
    Number.isFinite(params.donorId) &&
    params.donorId > 0
  ) {
    search.set("donorId", String(params.donorId));
  }
  const channel = params.channel?.trim() || "";
  if (channel === "SMS" || channel === "EMAIL") {
    search.set("channel", channel);
  }
  const status = params.status?.trim() || "";
  if (
    status === "PENDING" ||
    status === "SENT" ||
    status === "FAILED" ||
    status === "CANCELLED"
  ) {
    search.set("status", status);
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

/**
 * True when notifications routes are missing or unreachable (not yet mounted).
 * Forbidden/validation errors are NOT treated as unavailable.
 */
export function isNotificationsUnavailableError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (error.code === "NETWORK_ERROR" || error.status === 0) {
    return true;
  }
  if (error.status === 501 || error.status === 503) {
    return true;
  }
  return false;
}

/** List/detail: 404 usually means the notifications module is not mounted yet. */
export function isNotificationsRouteMissingError(error: unknown): boolean {
  return (
    isNotificationsUnavailableError(error) ||
    (error instanceof ApiRequestError &&
      (error.status === 404 || error.code === "NOT_FOUND"))
  );
}

/** GET /notifications */
export async function listNotifications(
  params: ListNotificationsParams = {},
): Promise<ListNotificationsResult> {
  const data = await apiFetch<Record<string, unknown>>(
    "/notifications" + buildListQuery(params),
    { method: "GET" },
  );

  const raw = extractNotificationList(data);
  const notifications = raw
    .map(normalizeNotification)
    .filter((row): row is PublicNotification => row !== null);

  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : notifications.length;
  const limit =
    typeof data?.limit === "number" && Number.isFinite(data.limit)
      ? data.limit
      : params.limit ?? 50;
  const offset =
    typeof data?.offset === "number" && Number.isFinite(data.offset)
      ? data.offset
      : params.offset ?? 0;

  return { notifications, total, limit, offset };
}

/** GET /notifications/:id */
export async function getNotification(
  notificationId: number,
): Promise<PublicNotification> {
  const data = await apiFetch<Record<string, unknown>>(
    `/notifications/${notificationId}`,
    { method: "GET" },
  );
  const candidate = data?.notification ?? data?.item ?? data;
  const notification = normalizeNotification(candidate);
  if (!notification) {
    throw new Error("Invalid notification payload from API");
  }
  return notification;
}

/**
 * Default outreach copy for review when the API does not return a template.
 * Send still requires an explicit user confirm + API call.
 */
export function buildDefaultNotificationMessage(
  channel: NotificationChannel = "SMS",
  bloodGroupCode: string = "",
): string {
  const group = bloodGroupCode.trim() || "your blood group";
  const base =
    `NBTS outreach: We have a shortage alert for ${group}. ` +
    "If you are able and willing to donate, please contact your nearest donation centre. " +
    "This message is informational only — not a medical assessment.";
  if (channel === "EMAIL") {
    return `${base}\n\nThank you for being a registered donor.`;
  }
  return base;
}

export type LocalPreviewDonor = {
  id: number;
  firstName?: string;
  lastName?: string;
  donorNumber?: string;
  phone?: string | null;
  email?: string | null;
};

/** Build local preview rows for user review when preview API is unavailable. */
export function buildLocalPreview(
  input: PreviewNotificationsInput,
  donors: LocalPreviewDonor[] = [],
  bloodGroupCode: string = "",
): PreviewNotificationsResult {
  const message =
    input.message?.trim() ||
    buildDefaultNotificationMessage(input.channel, bloodGroupCode);
  const byId = new Map(donors.map((donor) => [donor.id, donor]));

  const previews: NotificationPreviewItem[] = (input.donorIds ?? [])
    .filter((id) => typeof id === "number" && Number.isFinite(id) && id > 0)
    .map((donorId) => {
      const donor = byId.get(donorId);
      const first = donor?.firstName?.trim() || "";
      const last = donor?.lastName?.trim() || "";
      const full = `${first} ${last}`.trim();
      const donorLabel =
        full || donor?.donorNumber?.trim() || `Donor #${donorId}`;
      const recipient =
        input.channel === "EMAIL"
          ? donor?.email?.trim() || "(no email on file)"
          : donor?.phone?.trim() || "(no phone on file)";
      return {
        donorId,
        donorLabel,
        channel: input.channel,
        recipient,
        message,
      };
    });

  return {
    previews,
    channel: input.channel,
    alertId: input.alertId ?? null,
    message,
    localDraft: true,
  };
}

/** POST /notifications/preview */
export async function previewNotifications(
  input: PreviewNotificationsInput,
): Promise<PreviewNotificationsResult> {
  const data = await apiFetch<Record<string, unknown>>(
    "/notifications/preview",
    {
      method: "POST",
      json: {
        alertId: input.alertId,
        donorIds: input.donorIds,
        channel: input.channel,
        ...(input.message?.trim() ? { message: input.message.trim() } : {}),
      },
    },
  );

  const raw = Array.isArray(data?.previews)
    ? data.previews
    : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.notifications)
        ? data.notifications
        : [];
  const previews = raw
    .map(normalizePreviewItem)
    .filter((row): row is NotificationPreviewItem => row !== null);

  const message =
    typeof data?.message === "string" && data.message.trim()
      ? data.message.trim()
      : previews[0]?.message ||
        buildDefaultNotificationMessage(input.channel);

  return {
    previews,
    channel: normalizeChannel(data?.channel ?? input.channel),
    alertId:
      typeof data?.alertId === "number" && data.alertId > 0
        ? data.alertId
        : input.alertId ?? null,
    message,
    localDraft: false,
  };
}

/** POST /notifications/send — never call without explicit user confirmation. */
export async function sendNotifications(
  input: SendNotificationsInput,
): Promise<SendNotificationsResult> {
  const data = await apiFetch<Record<string, unknown>>("/notifications/send", {
    method: "POST",
    json: {
      alertId: input.alertId,
      donorIds: input.donorIds,
      channel: input.channel,
      message: input.message,
    },
  });

  const raw = extractNotificationList(data);
  const notifications = raw
    .map(normalizeNotification)
    .filter((row): row is PublicNotification => row !== null);

  const sentCount =
    typeof data?.sentCount === "number" && Number.isFinite(data.sentCount)
      ? data.sentCount
      : notifications.filter((n) => n.status === "SENT").length;
  const failedCount =
    typeof data?.failedCount === "number" && Number.isFinite(data.failedCount)
      ? data.failedCount
      : notifications.filter((n) => n.status === "FAILED").length;

  return { notifications, sentCount, failedCount };
}

export function parseNotificationChannel(
  value: string | null | undefined,
): NotificationChannel | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "SMS" || raw === "EMAIL") {
    return raw;
  }
  return "";
}

export function parseNotificationStatus(
  value: string | null | undefined,
): NotificationStatus | "" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (
    raw === "PENDING" ||
    raw === "SENT" ||
    raw === "FAILED" ||
    raw === "CANCELLED"
  ) {
    return raw;
  }
  return "";
}

export function parseDonorIdList(formData: FormData, key = "donorIds"): number[] {
  const values = formData.getAll(key);
  const ids = values
    .map((value) => parsePositiveInt(String(value || "")))
    .filter((id): id is number => Number.isFinite(id) && id > 0);
  return [...new Set(ids)];
}

export function formatNotificationChannel(
  channel: NotificationChannel | string = "",
): string {
  const value = String(channel || "").trim().toUpperCase();
  if (value === "SMS") return "SMS";
  if (value === "EMAIL") return "Email";
  return channel.trim() || "Unknown";
}

export function formatNotificationStatus(
  status: NotificationStatus | string = "",
): string {
  const value = String(status || "").trim().toUpperCase();
  if (value === "PENDING") return "Pending";
  if (value === "SENT") return "Sent";
  if (value === "FAILED") return "Failed";
  if (value === "CANCELLED") return "Cancelled";
  return status.trim() || "Unknown";
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

export {
  formatApiErrorMessage,
  isForbiddenApiError,
  parsePositiveInt,
};

export { ApiRequestError };
