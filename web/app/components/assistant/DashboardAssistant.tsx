import { Link, useLocation } from "react-router";

/** Compact global entry point; the operational assistant itself lives at /assistant. */
export function DashboardAssistant() {
  const location = useLocation();
  if (location.pathname === "/assistant") return null;
  return (
    <Link
      to="/assistant"
      className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-nbts-blood px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-nbts-blood-dark focus:outline-none focus:ring-2 focus:ring-nbts-teal focus:ring-offset-2 sm:bottom-5 sm:right-5"
      aria-label="Open AI Operations Assistant"
    >
      <span aria-hidden="true">AI</span>
      <span className="hidden sm:inline">Assistant</span>
    </Link>
  );
}
