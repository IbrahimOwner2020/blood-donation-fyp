import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

type TableProps = HTMLAttributes<HTMLTableElement> & {
  children?: ReactNode;
  /** Optional caption for screen readers / context */
  caption?: string;
  wrapperClassName?: string;
};

export function Table({
  children,
  caption,
  className = "",
  wrapperClassName = "",
  ...rest
}: TableProps) {
  return (
    <div
      className={["overflow-x-auto", wrapperClassName].filter(Boolean).join(" ")}
    >
      <table
        className={["min-w-full text-left text-sm", className]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function THead({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={[
        "border-b border-nbts-border text-xs uppercase tracking-wide text-nbts-muted",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </thead>
  );
}

export function TBody({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...rest}>
      {children}
    </tbody>
  );
}

export function Tr({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={["border-b border-nbts-border/60 text-nbts-ink", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Th({
  children,
  className = "",
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={["px-2 py-2 font-medium sm:px-3", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={["px-2 py-2 sm:px-3", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </td>
  );
}
