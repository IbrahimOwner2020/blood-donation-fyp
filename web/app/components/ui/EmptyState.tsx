import type { ReactNode } from "react";

type EmptyStateProps = {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  title = "Nothing here yet",
  description = "Data from the server will appear in this view when available.",
  action,
  className = "",
}: EmptyStateProps = {}) {
  return (
    <div
      className={`flex flex-col items-start gap-2 rounded-lg border border-dashed border-nbts-border bg-nbts-panel/80 px-5 py-8 ${className}`}
    >
      <h2 className="text-base font-semibold text-nbts-ink">{title}</h2>
      <p className="max-w-prose text-sm leading-relaxed text-nbts-muted">
        {description}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
