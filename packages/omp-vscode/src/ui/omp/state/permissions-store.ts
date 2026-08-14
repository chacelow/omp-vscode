import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type {
  AcpElicitationRequest,
  AcpPermissionRequest,
} from "../../../core/acp/protocol";

/**
 * Permissions slice — pending elicitation + approval prompts.
 *
 * Extracted from `hooks/useAgentSession.ts` in T5 Phase A. Owns the single
 * active permission-or-elicitation dialog the user must resolve. ACP host
 * events (`acp/permissionRequest`, `acp/elicitationRequest`) write via
 * `transport/acp-events.ts` — the single choke point; facade actions
 * (`respondInteraction`) clear via `clearDialog`.
 *
 * Only one dialog is visible at a time; if the agent stacks a second
 * request before the first is answered the new one replaces the old one
 * (matches the pre-extraction `useState` semantics — a race the agent
 * side arbitrates on its resolver map, not ours).
 *
 * `resolverId` is exposed as a convenience selector so future components
 * can subscribe by id without re-deriving from the full dialog object.
 */

export type InteractionDialog = AcpPermissionRequest | AcpElicitationRequest;

export interface PermissionsState {
  interactionDialog: InteractionDialog | null;

  setInteractionDialog(dialog: InteractionDialog | null): void;
  clearDialog(): void;
  reset(): void;
}

export const usePermissionsStore = create<PermissionsState>()(
  immer((set) => ({
    interactionDialog: null,

    setInteractionDialog: (dialog) =>
      set((s) => {
        s.interactionDialog = dialog;
      }),
    clearDialog: () =>
      set((s) => {
        s.interactionDialog = null;
      }),
    reset: () =>
      set((s) => {
        s.interactionDialog = null;
      }),
  }))
);
