import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  redirect,
  useLoaderData,
  useLocation,
  useNavigate,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { EmptyState } from "~/components/ui/EmptyState";
import { ErrorState } from "~/components/ui/ErrorState";
import { ForbiddenState } from "~/components/ui/ForbiddenState";
import { CompositionRenderer } from "~/components/assistant/CompositionRenderer";
import {
  assistantReportExportUrl,
  cancelAssistantAction,
  confirmAssistantAction,
  createAssistantConversation,
  deleteAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
  prepareAssistantDraft,
  refreshAssistantReport,
  sendConversationMessage,
  updateAssistantConversation,
  updateAssistantDraft,
  type AssistantBlock,
  type AssistantConversation,
  type AssistantLanguage,
  type AssistantStructuredMessage,
} from "~/lib/assistant";
import { fetchAuthSession, hasAnyUiPermission, type AuthSession } from "~/lib/auth";

export const meta: MetaFunction = () => [{ title: "AI Operations Assistant · NBTS" }];

const ASSISTANT_PERMISSIONS = [
  "reports:read",
  "donors:read",
  "donors:create",
  "donations:read",
  "donations:create",
  "inventory:read",
  "inventory:update",
  "requests:read",
  "requests:create",
  "alerts:read",
  "notifications:read",
  "notifications:send",
];

type LoaderData =
  | { status: "ok"; session: AuthSession; conversations: AssistantConversation[] }
  | { status: "forbidden"; session: AuthSession }
  | { status: "error"; session: AuthSession; message: string };

export async function clientLoader({ request }: ClientLoaderFunctionArgs): Promise<LoaderData> {
  const session = await fetchAuthSession();
  if (!session) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }
  if (!hasAnyUiPermission(session, ASSISTANT_PERMISSIONS)) return { status: "forbidden", session };
  try {
    const result = await listAssistantConversations();
    return { status: "ok", session, conversations: result.conversations };
  } catch (error) {
    return { status: "error", session, message: error instanceof Error ? error.message : "Unable to load assistant conversations." };
  }
}

clientLoader.hydrate = true as const;

export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  const currentConversation = currentUrl.searchParams.get("conversation");
  const nextConversation = nextUrl.searchParams.get("conversation");
  if (
    currentUrl.pathname === nextUrl.pathname
    && currentConversation !== nextConversation
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

const PROMPTS = {
  en: ["Generate the current blood supply report", "Show predicted shortages", "Register a donor", "Prepare donor notifications"],
  sw: ["Tengeneza ripoti ya hali ya damu", "Onyesha upungufu wa damu", "Sajili mfadhili", "Andaa taarifa kwa wafadhili"],
};

function localMessage(conversationId: string, content: string, tone: "success" | "error" = "success"): AssistantStructuredMessage {
  return {
    id: `local-${Date.now()}-${Math.random()}`,
    conversationId,
    role: "ASSISTANT",
    language: "en",
    blocks: [{ type: "notice", tone, message: content }],
    suggestions: [],
    createdAt: new Date().toISOString(),
  };
}

function MessageShell({ message, children }: { message: AssistantStructuredMessage; children: React.ReactNode }) {
  const isUser = message.role === "USER";
  return (
    <article className={isUser ? "ml-auto max-w-2xl" : "mr-auto w-full max-w-4xl"}>
      <div className={[
        "space-y-3 rounded-xl border p-3 sm:p-4",
        isUser ? "border-nbts-teal/40 bg-nbts-teal-soft" : "border-nbts-border bg-white",
      ].join(" ")}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-nbts-muted">{isUser ? "You" : "NBTS Assistant"}</p>
        {children}
      </div>
    </article>
  );
}

function DraftForm({ block, busy, onReplace, onAppend }: {
  block: Extract<AssistantBlock, { type: "form" }>;
  busy: boolean;
  onReplace: (block: AssistantBlock) => void;
  onAppend: (message: string, tone?: "success" | "error") => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(block.fields.map((field) => [field.name, field.value ?? (field.inputType === "checkbox" ? false : "")])));
  const [saving, setSaving] = useState(false);

  async function review() {
    setSaving(true);
    try {
      // Omit untouched blanks so redacted phone/email fields do not overwrite
      // the authoritative short-lived draft values kept by the API.
      const submittedValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
      const updated = await updateAssistantDraft(block.draftId, submittedValues);
      onReplace(updated.block);
      if (!updated.draft.valid) return;
      const prepared = await prepareAssistantDraft(block.draftId);
      onReplace(prepared.block);
    } catch (error) {
      onAppend(error instanceof Error ? error.message : "Unable to prepare this record.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-nbts-border bg-nbts-surface p-3">
      <h3 className="font-semibold text-nbts-ink">{block.title}</h3>
      {block.missingFields.length ? <p className="mt-1 text-xs text-amber-700">Complete {block.missingFields.length} required field{block.missingFields.length === 1 ? "" : "s"}.</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {block.fields.map((field) => (
          <label key={field.name} className="text-xs font-medium text-nbts-ink">
            {field.label}{field.required ? " *" : ""}
            {field.inputType === "select" ? (
              <select className="mt-1 w-full rounded border border-nbts-border bg-white px-2 py-2 text-sm" value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}>
                <option value="">Select…</option>
                {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : field.inputType === "checkbox" ? (
              <input className="ml-2 mt-2" type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))} />
            ) : (
              <input className="mt-1 w-full rounded border border-nbts-border bg-white px-2 py-2 text-sm" type={field.inputType} value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />
            )}
            {field.error ? <span className="mt-1 block text-xs text-nbts-blood">{field.error}</span> : null}
          </label>
        ))}
      </div>
      <button type="button" disabled={busy || saving} onClick={review} className="mt-4 rounded bg-nbts-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? "Validating…" : "Review action"}
      </button>
    </section>
  );
}

const CHART_COLORS = ["#0f766e", "#b91c1c", "#1d4ed8", "#ca8a04", "#7e22ce"];

function ArtifactView({ block }: { block: AssistantBlock | null }) {
  if (!block) return <EmptyState title="No artifact selected" description="Select a table, chart, form, or report from the conversation." />;
  if (block.type === "composition") return <CompositionRenderer composition={block} />;
  if (block.type === "table") {
    return <div><h2 className="text-lg font-semibold">{block.title}</h2><div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-nbts-muted">{block.columns.map((column) => <th className="px-2 py-2" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index} className="border-b border-nbts-border/60">{block.columns.map((column) => <td className="px-2 py-2" key={column.key}>{String(row[column.key] ?? "—")}</td>)}</tr>)}</tbody></table></div>{block.truncated ? <p className="mt-3 text-xs text-nbts-muted">Showing {block.rows.length} of {block.total} rows.</p> : null}</div>;
  }
  if (block.type === "chart") {
    const data = block.data as Array<Record<string, unknown>>;
    return <div><h2 className="text-lg font-semibold">{block.title}</h2><div className="mt-4 h-80 w-full"><ResponsiveContainer>{block.chartType === "pie" ? <PieChart><Pie data={data} dataKey={block.series[0]?.key} nameKey={block.xKey} outerRadius={110} label>{data.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart> : block.chartType === "bar" ? <BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={block.xKey} /><YAxis /><Tooltip /><Legend />{block.series.map((series, index) => <Bar key={series.key} dataKey={series.key} name={series.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</BarChart> : <LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={block.xKey} /><YAxis /><Tooltip /><Legend />{block.series.map((series, index) => <Line key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={CHART_COLORS[index % CHART_COLORS.length]} />)}</LineChart>}</ResponsiveContainer></div></div>;
  }
  if (block.type === "report") {
    return <div><h2 className="text-lg font-semibold">{block.title}</h2><p className="mt-2 text-sm text-nbts-muted">{block.summary}</p><dl className="mt-4 grid gap-2 text-sm"><div><dt className="font-medium">Generated</dt><dd>{new Date(block.generatedAt).toLocaleString()}</dd></div><div><dt className="font-medium">Filters</dt><dd>{JSON.stringify(block.filters)}</dd></div></dl><div className="mt-5 flex flex-wrap gap-2"><a href={assistantReportExportUrl(block.reportId, "pdf")} className="rounded bg-nbts-blood px-4 py-2 text-sm font-semibold text-white">Download PDF</a>{block.csvSections?.length ? block.csvSections.map((section) => <a key={section.id} href={assistantReportExportUrl(block.reportId, "csv", section.id)} className="rounded border border-nbts-border px-4 py-2 text-sm font-semibold">CSV · {section.label}</a>) : <a href={assistantReportExportUrl(block.reportId, "csv")} className="rounded border border-nbts-border px-4 py-2 text-sm font-semibold">Download CSV</a>}</div></div>;
  }
  return <div><h2 className="text-lg font-semibold">Assistant artifact</h2><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(block, null, 2)}</pre></div>;
}

export default function AssistantPage() {
  const data = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState(data.status === "ok" ? data.conversations : []);
  const [activeId, setActiveId] = useState<string | null>(() => new URLSearchParams(location.search).get("conversation") || conversations[0]?.id || null);
  const [messages, setMessages] = useState<AssistantStructuredMessage[]>([]);
  const [language, setLanguage] = useState<AssistantLanguage>("en");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<AssistantBlock | null>(null);
  const [showArtifact, setShowArtifact] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const creatingConversationRef = useRef(false);

  useEffect(() => {
    if (data.status !== "ok") return;
    if (!activeId && !conversations.length && !creatingConversationRef.current) {
      creatingConversationRef.current = true;
      createAssistantConversation().then(({ conversation }) => {
        setConversations([conversation]);
        setActiveId(conversation.id);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to create conversation."))
        .finally(() => {
          creatingConversationRef.current = false;
        });
    }
  }, [activeId, conversations.length, data.status]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setBusy(true);
    getAssistantConversation(activeId).then((result) => {
      if (cancelled) return;
      setMessages(result.messages);
      setLanguage(result.conversation.preferredLanguage);
      setError(null);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load conversation.");
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const currentConversation = new URLSearchParams(location.search).get("conversation");
    if (currentConversation !== activeId) {
      navigate(`/assistant?conversation=${encodeURIComponent(activeId)}`, { replace: true });
    }
  }, [activeId, location.search, navigate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const prompts = useMemo(() => PROMPTS[language], [language]);

  if (data.status === "forbidden") return <ForbiddenState title="Assistant access denied" message="The AI Operations Assistant is available to authorized operational staff only." />;
  if (data.status === "error") return <ErrorState title="Assistant unavailable" message={data.message} />;

  async function newConversation() {
    const result = await createAssistantConversation({ preferredLanguage: language });
    setConversations((current) => [result.conversation, ...current]);
    setActiveId(result.conversation.id);
    setMessages([]);
    setArtifact(null);
  }

  async function renameConversation(item: AssistantConversation) {
    const title = window.prompt("Conversation title", item.title)?.trim();
    if (!title) return;
    const result = await updateAssistantConversation(item.id, { title });
    setConversations((current) => current.map((conversation) => conversation.id === item.id ? result.conversation : conversation));
  }

  async function removeConversation(item: AssistantConversation) {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    await deleteAssistantConversation(item.id);
    const next = conversations.filter((conversation) => conversation.id !== item.id);
    setConversations(next);
    setActiveId(next[0]?.id ?? null);
    setMessages([]);
  }

  async function changeLanguage(next: AssistantLanguage) {
    setLanguage(next);
    if (!activeId) return;
    const result = await updateAssistantConversation(activeId, { preferredLanguage: next });
    setConversations((current) => current.map((conversation) => conversation.id === activeId ? result.conversation : conversation));
  }

  async function submitMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !activeId || busy) return;
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const result = await sendConversationMessage(activeId, { message: trimmed, language, context: { pathname: "/assistant" } });
      setMessages((current) => [...current, result.userMessage, result.message]);
      if (result.navigation) navigate(result.navigation.path);
      const report = result.message.blocks.find((block) => block.type === "report");
      const composition = result.message.blocks.find((block) => block.type === "composition");
      if (composition) setArtifact(composition);
      else if (report) setArtifact(report);
      const refreshed = await listAssistantConversations();
      setConversations(refreshed.conversations);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant could not complete that request.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submitMessage(input);
  }

  function replaceBlock(messageId: string, oldBlock: AssistantBlock, nextBlock: AssistantBlock) {
    setMessages((current) => current.map((message) => message.id === messageId ? { ...message, blocks: message.blocks.map((block) => block === oldBlock ? nextBlock : block) } : message));
  }

  async function confirmAction(messageId: string, block: Extract<AssistantBlock, { type: "action_proposal" }>) {
    setBusy(true);
    try {
      const result = await confirmAssistantAction(block.proposal.id);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, blocks: message.blocks.filter((item) => item !== block) } : message).concat(localMessage(activeId ?? "", result.message)));
    } catch (cause) {
      setMessages((current) => current.concat(localMessage(activeId ?? "", cause instanceof Error ? cause.message : "The action failed.", "error")));
    } finally {
      setBusy(false);
    }
  }

  async function cancelAction(messageId: string, block: Extract<AssistantBlock, { type: "action_proposal" }>) {
    try {
      await cancelAssistantAction(block.proposal.id);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, blocks: message.blocks.filter((item) => item !== block) } : message).concat(localMessage(activeId ?? "", "Action cancelled.")));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to cancel the action.");
    }
  }

  async function refreshReport(block: Extract<AssistantBlock, { type: "report" }>) {
    setBusy(true);
    try {
      const result = await refreshAssistantReport(block.reportId);
      setMessages((current) => [...current, result.message]);
      const composition = result.message.blocks.find((item) => item.type === "composition");
      const next = result.message.blocks.find((item) => item.type === "report");
      if (composition) setArtifact(composition);
      else if (next) setArtifact(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="-mx-3 -my-4 flex h-[calc(100dvh-3.5rem)] min-h-0 bg-nbts-surface sm:-mx-5 sm:-my-5 lg:-mx-6">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-nbts-border bg-white lg:flex">
        <div className="border-b border-nbts-border p-3"><button type="button" onClick={newConversation} className="w-full rounded bg-nbts-blood px-3 py-2 text-sm font-semibold text-white">+ New conversation</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{conversations.map((conversation) => <div key={conversation.id} className={activeId === conversation.id ? "mb-1 rounded bg-nbts-blood-soft p-2" : "mb-1 rounded p-2 hover:bg-nbts-surface"}><button type="button" onClick={() => setActiveId(conversation.id)} className="w-full truncate text-left text-sm font-medium">{conversation.title}</button><div className="mt-1 flex gap-2 text-[11px]"><button type="button" onClick={() => renameConversation(conversation)} className="text-nbts-teal">Rename</button><button type="button" onClick={() => removeConversation(conversation)} className="text-nbts-blood">Delete</button></div></div>)}</div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-nbts-border bg-white px-3 py-3 sm:px-5">
          <div><h1 className="text-lg font-semibold text-nbts-ink">AI Operations Assistant</h1><p className="text-xs text-nbts-muted">Authorized NBTS data, reports, and confirmed actions</p></div>
          <div className="flex items-center gap-2"><select aria-label="Assistant language" value={language} onChange={(event) => changeLanguage(event.target.value as AssistantLanguage)} className="rounded border border-nbts-border bg-white px-2 py-1.5 text-sm"><option value="en">English</option><option value="sw">Kiswahili</option></select><button type="button" onClick={newConversation} className="rounded border border-nbts-border px-3 py-1.5 text-sm lg:hidden">New</button><button type="button" onClick={() => setShowArtifact(true)} className="rounded border border-nbts-border px-3 py-1.5 text-sm xl:hidden">Artifact</button></div>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
          {!messages.length && !busy ? <div className="mx-auto max-w-3xl py-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-nbts-blood text-xl font-bold text-white">AI</div><h2 className="mt-4 text-xl font-semibold">How can I help with today’s blood operations?</h2><p className="mt-2 text-sm text-nbts-muted">Generate reports, inspect shortages, or prepare a controlled operational record.</p><div className="mt-6 grid gap-2 sm:grid-cols-2">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => submitMessage(prompt)} className="rounded-lg border border-nbts-border bg-white p-3 text-left text-sm hover:border-nbts-teal">{prompt}</button>)}</div></div> : null}
          {messages.map((message) => <MessageShell key={message.id} message={message}>{message.blocks.map((block, index) => {
            if (block.type === "text") return <p key={index} className="whitespace-pre-wrap text-sm leading-6 text-nbts-ink">{block.content}</p>;
            if (block.type === "composition") return <div key={index}><CompositionRenderer composition={block} /><button type="button" onClick={() => { setArtifact(block); setShowArtifact(true); }} className="mt-3 rounded border border-nbts-border px-3 py-1.5 text-xs font-semibold text-nbts-teal xl:hidden">Open in artifact view</button></div>;
            if (block.type === "metrics") return <div key={index} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{block.items.map((item) => <div key={item.label} className="rounded border border-nbts-border bg-nbts-surface p-3"><p className="text-xs text-nbts-muted">{item.label}</p><p className="mt-1 text-xl font-semibold">{item.value}</p>{item.comparison ? <p className="text-xs text-nbts-muted">{item.comparison}</p> : null}</div>)}</div>;
            if (block.type === "table" || block.type === "chart") return <button key={index} type="button" onClick={() => { setArtifact(block); setShowArtifact(true); }} className="flex w-full items-center justify-between rounded border border-nbts-border bg-nbts-surface p-3 text-left text-sm"><span><strong>{block.title}</strong><span className="mt-1 block text-xs text-nbts-muted">{block.type === "table" ? `${block.total} rows` : `${block.data.length} data points`}</span></span><span className="text-nbts-teal">View →</span></button>;
            if (block.type === "report") return <div key={index} className="rounded-lg border border-nbts-teal/40 bg-nbts-teal-soft p-3"><p className="font-semibold">{block.title}</p><p className="mt-1 text-xs text-nbts-muted">Generated {new Date(block.generatedAt).toLocaleString()}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setArtifact(block); setShowArtifact(true); }} className="rounded bg-nbts-teal px-3 py-1.5 text-xs font-semibold text-white">Open exports</button><button type="button" onClick={() => refreshReport(block)} className="rounded border border-nbts-border bg-white px-3 py-1.5 text-xs font-semibold">Refresh data</button><a href={assistantReportExportUrl(block.reportId, "pdf")} className="rounded border border-nbts-border bg-white px-3 py-1.5 text-xs font-semibold">PDF</a>{block.csvSections?.map((section) => <a key={section.id} href={assistantReportExportUrl(block.reportId, "csv", section.id)} className="rounded border border-nbts-border bg-white px-3 py-1.5 text-xs font-semibold">CSV · {section.label}</a>)}</div></div>;
            if (block.type === "form") return <DraftForm key={index} block={block} busy={busy} onReplace={(next) => replaceBlock(message.id, block, next)} onAppend={(text, tone) => setMessages((current) => [...current, localMessage(activeId ?? "", text, tone)])} />;
            if (block.type === "action_proposal") return <div key={index} className="rounded-lg border border-amber-300 bg-amber-50 p-3"><p className="font-semibold">{block.proposal.title}</p><p className="mt-1 text-sm">{block.proposal.description}</p><p className="mt-2 text-xs text-nbts-muted">{block.proposal.effect}</p><p className="mt-1 text-xs text-nbts-muted">Expires {new Date(block.expiresAt).toLocaleTimeString()}</p><div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => confirmAction(message.id, block)} className="rounded bg-nbts-blood px-3 py-1.5 text-xs font-semibold text-white">Confirm</button><button type="button" disabled={busy} onClick={() => cancelAction(message.id, block)} className="rounded border border-nbts-border bg-white px-3 py-1.5 text-xs font-semibold">Cancel</button></div></div>;
            return <div key={index} className={block.tone === "error" ? "rounded border border-red-300 bg-red-50 p-3 text-sm" : block.tone === "warning" ? "rounded border border-amber-300 bg-amber-50 p-3 text-sm" : "rounded border border-nbts-border bg-nbts-surface p-3 text-sm"}>{block.title ? <p className="font-semibold">{block.title}</p> : null}<p>{block.message}</p></div>;
          })}{message.suggestions.length ? <div className="flex flex-wrap gap-2">{message.suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => submitMessage(suggestion)} className="rounded-full border border-nbts-border px-3 py-1 text-xs text-nbts-teal">{suggestion}</button>)}</div> : null}</MessageShell>)}
          {busy ? <p className="text-sm text-nbts-muted">Assistant is working…</p> : null}
          {error ? <ErrorState title="Assistant request failed" message={error} /> : null}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={onSubmit} className="border-t border-nbts-border bg-white p-3 sm:p-4"><div className="mx-auto flex max-w-4xl gap-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(input); } }} placeholder={language === "sw" ? "Uliza, tengeneza ripoti, au omba kitendo…" : "Ask, generate a report, or request an action…"} className="min-h-16 flex-1 resize-none rounded-lg border border-nbts-border px-3 py-2 text-sm outline-none focus:border-nbts-teal" disabled={busy} /><button type="submit" disabled={busy || !input.trim()} className="self-end rounded-lg bg-nbts-blood px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Send</button></div><p className="mx-auto mt-2 max-w-4xl text-xs text-nbts-muted">The API checks your role and facility before every result or action.</p></form>
      </section>

      <aside className="hidden w-[min(40vw,34rem)] shrink-0 overflow-y-auto border-l border-nbts-border bg-white p-5 xl:block"><ArtifactView block={artifact} /></aside>
      {showArtifact ? <div className="fixed inset-0 z-50 bg-nbts-slate/50 p-3 xl:hidden"><section className="ml-auto flex h-full w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl"><header className="flex items-center justify-between border-b border-nbts-border p-3"><h2 className="font-semibold">Artifact</h2><button type="button" onClick={() => setShowArtifact(false)} className="rounded border border-nbts-border px-2 py-1">Close</button></header><div className="min-h-0 flex-1 overflow-y-auto p-4"><ArtifactView block={artifact} /></div></section></div> : null}
    </div>
  );
}
