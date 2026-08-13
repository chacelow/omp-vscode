import type { ComponentType } from "react";
import type {
  AssistantContentBlock,
  ToolCallContent,
  ToolResultMessage,
} from "@/lib/types";

export interface AssistantPartProps {
  block: AssistantContentBlock;
  toolResults?: Map<string, ToolResultMessage>;
  isStreaming?: boolean;
  streamingDuration?: number;
  toolCallDurations?: Map<string, number>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
  snapReveal?: boolean;
  expandAllTools?: boolean;
}

export interface ToolPartProps {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}

export type PartType = AssistantContentBlock["type"];
export type PartRenderer = ComponentType<AssistantPartProps>;
export type ToolRenderer = ComponentType<ToolPartProps>;
