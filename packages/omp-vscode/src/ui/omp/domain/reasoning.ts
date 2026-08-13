/**
 * `ThinkingContent` → `<ReasoningPanel>` prop shape.
 *
 * Pure function: no React, no bridge, no I/O. Unit-tested in
 * `adapters.test.ts`.
 *
 * Our `ThinkingContent` is a single text stream, so the adapter degenerates
 * to a single step (`title: "Thinking"`, `body: text`). `visibleSteps`
 * always equals `steps.length` (there is nothing to truncate). A future
 * paragraph-split spec would emit multiple steps here without touching
 * `<ReasoningPanel>` or the wrapper.
 */

import type { ThinkingContent } from "@/lib/types";

export interface ReasoningStep {
  title: string;
  body: string;
}

export interface ReasoningStats {
  steps: readonly ReasoningStep[];
  visibleSteps: number;
  streaming: boolean;
  /** Label shown when collapsed. Locale-agnostic; the caller localises. */
  restingLabel: string;
  /** Pre-formatted elapsed time (e.g. `"3s"`) — the vendored component
   *  does no formatting of its own. Omitted when unknown. */
  elapsed?: string;
}

export interface ReasoningOptions {
  streaming?: boolean;
  /** Seconds elapsed since the thinking block started. */
  durationSec?: number;
  /** Shown when the panel is collapsed; falls back to `"Thought"`. */
  restingLabel?: string;
  /** Header title for the single degenerate step. */
  stepTitle?: string;
}

function formatElapsed(sec: number | undefined): string | undefined {
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return undefined;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function toReasoningSteps(
  block: ThinkingContent,
  options: ReasoningOptions = {}
): ReasoningStats {
  const body = typeof block.thinking === "string" ? block.thinking : "";
  const streaming = options.streaming === true;
  const title = options.stepTitle || "Thinking";
  const restingLabel = options.restingLabel || "Thought";

  // Even an empty streaming placeholder is a single step so the panel
  // header shows the shimmer; the body may be empty until the first chunk
  // arrives.
  const steps: ReasoningStep[] = [{ title, body }];
  const elapsed = formatElapsed(options.durationSec);

  const out: ReasoningStats = {
    steps,
    visibleSteps: steps.length,
    streaming,
    restingLabel,
  };
  if (elapsed !== undefined) out.elapsed = elapsed;
  return out;
}
