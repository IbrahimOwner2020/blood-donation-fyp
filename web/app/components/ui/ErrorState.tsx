type ErrorStateProps = {
  title?: string;
  message?: string;
  detail?: string;
  className?: string;
};

export function ErrorState({
  title = "Something went wrong",
  message = "The page could not load. Try again, or return once the API is available.",
  detail,
  className = "",
}: ErrorStateProps = {}) {
  return (
    <div
      className={`rounded-lg border border-nbts-blood/25 bg-nbts-blood-soft px-5 py-6 text-nbts-ink ${className}`}
      role="alert"
    >
      <h2 className="text-base font-semibold text-nbts-blood-dark">{title}</h2>
      <p className="mt-1 text-sm text-nbts-muted">{message}</p>
      {detail ? (
        <p className="mt-3 font-mono text-xs text-nbts-muted">{detail}</p>
      ) : null}
    </div>
  );
}
