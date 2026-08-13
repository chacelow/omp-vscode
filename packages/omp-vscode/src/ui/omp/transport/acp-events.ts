import { subscribeAcp } from "../../bridge";
import { useSessionStore } from "@/state/session-store";
import {
  useTranscriptStore,
  type ApplyAcpSnapshotSummary,
} from "@/state/transcript-store";
import type {
  AcpConnectionSnapshot,
  AcpElicitationRequest,
  AcpHostEvent,
  AcpPermissionRequest,
  AcpSessionState,
} from "../../../core/acp/protocol";

/**
 * ACP event bridge — the single choke point translating `subscribeAcp`
 * events into store patches for the session + transcript slices.
 *
 * On `acp/sessionSnapshot`, transcript-store's `applyAcpSnapshot` reducer
 * owns the message / streaming / partition-revision half; the raw state
 * is then forwarded via `onSnapshot(state, summary)` so the facade can
 * handle the not-yet-extracted concerns (agentPhase, contextUsage, TPS,
 * retry info, isCompacting, slashCommands, onAgentEnd firing).
 *
 * Other event types are pure passthrough — they touch state slices that
 * remain in `useAgentSession.ts` for now (notices, permissions,
 * elicitations, capabilities, errors) and will migrate to their own
 * stores in later tickets.
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
  onPermissionRequest?: (request: AcpPermissionRequest) => void;
  onElicitationRequest?: (request: AcpElicitationRequest) => void;
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
        h.onPermissionRequest?.(event.request);
        return;
      case "acp/elicitationRequest":
        h.onElicitationRequest?.(event.request);
        return;
      case "acp/error":
        h.onError?.(event.message);
        return;
      case "acp/runningSessions":
        return;
    }
  });
}
