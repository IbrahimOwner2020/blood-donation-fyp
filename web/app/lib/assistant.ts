import { apiFetch } from "~/lib/api";

export type AssistantActionProposal = {
  id: string;
  action: string;
  title: string;
  description: string;
  requiredPermission: string;
  payload: Record<string, unknown>;
  effect: string;
};

export type AssistantMessageResult =
  | {
      type: "answer";
      message: string;
    }
  | {
      type: "navigation";
      message: string;
      path: string;
      requiredPermission?: string;
    }
  | {
      type: "permission_denied";
      message: string;
      requiredPermission: string;
    }
  | {
      type: "action_proposal";
      message: string;
      proposal: AssistantActionProposal;
    };

export type AssistantActionResult = {
  type: "action_result";
  action: string;
  message: string;
  data?: unknown;
};

export async function sendAssistantMessage(input: {
  message: string;
  context?: Record<string, unknown>;
}): Promise<AssistantMessageResult> {
  return apiFetch<AssistantMessageResult>("/assistant/message", {
    method: "POST",
    json: input,
  });
}

export async function confirmAssistantAction(
  actionId: string,
): Promise<AssistantActionResult> {
  return apiFetch<AssistantActionResult>(
    `/assistant/actions/${encodeURIComponent(actionId)}/confirm`,
    { method: "POST" },
  );
}
