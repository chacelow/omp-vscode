import { useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
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
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(0)}k`
        : String(n);

  const pct = percent ?? 0;
  const R = 9;
  const CIRC = 2 * Math.PI * R;
  const filled = Math.max(0, Math.min(1, pct / 100)) * CIRC;
  const color =
    pct > 90
      ? "var(--destructive)"
      : pct > 70
        ? "var(--warning)"
        : "var(--accent)";

  const brief = contextWindow
    ? `${pct.toFixed(0)}% / ${fmt(contextWindow)} tokens`
    : tokens !== null
      ? `${fmt(tokens)} tokens`
      : "context";

  // RPC reports only overall context-window usage. Its available breakdown is
  // cumulative model usage, not an attribution to tools, skills, or prompts.
  const usageRows: Array<{ label: string; tokens: number }> = [];
  if (details) {
    if (details.input !== undefined)
      usageRows.push({ label: "input", tokens: details.input });
    if (details.output !== undefined)
      usageRows.push({ label: "output", tokens: details.output });
    if (details.cacheRead)
      usageRows.push({ label: "cache read", tokens: details.cacheRead });
    if (details.cacheWrite)
      usageRows.push({ label: "cache write", tokens: details.cacheWrite });
  }
  const accountedTokens = usageRows.reduce(
    (total, row) => total + row.tokens,
    0
  );

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
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                className="-rotate-90"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={R}
                  fill="none"
                  stroke="color-mix(in srgb, var(--border) 60%, transparent)"
                  strokeWidth="2.5"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={R}
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
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
            <span className="font-mono text-[var(--text)] tabular-nums">
              {pct.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--text-dim)]">window</span>
            <span className="font-mono text-[var(--text)] tabular-nums">
              {fmt(contextWindow)} tokens
            </span>
          </div>
          {tokens !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-dim)]">current context</span>
              <span className="font-mono text-[var(--text)] tabular-nums">
                {fmt(tokens)}
              </span>
            </div>
          )}
          {usageRows.length > 0 && (
            <div className="mt-2 border-t border-[var(--border)] pt-2">
              <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">
                Cumulative model usage
              </p>
              <div className="space-y-1.5">
                {usageRows.map((row) => {
                  const share = accountedTokens
                    ? (row.tokens / accountedTokens) * 100
                    : 0;
                  return (
                    <div
                      key={row.label}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-[var(--text-dim)]">
                        {row.label}
                      </span>
                      <span className="font-mono text-[var(--text)] tabular-nums">
                        {fmt(row.tokens)} · {share.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {details?.cost != null && details.cost > 0 && (
            <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 text-xs">
              <span className="text-[var(--text-dim)]">cost</span>
              <span className="font-mono text-[var(--text)] tabular-nums">
                ${details.cost.toFixed(4)}
              </span>
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
