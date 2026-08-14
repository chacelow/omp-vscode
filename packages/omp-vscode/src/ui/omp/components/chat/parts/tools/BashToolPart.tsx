"use client";

import { useState } from "react";
import { XCircleIcon } from "lucide-react";
import { TerminalBlock } from "@/components/ai/terminal-block";
import { toTerminalStats } from "@/domain/terminal";
import type { ToolPartProps } from "../types";
import { cn } from "@/lib/utils";
import { releaseAutoFollow } from "@/lib/scroll-control";

/**
 * Bash / shell tool renderer, backed by the vendored `<TerminalBlock>`.
 *
 * The vendored component consumes only `{command, lines, visibleCount, done}`
 * and hardcodes an "exit 0" chip. Everything else (real exit code, cancel
 * state, cwd chip, expand/collapse of large output) lives in this file:
 *
 *   - `useState<boolean>` owns the expand/collapse of large output. The
 *     adapter defaults `visibleCount` to `min(lines.length, 50)`; expanding
 *     bumps it to `lines.length`.
 *   - When the adapter marks the block cancelled or errored, we swap the
 *     variant to `"ink"` and paint the cwd chip in red.
 *
 * Nothing here talks to the bridge; all inputs are `ToolPartProps`.
 */
export function BashToolPart({ block, result, cwd }: ToolPartProps) {
  const stats = toTerminalStats(block, result, { cwd });
  const [expanded, setExpanded] = useState(false);

  const overflowed = stats.lines.length > stats.visibleCount;
  const shown = expanded ? stats.lines.length : stats.visibleCount;
  const hidden = Math.max(0, stats.lines.length - shown);

  const errorChip = stats.isCancelled
    ? "cancelled"
    : stats.isError
      ? `exit ${stats.exitCode ?? 1}`
      : null;

  return (
    <div className="my-1 flex w-full max-w-md flex-col gap-1">
      {stats.cwd && (
        <div className="px-1 font-mono text-[10px] text-[var(--text-dim)]">
          <span aria-hidden>~/</span>
          <span className="truncate">{stats.cwd}</span>
        </div>
      )}
      <TerminalBlock
        command={stats.command || "(command)"}
        lines={stats.lines}
        visibleCount={shown}
        done={stats.done}
        variant={stats.isError || stats.isCancelled ? "ink" : "paper"}
      />
      {(errorChip || overflowed) && (
        <div className="flex items-center justify-between px-1 font-mono text-[10px]">
          <span
            className={cn(
              "flex items-center gap-1",
              errorChip
                ? "text-[var(--vscode-errorForeground,#ef4444)]"
                : "text-[var(--text-dim)]"
            )}
          >
            {errorChip && <XCircleIcon className="size-3" />}
            {errorChip}
          </span>
          {overflowed && (
            <button
              type="button"
              onClick={() =>
                setExpanded((v) => {
                  if (!v) releaseAutoFollow();
                  return !v;
                })
              }
              className="text-[var(--text-dim)] hover:text-[var(--text-muted)] underline-offset-2 hover:underline"
            >
              {expanded ? "Collapse" : `Show ${hidden} more line${hidden === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
