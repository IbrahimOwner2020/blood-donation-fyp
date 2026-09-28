import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AssistantCompositionBlock, AssistantResolvedLayoutBlock, AssistantScalar } from "~/lib/assistant";

const COLORS = ["#0f766e", "#b91c1c", "#1d4ed8", "#ca8a04", "#7e22ce", "#475569"];
const WIDTHS = {
  full: "md:col-span-6",
  half: "md:col-span-3",
  third: "md:col-span-2",
  "two-thirds": "md:col-span-4",
} as const;

function display(value: AssistantScalar): string {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  return value;
}

function toneClass(tone: "info" | "warning" | "error" | "success") {
  if (tone === "error") return "border-red-300 bg-red-50 text-red-900";
  if (tone === "warning") return "border-amber-300 bg-amber-50 text-amber-950";
  if (tone === "success") return "border-emerald-300 bg-emerald-50 text-emerald-950";
  return "border-blue-200 bg-blue-50 text-blue-950";
}

function Chart({ block }: { block: Extract<AssistantResolvedLayoutBlock, { type: "chart" }> }) {
  const shared = <><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={block.xKey} /><YAxis /><Tooltip /><Legend /></>;
  return (
    <div className="h-72 w-full" role="img" aria-label={block.title}>
      <ResponsiveContainer>
        {block.chartType === "pie" || block.chartType === "donut" ? (
          <PieChart>
            <Pie data={block.data} dataKey={block.series[0]?.key} nameKey={block.xKey} innerRadius={block.chartType === "donut" ? 55 : 0} outerRadius={95} label>
              {block.data.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip /><Legend />
          </PieChart>
        ) : block.chartType === "line" ? (
          <LineChart data={block.data}>{shared}{block.series.map((series, index) => <Line key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={COLORS[index % COLORS.length]} />)}</LineChart>
        ) : block.chartType === "area" ? (
          <AreaChart data={block.data}>{shared}{block.series.map((series, index) => <Area key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={COLORS[index % COLORS.length]} fill={COLORS[index % COLORS.length]} fillOpacity={0.25} />)}</AreaChart>
        ) : (
          <BarChart data={block.data}>{shared}{block.series.map((series, index) => <Bar key={series.key} dataKey={series.key} name={series.label} stackId={block.chartType === "stacked_bar" ? "total" : undefined} fill={COLORS[index % COLORS.length]} />)}</BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function LayoutBlock({ block }: { block: AssistantResolvedLayoutBlock }) {
  const className = `${WIDTHS[block.width]} min-w-0 rounded-xl border border-nbts-border bg-white p-4`;
  if (block.type === "narrative") return <article className={className}><p className="whitespace-pre-wrap text-sm leading-6 text-nbts-ink">{block.content}</p></article>;
  if (block.type === "metrics") return <section className={className}>{block.title ? <h3 className="font-semibold">{block.title}</h3> : null}<div className="mt-2 grid gap-2 sm:grid-cols-2">{block.items.map((item) => <div key={item.label} className="rounded-lg bg-nbts-surface p-3"><p className="text-xs text-nbts-muted">{item.label}</p><p className="mt-1 text-2xl font-semibold">{display(item.value)}</p>{item.comparison ? <p className="text-xs text-nbts-muted">{item.comparison}</p> : null}</div>)}</div></section>;
  if (block.type === "comparison") return <section className={className}><h3 className="font-semibold">{block.title}</h3><p className="mt-2 text-xs text-nbts-muted">{block.label}</p><div className="mt-1 flex items-end gap-3"><span className="text-2xl font-semibold">{display(block.current)}</span><span className="pb-1 text-sm text-nbts-muted">previously {display(block.previous)}</span></div><p className="mt-2 text-sm font-medium text-nbts-teal">Change: {display(block.change)}{block.mode === "percent_change" ? "%" : ""}</p></section>;
  if (block.type === "table") return <section className={className}><h3 className="font-semibold">{block.title}</h3><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-nbts-muted">{block.columns.map((column) => <th scope="col" className="px-2 py-2" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index} className="border-b border-nbts-border/60">{block.columns.map((column) => <td className="px-2 py-2" key={column.key}>{display(row[column.key] ?? null)}</td>)}</tr>)}</tbody></table></div>{block.truncated ? <p className="mt-2 text-xs text-nbts-muted">Showing {block.rows.length} of {block.total} rows.</p> : null}</section>;
  if (block.type === "chart") return <section className={className}><h3 className="mb-3 font-semibold">{block.title}</h3><Chart block={block} /></section>;
  if (block.type === "ranked_list") return <section className={className}><h3 className="font-semibold">{block.title}</h3><ol className="mt-3 space-y-2">{block.items.map((item) => <li key={`${item.rank}-${item.label}`} className="flex items-center gap-3 rounded bg-nbts-surface px-3 py-2"><span className="font-semibold text-nbts-muted">{item.rank}</span><span className="flex-1 text-sm">{item.label}</span><strong>{display(item.value)}</strong></li>)}</ol></section>;
  if (block.type === "status_summary") return <section className={className}><h3 className="font-semibold">{block.title}</h3><div className="mt-3 flex flex-wrap gap-2">{block.items.map((item) => <div key={item.label} className="rounded-full border border-nbts-border px-3 py-1.5 text-sm"><span className="text-nbts-muted">{item.label}</span> <strong>{display(item.value)}</strong></div>)}</div></section>;
  if (block.type === "timeline") return <section className={className}><h3 className="font-semibold">{block.title}</h3><ol className="mt-3 border-l-2 border-nbts-teal/30 pl-4">{block.items.map((item, index) => <li key={`${item.date}-${index}`} className="relative pb-4"><span className="absolute -left-[1.32rem] top-1 h-2.5 w-2.5 rounded-full bg-nbts-teal" /><time className="text-xs text-nbts-muted">{item.date}</time><p className="text-sm font-medium">{item.title}</p>{item.detail ? <p className="text-xs text-nbts-muted">{item.detail}</p> : null}</li>)}</ol></section>;
  return <aside className={`${WIDTHS[block.width]} rounded-xl border p-4 ${toneClass(block.tone)}`}><p className="text-xs font-semibold uppercase tracking-wide">{block.title ?? (block.type === "recommendation" ? "Recommendation" : "Notice")}</p><p className="mt-1 text-sm">{block.message}</p></aside>;
}

export function CompositionRenderer({ composition }: { composition: AssistantCompositionBlock }) {
  return (
    <div className="space-y-5">
      <header><h2 className="text-xl font-semibold text-nbts-ink">{composition.title}</h2><p className="mt-1 text-sm leading-6 text-nbts-muted">{composition.summary}</p></header>
      {composition.sections.map((section) => <section key={section.id} aria-labelledby={`${section.id}-title`}><>{section.title ? <h3 id={`${section.id}-title`} className="mb-2 text-sm font-semibold uppercase tracking-wide text-nbts-muted">{section.title}</h3> : null}</><div className={section.layout === "stack" ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 md:grid-cols-6"}>{section.blocks.map((block) => <LayoutBlock key={block.id} block={block} />)}</div></section>)}
      <p className="text-[11px] text-nbts-muted">Sources: {composition.sources.map((source) => `${source.tool} (${source.status})`).join(", ")}</p>
    </div>
  );
}
