import type { ReactNode } from "react";

type ForbiddenStateProps = {
  title?: string;
  message?: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
};

/**
 * Presentation-only forbidden view when session lacks a UI gate permission.
 * Not a security boundary — the API still enforces access.
 */
export function ForbiddenState({
  title = "Forbidden",
  message = "You do not have permission to view this screen. Contact an administrator if you need access.",
  detail,
  action,
  className = "",
}: ForbiddenStateProps = {}) {
  return (
    <div
      className={`rounded-lg border border-nbts-amber/30 bg-nbts-amber-soft px-5 py-6 text-nbts-ink ${className}`}
      role="status"
    >
      <h2 className="text-base font-semibold text-nbts-amber">{title}</h2>
      <p className="mt-1 text-sm text-nbts-muted">{message}</p>
      {detail ? (
        <p className="mt-3 font-mono text-xs text-nbts-muted">{detail}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
