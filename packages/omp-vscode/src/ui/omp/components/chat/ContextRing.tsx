import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
} from "../ui/dropdown-menu";

// Context-window usage ring: SVG progress circle. Hover shows a brief
// summary; click opens a card with the full breakdown.

export interface ContextRingDetails {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number | null;
}

export function ContextRing({
  percent,
  contextWindow,
  tokens,
  details,
}: {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
  details?: ContextRingDetails | null;
}) {
  const [open, setOpen] = useState(false);
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));

  const pct = percent ?? 0;
  const R = 9;
  const CIRC = 2 * Math.PI * R;
  const filled = Math.max(0, Math.min(1, pct / 100)) * CIRC;
  const color = pct > 90 ? "var(--destructive)" : pct > 70 ? "var(--warning)" : "var(--accent)";

  const brief = contextWindow
    ? `${pct.toFixed(0)}% / ${fmt(contextWindow)} tokens`
    : tokens !== null ? `${fmt(tokens)} tokens` : "context";

  const rows: Array<[string, string]> = [];
  if (details) {
    if (details.input !== undefined) rows.push(["in", fmt(details.input)]);
    if (details.output !== undefined) rows.push(["out", fmt(details.output)]);
    if (details.cacheRead) rows.push(["cache read", fmt(details.cacheRead)]);
    if (details.cacheWrite) rows.push(["cache write", fmt(details.cacheWrite)]);
  }
  if (details?.cost != null && details.cost > 0) rows.push(["cost", `$${details.cost.toFixed(4)}`]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Context: ${brief}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--toolbar-hover)]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" className="-rotate-90">
                <circle cx="12" cy="12" r={R} fill="none" stroke="color-mix(in srgb, var(--border) 60%, transparent)" strokeWidth="2.5" />
                <circle
                  cx="12" cy="12" r={R} fill="none"
                  stroke={color} strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray={`${filled} ${CIRC - filled}`}
                />
              </svg>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          {brief}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" className="min-w-[240px] p-2">
        <DropdownMenuLabel className="text-sm">Context usage</DropdownMenuLabel>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--text-dim)]">used</span>
            <span className="font-mono text-[var(--text)]">{pct.toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--text-dim)]">window</span>
            <span className="font-mono text-[var(--text)]">{fmt(contextWindow)} tokens</span>
          </div>
          {tokens !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-dim)]">total tokens</span>
              <span className="font-mono text-[var(--text)]">{fmt(tokens)}</span>
            </div>
          )}
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-dim)]">{label}</span>
              <span className="font-mono text-[var(--text)]">{value}</span>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
