type LoadingStateProps = {
  label?: string;
  className?: string;
};

export function LoadingState({
  label = "Loading…",
  className = "",
}: LoadingStateProps = {}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-16 text-nbts-muted ${className}`}
      role="status"
      aria-live="polite"
    >
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-nbts-border border-t-nbts-blood"
        aria-hidden="true"
      />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}
