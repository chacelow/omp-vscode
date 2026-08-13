import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { SessionInfo, SessionTreeNode, AgentMessage } from "@/lib/types";
import {
  createNewSession,
  fetchSessionDetail,
  fetchSessionsList,
} from "@/transport/sessions-transport";

/**
 * Session slice — session list, current session id, and the loaded
 * session-detail (JSONL) blob backing the facade's `data`, `loading`,
 * `error`, `activeLeafId` return fields.
 *
 * Extracted from `hooks/useAgentSession.ts` in T4 Phase A. Mutations are
 * facade-owned (mount, session-prop change, createNew, handleNavigate,
 * turn-end backfill). No ACP-event mutator wires into this store today —
 * ACP events only touch the transcript slice.
 */

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface SessionState {
  sessions: SessionInfo[];
  runningSessionIds: string[];
  currentId: string | null;
  isNew: boolean;
  data: SessionData | null;
  loading: boolean;
  error: string | null;
  activeLeafId: string | null;

  // ---- Pure setters (facade-owned; also called by async actions).
  setCurrent(currentId: string | null, isNew: boolean): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setData(
    next: SessionData | null | (
      (current: SessionData | null) => SessionData | null
    )
  ): void;
  setActiveLeafId(id: string | null): void;
  applyLoaded(data: SessionData): void;
  applySessionList(sessions: SessionInfo[], running?: string[]): void;
  reset(): void;

  // ---- Async actions.
  /** Reload the session list from disk (`sessionsList` hostCall). */
  refreshList(): Promise<void>;
  /** ACP-native new-session creation. Returns the newly-minted sid or null. */
  createNew(cwd: string): Promise<string | null>;
  /** Fetch a session's JSONL detail and populate data/loading/error. */
  switchTo(
    sessionId: string,
    showLoading?: boolean
  ): Promise<SessionData | null>;
}

export const useSessionStore = create<SessionState>()(
  immer((set) => ({
    sessions: [],
    runningSessionIds: [],
    currentId: null,
    isNew: false,
    data: null,
    loading: false,
    error: null,
    activeLeafId: null,

    setCurrent: (currentId, isNew) => set((s) => {
      s.currentId = currentId;
      s.isNew = isNew;
    }),
    setLoading: (loading) => set((s) => { s.loading = loading; }),
    setError: (error) => set((s) => { s.error = error; }),
    setData: (next) => set((s) => {
      s.data = typeof next === "function"
        ? (next as (c: SessionData | null) => SessionData | null)(s.data)
        : next;
    }),
    setActiveLeafId: (id) => set((s) => { s.activeLeafId = id; }),
    applyLoaded: (data) => set((s) => {
      s.data = data;
      s.activeLeafId = data.leafId;
      s.error = null;
    }),
    applySessionList: (sessions, running) => set((s) => {
      s.sessions = sessions;
      if (running) s.runningSessionIds = running;
    }),
    reset: () => set((s) => {
      s.currentId = null;
      s.isNew = false;
      s.data = null;
      s.loading = false;
      s.error = null;
      s.activeLeafId = null;
    }),

    refreshList: async () => {
      try {
        const { sessions, runningSessionIds } = await fetchSessionsList();
        set((s) => {
          s.sessions = sessions;
          s.runningSessionIds = runningSessionIds ?? [];
        });
      } catch {
        // Silently tolerate — the sidebar retries on its own cadence and
        // the facade never blocks on this path.
      }
    },

    createNew: async (cwd) => {
      const sid = await createNewSession(cwd);
      if (sid) set((s) => { s.currentId = sid; });
      return sid;
    },

    switchTo: async (sessionId, showLoading = false) => {
      if (showLoading) set((s) => { s.loading = true; });
      try {
        const detail = await fetchSessionDetail(sessionId);
        if (!detail) throw new Error("Session not found");
        const loaded: SessionData = {
          sessionId: detail.sessionId,
          filePath: detail.filePath,
          tree: detail.tree.filter(
            (node): node is SessionTreeNode =>
              typeof node === "object" && node !== null
          ),
          leafId: detail.leafId,
          context: detail.context,
        };
        set((s) => {
          s.data = loaded;
          s.activeLeafId = loaded.leafId;
          s.error = null;
          // JSONL is painted → release the loading overlay NOW. Attaching
          // ACP (which re-parses the same JSONL server-side and replays
          // it as notifications) can take another 2–5 s for long sessions;
          // blocking the UI on that felt like "loading half a day".
          if (showLoading) s.loading = false;
        });
        return loaded;
      } catch (cause) {
        set((s) => {
          s.error = cause instanceof Error ? cause.message : String(cause);
          if (showLoading) s.loading = false;
        });
        return null;
      }
    },
  }))
);
