import { subscribeAcp } from "../../bridge";
import { useSessionStore } from "@/state/session-store";
import { usePermissionsStore } from "@/state/permissions-store";
import { useToolsStore } from "@/state/tools-store";
import {
  useTranscriptStore,
  type ApplyAcpSnapshotSummary,
} from "@/state/transcript-store";
import type {
  AcpConnectionSnapshot,
  AcpHostEvent,
  AcpSessionState,
} from "../../../core/acp/protocol";

/**
 * ACP event bridge — the single choke point translating `subscribeAcp`
 * events into store patches for every slice.
 *
 * Slice ownership (T4 + T5 Phase A):
 *   • session-store        writes on `acp/error` (setError)
 *   • transcript-store     writes on `acp/sessionSnapshot` (applyAcpSnapshot)
 *   • tools-store          writes on `acp/sessionSnapshot` (syncFromSnapshot)
 *   • permissions-store    writes on `acp/permissionRequest` +
 *                          `acp/elicitationRequest` (setInteractionDialog)
 *
 * Snapshot flow: transcript's `applyAcpSnapshot` reducer owns the
 * message / streaming / partition-revision half; tools' `syncFromSnapshot`
 * derives the in-progress `activeTools` list; the raw state is then
 * forwarded via `onSnapshot(state, summary)` so the facade can handle the
 * not-yet-extracted concerns (agentPhase, contextUsage, TPS, retry info,
 * isCompacting, slashCommands, onAgentEnd firing).
 *
 * Notices, capability snapshots, and error passthroughs stay on the
 * handlers interface — those slices remain in `useAgentSession.ts` for
 * now and will migrate later.
 */

export type NoticeLevel = "info" | "success" | "warning" | "error";

export interface AcpEventHandlers {
  onSnapshot?: (
    state: AcpSessionState,
    summary: ApplyAcpSnapshotSummary
  ) => void;
  onConnection?: (snapshot: AcpConnectionSnapshot) => void;
  onNotice?: (
    level: NoticeLevel,
    message: string,
    sessionId?: string
  ) => void;
  onError?: (message: string) => void;
}

/**
 * Install the ACP event bridge. Consumers pass a `getHandlers()` getter so
 * the subscription is set up ONCE per mount while the callback closure can
 * evolve freely across renders (the standard latest-ref pattern). Returns
 * the unsubscribe function.
 */
export function installAcpEventBridge(
  getHandlers: () => AcpEventHandlers
): () => void {
  return subscribeAcp((event: AcpHostEvent) => {
    const h = getHandlers();
    switch (event.type) {
      case "acp/sessionSnapshot": {
        const currentId = useSessionStore.getState().currentId;
        const summary = useTranscriptStore
          .getState()
          .applyAcpSnapshot(event.state, currentId);
        // Tools bookkeeping is fed even for foreign / empty-guarded
        // snapshots — `syncFromSnapshot` skips work internally when
        // `toolCallsRevision` is stable, so the extra call is cheap
        // and keeps `activeTools` consistent across session flips.
        useToolsStore.getState().syncFromSnapshot(event.state);
        h.onSnapshot?.(event.state, summary);
        return;
      }
      case "acp/connection":
        h.onConnection?.(event.snapshot);
        return;
      case "acp/notice":
        h.onNotice?.(event.level, event.message, event.sessionId);
        return;
      case "acp/permissionRequest":
        usePermissionsStore
          .getState()
          .setInteractionDialog(event.request);
        return;
      case "acp/elicitationRequest":
        usePermissionsStore
          .getState()
          .setInteractionDialog(event.request);
        return;
      case "acp/error":
        h.onError?.(event.message);
        return;
      case "acp/runningSessions":
        // Reserved for the subagents slice — the current
        // `useSubagentsStore` is a placeholder and does not yet
        // ingest `runningSessions`. Wiring lands in a follow-up
        // ticket once the corresponding UI surface is designed.
        return;
    }
  });
}
