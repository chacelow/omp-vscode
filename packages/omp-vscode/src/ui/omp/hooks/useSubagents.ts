import {
  useSubagentsStore,
  type HubJobInfo,
  type SubagentInfo,
} from "@/state/subagents-store";

/**
 * Selector hooks for the subagents slice — placeholder as of T5 Phase A.
 * The store starts empty; these hooks exist so the future subagent /
 * hub-jobs surface can be wired without touching the `useAgentSession`
 * facade again.
 */

export const useSubagents = (): SubagentInfo[] =>
  useSubagentsStore((s) => s.subagents);

export const useActiveSubagentId = (): string | null =>
  useSubagentsStore((s) => s.activeSubagentId);

export const useHubJobs = (): HubJobInfo[] =>
  useSubagentsStore((s) => s.hubJobs);
