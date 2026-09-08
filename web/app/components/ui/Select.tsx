import type { ReactNode, SelectHTMLAttributes } from "react";

const controlClass =
  "w-full rounded-md border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink outline-none transition-colors focus:border-nbts-teal focus:bg-white disabled:cursor-not-allowed disabled:opacity-60";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
  children?: ReactNode;
};

export function Select({
  label,
  hint,
  error,
  id,
  className = "",
  wrapperClassName = "",
  children,
  ...rest
}: SelectProps) {
  const selectId = id || rest.name || undefined;

  const field = (
    <select
      id={selectId}
      className={[controlClass, error ? "border-nbts-blood" : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={error ? true : undefined}
      {...rest}
    >
      {children}
    </select>
  );

  if (!label) {
    return field;
  }

  return (
    <label
      className={["flex flex-col gap-1 text-sm", wrapperClassName]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="font-medium text-nbts-ink">
        {label}
        {rest.required ? (
          <span className="text-nbts-blood" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </span>
      {field}
      {hint && !error ? (
        <span className="text-xs text-nbts-muted">{hint}</span>
      ) : null}
      {error ? (
        <span className="text-xs text-nbts-blood">{error}</span>
      ) : null}
    </label>
  );
}
