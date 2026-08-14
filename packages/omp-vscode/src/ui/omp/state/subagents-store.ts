import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

/**
 * Subagents slice — placeholder shape for the future subagent / hub-jobs
 * surface.
 *
 * As of T5 Phase A `useAgentSession.ts` exposes NO subagent state today —
 * grep for `subagent|hubJob|childAgent` in that file returns only a
 * comment about `worktreesList`. The store is landed empty (with a shape
 * ready to be populated) so that when a subagent or hub-jobs event kind
 * is added to the ACP protocol later, `transport/acp-events.ts` gains a
 * single wiring point and no facade-level `useState` needs to be
 * introduced first. The shape mirrors the hub roster / job-list vocab
 * used elsewhere in the harness so consumers can be added without
 * another migration.
 *
 * `reset()` is called on every fresh `useAgentSession` mount so a
 * previous ChatWindow's roster doesn't leak into a re-mounted webview.
 */

export type SubagentStatus =
  | "idle"
  | "running"
  | "parked"
  | "done"
  | "failed";

export interface SubagentInfo {
  id: string;
  name: string;
  status: SubagentStatus;
  parentSessionId?: string;
}

export interface HubJobInfo {
  id: string;
  kind: string;
  status: "running" | "settled";
}

export interface SubagentsState {
  subagents: SubagentInfo[];
  activeSubagentId: string | null;
  hubJobs: HubJobInfo[];

  setSubagents(list: SubagentInfo[]): void;
  setActiveSubagentId(id: string | null): void;
  upsertHubJob(job: HubJobInfo): void;
  removeHubJob(id: string): void;
  reset(): void;
}

export const useSubagentsStore = create<SubagentsState>()(
  immer((set) => ({
    subagents: [],
    activeSubagentId: null,
    hubJobs: [],

    setSubagents: (list) =>
      set((s) => {
        s.subagents = list;
      }),
    setActiveSubagentId: (id) =>
      set((s) => {
        s.activeSubagentId = id;
      }),
    upsertHubJob: (job) =>
      set((s) => {
        const idx = s.hubJobs.findIndex((j) => j.id === job.id);
        if (idx >= 0) s.hubJobs[idx] = job;
        else s.hubJobs.push(job);
      }),
    removeHubJob: (id) =>
      set((s) => {
        s.hubJobs = s.hubJobs.filter((j) => j.id !== id);
      }),
    reset: () =>
      set((s) => {
        s.subagents = [];
        s.activeSubagentId = null;
        s.hubJobs = [];
      }),
  }))
);
