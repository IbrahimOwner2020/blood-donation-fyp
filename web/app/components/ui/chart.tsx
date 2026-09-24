/**
 * Shared Recharts helpers — NBTS palette, date ticks, tooltip chrome.
 * Values remain server-owned; this only formats presentation.
 */

import type { ReactNode } from "react";
import { BLOOD_GROUP_OPTIONS } from "~/lib/donors";

/** NBTS token hex values (match app.css @theme). */
export const CHART_COLORS = {
  blood: "#a11c2b",
  bloodDark: "#7f1521",
  teal: "#0f766e",
  amber: "#b45309",
  ink: "#0f1c2e",
  muted: "#5b6b7c",
  border: "#d7dee7",
  slate: "#1a2b3f",
  available: "#a11c2b",
  reserved: "#0f766e",
  predicted: "#b45309",
  donations: "#a11c2b",
  demand: "#1a2b3f",
  collected: "#0f766e",
  grid: "#d7dee7",
} as const;

export const CHART_MARGIN = {
  top: 12,
  right: 16,
  left: 4,
  bottom: 8,
} as const;

export function formatChartDateTick(value: string | number = ""): string {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw || "—";
  }
  const [y, m, d] = raw.slice(0, 10).split("-").map(Number);
  if (
    typeof y !== "number" ||
    typeof m !== "number" ||
    typeof d !== "number" ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return raw.slice(0, 10);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatChartNumber(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return String(Math.round(n));
    }
  }
  return "0";
}

/** Canonical A+…O- order for supply vs predicted alignment. */
export function sortBloodGroupCodes(codes: string[]): string[] {
  const order = new Map(
    BLOOD_GROUP_OPTIONS.map((group, index) => [group.code, index]),
  );
  return [...codes].sort((a, b) => {
    const ai = order.get(a) ?? 999;
    const bi = order.get(b) ?? 999;
    if (ai !== bi) {
      return ai - bi;
    }
    return a.localeCompare(b);
  });
}

type TooltipEntry = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

type ChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  labelFormatter?: (label: string) => string;
};

export function ChartTooltipContent({
  active = false,
  label = "",
  payload = [],
  labelFormatter,
}: ChartTooltipProps): ReactNode {
  if (!active || !payload?.length) {
    return null;
  }

  const labelText =
    typeof labelFormatter === "function"
      ? labelFormatter(String(label ?? ""))
      : String(label ?? "");

  return (
    <div className="rounded-md border border-nbts-border bg-nbts-panel px-3 py-2 text-sm shadow-sm">
      {labelText ? (
        <p className="mb-1.5 font-medium text-nbts-ink">{labelText}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li
            key={`${entry.dataKey ?? entry.name ?? index}`}
            className="flex items-center gap-2 text-nbts-muted"
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: entry.color || CHART_COLORS.muted }}
              aria-hidden="true"
            />
            <span>
              {entry.name || "Value"}:{" "}
              <span className="font-medium text-nbts-ink">
                {formatChartNumber(entry.value)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const chartAxisTick = {
  fontSize: 12,
  fill: CHART_COLORS.muted,
} as const;

export const chartLegendStyle = {
  fontSize: 12,
  color: CHART_COLORS.ink,
} as const;
