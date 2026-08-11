import { memo, useEffect, useState } from "react";
import { GitBranch, Shrink, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { hostCall } from "../../../bridge";

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
  cwd,
  tps,
  activeModes,
  fastMode,
  onRoleChange,
  onBranchFrom,
}: {
  t: (key: string) => string;
  isStreaming?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  cwd?: string;
  tps?: number | null;
  onBranchFrom?: () => void;
  fastMode?: boolean;
  onRoleChange?: (role: string) => void;
  activeModes?: readonly string[];
}) {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    let active = true;
    void hostCall("cwdGitBranch", { cwd })
      .then((data) => { if (active) setBranch(data.branch); })
      .catch(() => { if (active) setBranch(null); });
    return () => { active = false; };
  }, [cwd]);
  return (
    <div className="flex items-center gap-2 px-4 pb-1 text-[11px] text-[var(--text-muted)]">
      {/* LEFT: compact + sound */}
      <div className="flex items-center gap-1">
        {branch && (
          <span className="flex items-center gap-1 px-1.5 font-mono text-[10px] text-[var(--text-dim)]" title={branch}>
            <GitBranch size={10} strokeWidth={1.8} />
            {branch}
          </span>
        )}
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
        {onBranchFrom && <Button type="button" onClick={onBranchFrom} variant="ghost" size="sm" className="h-5 rounded-[6px] px-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--toolbar-hover)]">Branch from…</Button>}
      </div>
        {activeModes && activeModes.length > 0 && (
          <span
            className="max-w-48 truncate rounded-full border border-[var(--border)] px-1.5 py-0.5 font-medium text-[10px] text-[var(--text-muted)]"
            title={`Active modes: ${activeModes.join(", ")}`}
          >
            {activeModes.join(" · ")}
          </span>
        )}
      {fastMode && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRoleChange?.("fast")}
          title="Fast mode is active"
          className="h-5 rounded-full border border-amber-400/50 bg-amber-400/10 px-1.5 font-mono text-[10px] font-semibold text-amber-600 hover:bg-amber-400/20"
        >
          FAST
        </Button>
      )}

      <div className="flex-1" />

      {/* RIGHT: tps only — context ring moved into the input toolbar */}
      <div className="flex items-center gap-2">
        {tps !== null && tps !== undefined && (
          <span
            className="font-mono"
            style={{ color: tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f" }}
          >
            {tps.toFixed(1)} t/s
          </span>
        )}
      </div>
    </div>
  );
});
