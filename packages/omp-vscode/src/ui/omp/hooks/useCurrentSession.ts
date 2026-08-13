import { useSessionStore } from "@/state/session-store";
import type { SessionData } from "@/state/session-store";

/**
 * Selector hooks for the session slice — session list, current session id,
 * and the loaded JSONL detail. Consumed by the `useAgentSession` facade;
 * new callers should reach here directly.
 */

export const useSessions = () =>
  useSessionStore((s) => s.sessions);

export const useCurrentSessionId = (): string | null =>
  useSessionStore((s) => s.currentId);

export const useIsNewSession = (): boolean =>
  useSessionStore((s) => s.isNew);

export const useSessionData = (): SessionData | null =>
  useSessionStore((s) => s.data);

export const useSessionLoading = (): boolean =>
  useSessionStore((s) => s.loading);

export const useSessionError = (): string | null =>
  useSessionStore((s) => s.error);

export const useActiveLeafId = (): string | null =>
  useSessionStore((s) => s.activeLeafId);
