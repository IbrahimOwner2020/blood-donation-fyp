import { useState, type FormEvent } from "react";
import { Link, type MetaFunction } from "react-router";
import { ApiRequestError, apiFetch } from "~/lib/api";

export const meta: MetaFunction = () => [
  { title: "Blood Donation Management System" },
  { name: "description", content: "Learn about donating blood and ask questions in English or Swahili." },
];

type Turn = {
  role: "user" | "assistant";
  content: string;
  historyContent?: string;
};
type ChatLanguage = "auto" | "en" | "sw";

const UNAVAILABLE_MESSAGE =
  "The donation assistant is temporarily unavailable. Please try again shortly.";

export default function HomePage() {
  const [language, setLanguage] = useState<ChatLanguage>("auto");
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(event: FormEvent) {
    event.preventDefault();
    const question = message.trim().slice(0, 500);
    if (!question || busy) return;
    const nextTurns = [...turns, { role: "user" as const, content: question }];
    setTurns(nextTurns);
    setMessage("");
    setBusy(true);
    setError("");
    try {
      const payload: {
        message: string;
        language?: "en" | "sw";
        turns: Turn[];
      } = {
        message: question,
        turns: turns.slice(-6).map((turn) => ({
          role: turn.role,
          content: turn.historyContent ?? turn.content,
        })),
      };
      if (language === "en" || language === "sw") {
        payload.language = language;
      }

      const response = await apiFetch<{ answer: string; disclaimer: string }>("/public/chat", {
        method: "POST",
        json: payload,
      });
      setTurns([
        ...nextTurns,
        {
          role: "assistant",
          content: `${response.answer}\n\n${response.disclaimer}`,
          historyContent: response.answer,
        },
      ]);
    } catch (cause) {
      if (
        cause instanceof ApiRequestError &&
        (cause.code === "PUBLIC_CHAT_UNAVAILABLE" || cause.status === 503)
      ) {
        setError(UNAVAILABLE_MESSAGE);
      } else {
        setError(cause instanceof Error ? cause.message : UNAVAILABLE_MESSAGE);
      }
    } finally {
      setBusy(false);
    }
  }

  const placeholder =
    language === "sw"
      ? "Uliza kuhusu uchangiaji damu…"
      : "Ask about donating blood…";

  return (
    <main className="min-h-screen bg-slate-50 text-nbts-ink">
      <header className="border-b border-nbts-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="font-bold text-nbts-blood">Blood Donation Management System</Link>
          <nav className="flex gap-2" aria-label="Account">
            <Link to="/login" className="rounded border border-nbts-border px-4 py-2 text-sm font-semibold">Sign in</Link>
            <Link to="/register-donor" className="rounded bg-nbts-blood px-4 py-2 text-sm font-semibold text-white">Register as donor</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-nbts-blood">Give blood. Help save lives.</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight">Clear guidance before you donate blood</h1>
          <p className="mt-4 max-w-xl text-lg text-nbts-muted">Donors are generally 18–65 years old and weigh at least 50 kg. Men wait three calendar months and women four calendar months between donations. Every donation still requires screening by qualified staff.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <article className="rounded-lg border border-nbts-border bg-white p-4"><h2 className="font-semibold">What this system does</h2><p className="mt-2 text-sm text-nbts-muted">Registers donors, records donations and blood units, tracks preliminary eligibility, manages requests and stock, sends consented reminders, and produces operational reports.</p></article>
            <article className="rounded-lg border border-nbts-border bg-white p-4"><h2 className="font-semibold">What it does not do</h2><p className="mt-2 text-sm text-nbts-muted">It does not diagnose illness, replace clinical screening, guarantee donor acceptance, or make medical decisions.</p></article>
          </div>
        </div>

        <section className="rounded-xl border border-nbts-border bg-white p-5 shadow-sm" aria-labelledby="chat-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="chat-heading" className="text-xl font-bold">Donation questions</h2>
              <p className="text-sm text-nbts-muted">Ask in English or Kiswahili. Language can be auto-detected.</p>
            </div>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as ChatLanguage)}
              className="rounded border border-nbts-border px-2 py-1 text-sm"
              aria-label="Language"
            >
              <option value="auto">Auto</option>
              <option value="en">English</option>
              <option value="sw">Kiswahili</option>
            </select>
          </div>
          <div className="mt-4 h-72 space-y-3 overflow-y-auto rounded bg-slate-50 p-3" aria-live="polite">
            {turns.length === 0 ? (
              <p className="text-sm text-nbts-muted">
                Try: “When can I donate again?” or “Ninaweza kuchangia baada ya muda gani?”
              </p>
            ) : (
              turns.map((turn, index) => (
                <div
                  key={index}
                  className={`max-w-[90%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
                    turn.role === "user"
                      ? "ml-auto bg-nbts-blood text-white"
                      : "bg-white text-nbts-ink shadow-sm"
                  }`}
                >
                  {turn.content}
                </div>
              ))
            )}
            {busy ? <p className="text-sm text-nbts-muted">Preparing an answer…</p> : null}
          </div>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
          <form onSubmit={ask} className="mt-4 flex gap-2">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              required
              className="min-w-0 flex-1 rounded border border-nbts-border px-3 py-2"
              placeholder={placeholder}
            />
            <button disabled={busy} className="rounded bg-nbts-teal px-4 py-2 font-semibold text-white disabled:opacity-60">
              Send
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
