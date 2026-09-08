import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "teal";
export type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-nbts-blood text-white hover:bg-nbts-blood-dark",
  secondary:
    "border border-nbts-border bg-nbts-panel text-nbts-ink hover:border-nbts-muted",
  danger:
    "border border-nbts-blood bg-white text-nbts-blood-dark hover:bg-nbts-blood-soft",
  ghost:
    "border border-transparent bg-transparent text-nbts-ink hover:bg-nbts-surface",
  teal: "border border-nbts-teal bg-nbts-teal-soft text-nbts-teal hover:border-nbts-teal",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  disabled = false,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nbts-teal",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variantClass[variant],
        sizeClass[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
