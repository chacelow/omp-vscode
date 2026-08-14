import {
  usePermissionsStore,
  type InteractionDialog,
} from "@/state/permissions-store";

/**
 * Selector hooks for the permissions slice — the pending interaction
 * dialog and its resolver id. Consumed by the `useAgentSession` facade;
 * new callers should reach here directly.
 */

export const useInteractionDialog = (): InteractionDialog | null =>
  usePermissionsStore((s) => s.interactionDialog);

export const useActiveResolverId = (): string | null =>
  usePermissionsStore((s) => s.interactionDialog?.resolverId ?? null);
