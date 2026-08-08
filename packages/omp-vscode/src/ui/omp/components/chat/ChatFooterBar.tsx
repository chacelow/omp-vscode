import { memo } from "react";
import { Shrink, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { ContextRing, type ContextRingDetails } from "./ContextRing";

// Toolbar row BELOW the input card: left = compact + sound (moved out of
// the composer), right = token usage, context ring, generation rate.

export interface ChatFooterStats {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  cost?: number | null;
}

export const ChatFooterBar = memo(function ChatFooterBar({
  t,
  isStreaming,
  onCompact,
  onAbortCompaction,
  isCompacting,
  soundEnabled,
  onSoundToggle,
  stats,
  contextUsage,
  tps,
}: {
  t: (key: string) => string;
  isStreaming?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  stats?: ChatFooterStats | null;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  tps?: number | null;
}) {
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));
  const hasStats = Boolean(stats && (stats.total || stats.cost));
  const details: ContextRingDetails | null = stats ? {
    input: stats.input,
    output: stats.output,
    cacheRead: stats.cacheRead,
    cacheWrite: stats.cacheWrite,
    cost: stats.cost ?? null,
  } : null;

  return (
    <div className="flex items-center gap-2 px-4 pb-1 text-[11px] text-[var(--text-muted)]">
      {/* LEFT: compact + sound */}
      <div className="flex items-center gap-1">
        {!isStreaming && onCompact && (
          <Button
            onClick={isCompacting ? onAbortCompaction : onCompact}
            disabled={isStreaming && !isCompacting}
            variant="ghost"
            size="sm"
            title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
            className={cn(
              "h-5 gap-1 rounded-[6px] px-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--toolbar-hover)]",
              isCompacting && "bg-[#ef4444]/8 text-[var(--destructive)] hover:bg-[#ef4444]/15",
            )}
          >
            {isCompacting ? <Square size={9} fill="currentColor" /> : <Shrink size={10} className="shrink-0" />}
            <span className="hidden sm:inline">{isCompacting ? t("chat.compacting") : t("chat.compact")}</span>
          </Button>
        )}
        {onSoundToggle !== undefined && (
          <Button
            onClick={onSoundToggle}
            variant="ghost"
            size="sm"
            title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
            className={cn("h-5 w-5 rounded-[6px] p-0 hover:bg-[var(--toolbar-hover)]", soundEnabled ? "text-[var(--text-muted)]" : "opacity-50")}
          >
            {soundEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
          </Button>
        )}
      </div>

      <div className="flex-1" />

      {/* RIGHT: tokens / tps / context ring */}
      <div className="flex items-center gap-2">
        {tps !== null && tps !== undefined && (
          <span
            className="font-mono"
            style={{ color: tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f" }}
          >
            {tps.toFixed(1)} t/s
          </span>
        )}
        {hasStats && (
          <span className="font-mono whitespace-nowrap">
            {stats!.total ? `${fmt(stats!.total!)} tokens` : ""}
            {stats!.cost ? ` · $${stats!.cost.toFixed(2)}` : ""}
          </span>
        )}
        {contextUsage && (
          <ContextRing
            percent={contextUsage.percent}
            contextWindow={contextUsage.contextWindow}
            tokens={contextUsage.tokens}
            details={details}
          />
        )}
      </div>
    </div>
  );
});
