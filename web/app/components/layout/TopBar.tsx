import { Form, Link } from "react-router";

import type { AuthSession } from "~/lib/auth";

type TopBarProps = {
  session: AuthSession;
  onMenuClick?: () => void;
};

export function TopBar({ session, onMenuClick }: TopBarProps) {
  const displayName = session?.displayName || "Signed in";
  const roleLabel = session?.roleLabels?.[0] || "Staff";

  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-nbts-border bg-nbts-panel px-3 py-2 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded border border-nbts-border text-lg leading-none text-nbts-ink hover:border-nbts-muted lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          ☰
        </button>
        <Link
          to="/dashboard"
          className="flex min-w-0 items-center gap-2 text-nbts-ink no-underline"
        >
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded bg-nbts-blood text-sm font-bold text-white"
            aria-hidden="true"
          >
            N
          </span>
          <span className="hidden truncate text-sm font-semibold tracking-wide sm:inline">
            NBTS Blood AI
          </span>
        </Link>
        <span className="hidden text-xs text-nbts-muted md:inline">
          Supply prediction &amp; donor notification
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="min-w-0 text-right">
          <p className="max-w-28 truncate text-sm font-medium text-nbts-ink sm:max-w-48">
            {displayName}
          </p>
          <p className="truncate text-xs text-nbts-muted">{roleLabel}</p>
        </div>
        <Form method="post" action="/logout">
          <button
            type="submit"
            className="rounded border border-nbts-border bg-nbts-surface px-2 py-1.5 text-xs font-medium text-nbts-ink hover:border-nbts-muted sm:px-3"
          >
            Sign out
          </button>
        </Form>
      </div>
    </header>
  );
}
