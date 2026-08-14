import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { AcpSessionState } from "../../../core/acp/protocol";

/**
 * Tools slice — tool-call bookkeeping owned by the webview.
 *
 * Extracted from `hooks/useAgentSession.ts` in T5 Phase A. Holds two
 * concerns:
 *
 *   1. `toolPreset` — the user's local "none / default / full" toggle;
 *      mirrors omp's tool-preset config on the agent side.
 *   2. `activeTools` — the coalesced list of tools currently in-flight,
 *      derived from `AcpSessionState.toolCalls` filtered by
 *      `status === "in_progress"`. The facade's `agentPhase` builds on
 *      this list; downstream selectors can subscribe directly without
 *      re-deriving.
 *
 * The `lastToolCallsRev` field is the coalescing signal — `syncFromSnapshot`
 * skips the flatMap entirely when the incoming snapshot carries the same
 * partition revision (i.e. a `usage_update` / `plan` / `config` snapshot
 * that doesn't touch tools). This keeps ACP-event flow allocation-free on
 * the hot path.
 *
 * External-event mutations (`syncFromSnapshot`) go through
 * `transport/acp-events.ts` — the single ACP choke point. User-driven
 * mutations (`setToolPreset`) come from the facade's action handlers.
 */

export type ToolPreset = "none" | "default" | "full";

export interface ActiveTool {
  id: string;
  name: string;
}

export interface ToolsSyncSummary {
  /** true when `toolCallsRevision` bumped and `activeTools` was recomputed. */
  toolCallsChanged: boolean;
  activeTools: readonly ActiveTool[];
}

export interface ToolsState {
  toolPreset: ToolPreset;
  activeTools: ActiveTool[];
  lastToolCallsRev: number;

  setToolPreset(preset: ToolPreset): void;
  syncFromSnapshot(state: AcpSessionState): ToolsSyncSummary;
  reset(): void;
}

export const useToolsStore = create<ToolsState>()(
  immer((set, get) => ({
    toolPreset: "default",
    activeTools: [],
    lastToolCallsRev: -1,

    setToolPreset: (preset) =>
      set((s) => {
        s.toolPreset = preset;
      }),

    syncFromSnapshot: (state) => {
      const prev = get();
      const changed = state.toolCallsRevision !== prev.lastToolCallsRev;
      if (!changed)
        return { toolCallsChanged: false, activeTools: prev.activeTools };
      const activeTools = Object.entries(state.toolCalls).flatMap(
        ([id, tool]) =>
          tool.status === "in_progress"
            ? [{ id, name: tool.title ?? tool.kind ?? "Tool" }]
            : []
      );
      set((s) => {
        s.activeTools = activeTools;
        s.lastToolCallsRev = state.toolCallsRevision;
      });
      return { toolCallsChanged: true, activeTools };
    },

    reset: () =>
      set((s) => {
        s.toolPreset = "default";
        s.activeTools = [];
        s.lastToolCallsRev = -1;
      }),
  }))
);
