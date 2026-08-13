"use client";

import { useEffect, useState } from "react";
import { ReasoningPanel } from "@/components/ai/reasoning-panel";
import { toReasoningSteps } from "@/domain/reasoning";
import { useI18n } from "@/hooks/useI18n";
import type { AssistantPartProps } from "./types";
import type { ThinkingContent } from "@/lib/types";

/**
 * Thinking / reasoning renderer, backed by the vendored `<ReasoningPanel>`.
 *
 * The panel is controlled — `useState` here owns `open` / `onOpenChange`.
 * The convention from the previous inline `ThinkingBlock` is preserved:
 * a fresh live turn opens the panel on first stream chunk; completed
 * historical turns start collapsed so the transcript stays scannable.
 *
 * Deferred load (`block.deferred: true`, historic thinking not in memory)
 * intentionally stays out of scope here — it needs bridge plumbing that
 * this ticket does not modify. When we later add on-demand load, it lands
 * inside this wrapper without touching `<ReasoningPanel>` or the adapter.
 */
export function ThinkingPart(props: AssistantPartProps) {
  const block = props.block as ThinkingContent;
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(props.isStreaming === true);
  const durationSec = props.streamingDuration;

  useEffect(() => {
    if (props.isStreaming) setOpen(true);
  }, [props.isStreaming]);

  const stats = toReasoningSteps(block, {
    streaming: props.isStreaming === true,
    durationSec,
    restingLabel: t("i18n.thinking") ?? "Thought",
    stepTitle: t("i18n.thinkingShort") ?? "Thinking",
  });

  return (
    <div className="my-1">
      <ReasoningPanel
        steps={[...stats.steps]}
        visibleSteps={stats.visibleSteps}
        streaming={stats.streaming}
        open={open}
        onOpenChange={setOpen}
        restingLabel={stats.restingLabel}
        elapsed={stats.elapsed}
      />
    </div>
  );
}
