import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const controlClass =
  "w-full rounded-md border border-nbts-border bg-nbts-surface px-3 py-2 text-sm text-nbts-ink outline-none transition-colors placeholder:text-nbts-muted focus:border-nbts-teal focus:bg-white disabled:cursor-not-allowed disabled:opacity-60";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  labelClassName?: string;
  wrapperClassName?: string;
};

export function Input({
  label,
  hint,
  error,
  id,
  className = "",
  labelClassName = "",
  wrapperClassName = "",
  ...rest
}: InputProps) {
  const inputId = id || rest.name || undefined;

  const field = (
    <input
      id={inputId}
      className={[controlClass, error ? "border-nbts-blood" : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={error ? true : undefined}
      aria-describedby={
        error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
      }
      {...rest}
    />
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
      <span
        className={["font-medium text-nbts-ink", labelClassName]
          .filter(Boolean)
          .join(" ")}
      >
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
        <span id={`${inputId}-hint`} className="text-xs text-nbts-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${inputId}-error`} className="text-xs text-nbts-blood">
          {error}
        </span>
      ) : null}
    </label>
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  wrapperClassName?: string;
};

export function TextArea({
  label,
  hint,
  id,
  className = "",
  wrapperClassName = "",
  ...rest
}: TextAreaProps) {
  const inputId = id || rest.name || undefined;
  const field = (
    <textarea
      id={inputId}
      className={[controlClass, "min-h-[6rem]", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
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
      <span className="font-medium text-nbts-ink">{label}</span>
      {field}
      {hint ? <span className="text-xs text-nbts-muted">{hint}</span> : null}
    </label>
  );
}
