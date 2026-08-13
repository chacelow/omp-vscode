import {
  useTranscriptStore,
  type StreamingState,
} from "@/state/transcript-store";
import type { AgentMessage } from "@/lib/types";

/**
 * Selector hooks for the transcript slice — messages, streaming state,
 * pending optimistic user message, and JSONL entry ids. Consumed by the
 * `useAgentSession` facade; new callers should reach here directly.
 */

export const useMessages = (): AgentMessage[] =>
  useTranscriptStore((s) => s.messages);

export const usePendingUserMessage = (): AgentMessage | null =>
  useTranscriptStore((s) => s.pendingUserMessage);

export const useEntryIds = (): string[] =>
  useTranscriptStore((s) => s.entryIds);

export const useStreamState = (): StreamingState =>
  useTranscriptStore((s) => s.streaming);
