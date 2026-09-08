import { useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useRevalidator } from "react-router";

import {
  confirmAssistantAction,
  sendAssistantMessage,
  type AssistantActionProposal,
} from "~/lib/assistant";

type ChatItem = {
  id: string;
  role: "user" | "assistant";
  message: string;
  proposal?: AssistantActionProposal;
  denied?: boolean;
};

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatAssistantMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "I could not find a readable answer for that request.";
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return "I found NBTS data for that request, but it was not formatted for chat. Please ask for the specific summary or record fields you want.";
      }
    } catch {
      return message;
    }
  }

  return message;
}

export function DashboardAssistant() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([
    {
      id: "intro",
      role: "assistant",
      message:
        "Ask about anything in the NBTS app, open a permitted page, or request an action like running a forecast or updating an alert.",
    },
  ]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const context = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      pathname: location.pathname,
      search: location.search,
      filters: Object.fromEntries(params.entries()),
    };
  }, [location.pathname, location.search]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) {
      return;
    }

    setMessage("");
    setBusy(true);
    setItems((current) => [
      ...current,
      { id: nextId(), role: "user", message: text },
    ]);

    try {
      const result = await sendAssistantMessage({ message: text, context });
      if (result.type === "navigation") {
        setItems((current) => [
          ...current,
          { id: nextId(), role: "assistant", message: result.message },
        ]);
        navigate(result.path);
        return;
      }
      if (result.type === "action_proposal") {
        setItems((current) => [
          ...current,
          {
            id: nextId(),
            role: "assistant",
            message: result.message,
            proposal: result.proposal,
          },
        ]);
        return;
      }
      setItems((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          message: result.message,
          denied: result.type === "permission_denied",
        },
      ]);
    } catch (error) {
      const fallback =
        error instanceof Error
          ? error.message
          : "The assistant could not complete that request.";
      setItems((current) => [
        ...current,
        { id: nextId(), role: "assistant", message: fallback, denied: true },
      ]);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  async function confirm(proposal: AssistantActionProposal) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await confirmAssistantAction(proposal.id);
      setItems((current) =>
        current.map((item) =>
          item.proposal?.id === proposal.id
            ? { ...item, proposal: undefined }
            : item,
        ).concat({
          id: nextId(),
          role: "assistant",
          message: result.message,
        }),
      );
      revalidator.revalidate();
    } catch (error) {
      const fallback =
        error instanceof Error
          ? error.message
          : "The confirmed action failed.";
      setItems((current) => [
        ...current,
        { id: nextId(), role: "assistant", message: fallback, denied: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function cancel(proposal: AssistantActionProposal) {
    setItems((current) =>
      current.map((item) =>
        item.proposal?.id === proposal.id
          ? {
              ...item,
              proposal: undefined,
              message: `${item.message} Cancelled.`,
            }
          : item,
      ),
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 sm:bottom-5 sm:right-5">
      {open ? (
        <section className="mb-3 flex h-[min(34rem,calc(100dvh-6rem))] w-[calc(100vw-2rem)] max-w-md flex-col overflow-hidden rounded-lg border border-nbts-border bg-nbts-panel shadow-xl">
          <header className="flex items-center justify-between border-b border-nbts-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-nbts-ink">
                NBTS assistant
              </h2>
              <p className="text-xs text-nbts-muted">
                API permissions apply to every action.
              </p>
            </div>
            <button
              type="button"
              className="rounded border border-nbts-border px-2 py-1 text-sm text-nbts-ink hover:border-nbts-muted"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              ×
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-nbts-surface/60 p-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={[
                  "rounded-lg border px-3 py-2 text-sm",
                  item.role === "user"
                    ? "ml-8 border-nbts-teal bg-nbts-teal-soft text-nbts-ink"
                    : item.denied
                      ? "mr-8 border-nbts-blood bg-nbts-blood-soft text-nbts-ink"
                      : "mr-8 border-nbts-border bg-white text-nbts-ink",
                ].join(" ")}
              >
                <p className="whitespace-pre-line">{formatAssistantMessage(item.message)}</p>
                {item.proposal ? (
                  <div className="mt-3 rounded border border-nbts-border bg-nbts-panel p-3">
                    <p className="font-medium">{item.proposal.title}</p>
                    <p className="mt-1 text-xs text-nbts-muted">
                      {item.proposal.description}
                    </p>
                    <p className="mt-2 text-xs text-nbts-muted">
                      Requires {item.proposal.requiredPermission}.{" "}
                      {item.proposal.effect}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded bg-nbts-blood px-3 py-1.5 text-xs font-medium text-white hover:bg-nbts-blood-dark disabled:opacity-60"
                        onClick={() => confirm(item.proposal as AssistantActionProposal)}
                        disabled={busy}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="rounded border border-nbts-border bg-white px-3 py-1.5 text-xs font-medium text-nbts-ink hover:border-nbts-muted disabled:opacity-60"
                        onClick={() => cancel(item.proposal as AssistantActionProposal)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? (
              <p className="px-1 text-xs text-nbts-muted">Working…</p>
            ) : null}
          </div>

          <form className="border-t border-nbts-border p-3" onSubmit={submit}>
            <textarea
              ref={inputRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-20 w-full resize-none rounded border border-nbts-border bg-white px-3 py-2 text-sm text-nbts-ink outline-none focus:border-nbts-teal"
              placeholder="Ask or request an action..."
              disabled={busy}
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                className="rounded bg-nbts-teal px-4 py-2 text-sm font-medium text-white hover:bg-nbts-slate disabled:opacity-60"
                disabled={busy || !message.trim()}
              >
                Send
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        className="rounded-full bg-nbts-blood px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-nbts-blood-dark"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Assistant
      </button>
    </div>
  );
}
