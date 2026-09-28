import { apiFetch } from "~/lib/api";
import { getApiBaseUrl } from "~/lib/env";

export type AssistantLanguage = "en" | "sw";
export type AssistantScalar = string | number | boolean | null;
export type AssistantWidth = "full" | "half" | "third" | "two-thirds";

export type AssistantResolvedLayoutBlock =
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "narrative"; content: string }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "metrics"; title?: string; items: Array<{ label: string; value: AssistantScalar; comparison?: string }> }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "comparison"; title: string; label: string; current: AssistantScalar; previous: AssistantScalar; change: AssistantScalar; mode: "difference" | "percent_change" }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "table"; title: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, AssistantScalar>>; total: number; truncated: boolean }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "chart"; title: string; chartType: "line" | "bar" | "stacked_bar" | "area" | "pie" | "donut"; xKey: string; series: Array<{ key: string; label: string }>; data: Array<Record<string, AssistantScalar>> }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "ranked_list"; title: string; items: Array<{ rank: number; label: string; value: AssistantScalar }> }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "status_summary"; title: string; items: Array<{ label: string; value: AssistantScalar }> }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "timeline"; title: string; items: Array<{ date: string; title: string; detail?: string }> }
  | { id: string; width: AssistantWidth; sourceIds: string[]; type: "notice" | "recommendation"; tone: "info" | "warning" | "error" | "success"; title?: string; message: string };

export type AssistantCompositionBlock = {
  type: "composition";
  title: string;
  summary: string;
  language: AssistantLanguage;
  sections: Array<{ id: string; title?: string; layout: "stack" | "grid" | "columns"; blocks: AssistantResolvedLayoutBlock[] }>;
  sources: Array<{ sourceId: string; tool: string; status: "ok" | "error" }>;
};

export type AssistantActionProposal = {
  id: string;
  action: string;
  title: string;
  description: string;
  requiredPermission: string;
  payload: Record<string, unknown>;
  effect: string;
};

export type AssistantBlock =
  | { type: "text"; content: string }
  | { type: "metrics"; title?: string; items: Array<{ label: string; value: string | number; comparison?: string }> }
  | { type: "table"; title: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string | number | boolean | null>>; total: number; truncated?: boolean; reportId?: string }
  | { type: "chart"; title: string; chartType: "line" | "bar" | "stacked_bar" | "area" | "pie" | "donut"; xKey: string; series: Array<{ key: string; label: string }>; data: Array<Record<string, string | number | boolean | null>> }
  | { type: "report"; reportId: string; reportType: string; title: string; generatedAt: string; summary: string; filters: Record<string, unknown>; formats: Array<"pdf" | "csv">; csvSections?: Array<{ id: string; label: string }> }
  | { type: "form"; draftId: string; workflow: string; title: string; fields: Array<{ name: string; label: string; inputType: "text" | "number" | "date" | "datetime-local" | "select" | "checkbox"; required: boolean; value?: unknown; options?: Array<{ value: string; label: string }>; error?: string }>; missingFields: string[] }
  | { type: "action_proposal"; proposal: AssistantActionProposal; expiresAt: string }
  | { type: "notice"; tone: "info" | "warning" | "error" | "success"; title?: string; message: string }
  | AssistantCompositionBlock;

export type AssistantConversation = {
  id: string;
  title: string;
  preferredLanguage: AssistantLanguage;
  lastMessageAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantStructuredMessage = {
  id: string;
  conversationId: string;
  role: "USER" | "ASSISTANT";
  language: AssistantLanguage;
  blocks: AssistantBlock[];
  suggestions: string[];
  createdAt: string;
};

export async function listAssistantConversations() {
  return apiFetch<{ conversations: AssistantConversation[] }>("/assistant/conversations");
}

export async function createAssistantConversation(input: { title?: string; preferredLanguage?: AssistantLanguage } = {}) {
  return apiFetch<{ conversation: AssistantConversation }>("/assistant/conversations", { method: "POST", json: input });
}

export async function getAssistantConversation(id: string) {
  return apiFetch<{ conversation: AssistantConversation; messages: AssistantStructuredMessage[] }>(`/assistant/conversations/${encodeURIComponent(id)}`);
}

export async function updateAssistantConversation(id: string, patch: { title?: string; preferredLanguage?: AssistantLanguage }) {
  return apiFetch<{ conversation: AssistantConversation }>(`/assistant/conversations/${encodeURIComponent(id)}`, { method: "PATCH", json: patch });
}

export async function deleteAssistantConversation(id: string) {
  return apiFetch<{ deleted: boolean }>(`/assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendConversationMessage(conversationId: string, input: { message: string; language?: AssistantLanguage; context?: Record<string, unknown> }) {
  return apiFetch<{ userMessage: AssistantStructuredMessage; message: AssistantStructuredMessage; artifactId?: string; navigation?: { path: string } }>(`/assistant/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", json: input });
}

export async function updateAssistantDraft(draftId: string, values: Record<string, unknown>) {
  return apiFetch<{ draft: { id: string; valid: boolean }; block: AssistantBlock }>(`/assistant/drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", json: { values } });
}

export async function prepareAssistantDraft(draftId: string) {
  return apiFetch<{ valid: boolean; block: AssistantBlock }>(`/assistant/drafts/${encodeURIComponent(draftId)}/prepare`, { method: "POST" });
}

export async function refreshAssistantReport(reportId: string) {
  return apiFetch<{ reportId: string; message: AssistantStructuredMessage }>(`/assistant/reports/${encodeURIComponent(reportId)}/refresh`, { method: "POST" });
}

export function assistantReportExportUrl(reportId: string, format: "pdf" | "csv", section?: string) {
  const query = new URLSearchParams({ format });
  if (section) query.set("section", section);
  return `${getApiBaseUrl()}/assistant/reports/${encodeURIComponent(reportId)}/export?${query.toString()}`;
}

export async function cancelAssistantAction(actionId: string) {
  return apiFetch<{ type: "action_cancelled"; actionId: string }>(`/assistant/actions/${encodeURIComponent(actionId)}/cancel`, { method: "POST" });
}

// Compatibility contract used by the old assistant endpoint during rollout.
export type AssistantMessageResult =
  | { type: "answer"; message: string }
  | { type: "navigation"; message: string; path: string; requiredPermission?: string }
  | { type: "permission_denied"; message: string; requiredPermission: string }
  | { type: "action_proposal"; message: string; proposal: AssistantActionProposal };

export type AssistantActionResult = { type: "action_result"; action: string; message: string; data?: unknown };

export async function sendAssistantMessage(input: { message: string; context?: Record<string, unknown>; history?: Array<{ role: "user" | "assistant"; content: string }> }): Promise<AssistantMessageResult> {
  return apiFetch<AssistantMessageResult>("/assistant/message", { method: "POST", json: input });
}

export async function confirmAssistantAction(actionId: string): Promise<AssistantActionResult> {
  return apiFetch<AssistantActionResult>(`/assistant/actions/${encodeURIComponent(actionId)}/confirm`, { method: "POST" });
}
