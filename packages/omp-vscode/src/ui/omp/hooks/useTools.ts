import {
  useToolsStore,
  type ActiveTool,
  type ToolPreset,
} from "@/state/tools-store";

/**
 * Selector hooks for the tools slice — user tool-preset selection and the
 * live `activeTools` list derived from the current ACP snapshot. Consumed
 * by the `useAgentSession` facade; new callers should reach here directly.
 */

export const useToolPreset = (): ToolPreset =>
  useToolsStore((s) => s.toolPreset);

export const useActiveTools = (): ActiveTool[] =>
  useToolsStore((s) => s.activeTools);
