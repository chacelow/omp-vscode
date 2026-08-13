import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { AgentMessage, AssistantMessage } from "@/lib/types";
import {
  coalesceToolAssistants,
  toAgentMessages,
  userMessageSignature,
} from "@/domain/acp-message-adapter";
import { ompTrace } from "../../boot";
import type { AcpSessionState } from "../../../core/acp/protocol";

/**
 * Transcript slice — messages, streaming state, and partition revisions.
 *
 * Extracted from `hooks/useAgentSession.ts` in T4 Phase A. `applyAcpSnapshot`
 * is invoked by `transport/acp-events.ts` (the ONLY allowed mutator of this
 * store from ACP host events). Other setters are facade-owned (loadSession,
 * handleSend, turn-end JSONL backfill).
 */

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}
export interface ApplyAcpSnapshotSummary {
  /** false when a foreign-session or empty-guarded snapshot was suppressed. */
  processed: boolean;
  messagesChanged: boolean;
  toolCallsChanged: boolean;
  nextMessages: readonly AgentMessage[];
  streamingTail: AssistantMessage | undefined;
}

// Memoized last-computed transcript. When partition revisions are stable
// (usage_update / plan / config touch orthogonal slots), skip the whole
// flatMap+coalesce and re-use this reference for the streaming-tail peek.
let lastNextMessages: AgentMessage[] = [];
const IDLE: StreamingState = { isStreaming: false, streamingMessage: null };

interface TranscriptState {
  messages: AgentMessage[];
  pendingUserMessage: AgentMessage | null;
  entryIds: string[];
  streaming: StreamingState;
  lastMessagesRev: number;
  lastToolCallsRev: number;
  setMessages(
    next: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[])
  ): void;
  setPendingUserMessage(
    next: AgentMessage | null |
      ((current: AgentMessage | null) => AgentMessage | null)
  ): void;
  setEntryIds(next: string[]): void;
  streamStart(): void;
  streamUpdate(message: Partial<AgentMessage>): void;
  streamEnd(): void;
  streamReset(): void;
  resetRevisions(): void;
  resetAll(): void;
  applyAcpSnapshot(
    state: AcpSessionState,
    currentId: string | null
  ): ApplyAcpSnapshotSummary;
}

export const useTranscriptStore = create<TranscriptState>()(
  immer((set, get) => ({
    messages: [],
    pendingUserMessage: null,
    entryIds: [],
    streaming: IDLE,
    lastMessagesRev: -1,
    lastToolCallsRev: -1,

    setMessages: (next) => set((s) => {
      s.messages = typeof next === "function"
        ? (next as (c: AgentMessage[]) => AgentMessage[])(s.messages)
        : next;
    }),
    setPendingUserMessage: (next) => set((s) => {
      s.pendingUserMessage = typeof next === "function"
        ? (next as (c: AgentMessage | null) => AgentMessage | null)(
            s.pendingUserMessage
          )
        : next;
    }),
    setEntryIds: (next) => set((s) => { s.entryIds = next; }),
    streamStart: () => set((s) => {
      s.streaming = { isStreaming: true, streamingMessage: null };
    }),
    streamUpdate: (message) => set((s) => {
      s.streaming = { isStreaming: true, streamingMessage: message };
    }),
    streamEnd: () => set((s) => { s.streaming = IDLE; }),
    streamReset: () => set((s) => { s.streaming = IDLE; }),
    resetRevisions: () => {
      lastNextMessages = [];
      set((s) => { s.lastMessagesRev = -1; s.lastToolCallsRev = -1; });
    },
    resetAll: () => {
      lastNextMessages = [];
      set((s) => {
        s.messages = [];
        s.pendingUserMessage = null;
        s.entryIds = [];
        s.streaming = IDLE;
        s.lastMessagesRev = -1;
        s.lastToolCallsRev = -1;
      });
    },

    applyAcpSnapshot: (state, currentId) => {
      const suppressed: ApplyAcpSnapshotSummary = {
        processed: false, messagesChanged: false, toolCallsChanged: false,
        nextMessages: lastNextMessages, streamingTail: undefined,
      };
      if (state.sessionId !== currentId) return suppressed;
      // Never let an empty-messages snapshot wipe a non-empty local transcript
      // (covers the transient replaying-clear during session/load AND the
      // initial post-newSession snapshot; local came from sessionDetail's
      // authoritative JSONL parse — ACP only enriches mode/config/usage).
      if ((state.messages?.length ?? 0) === 0 && get().messages.length > 0)
        return suppressed;

      const prev = get();
      const messagesChanged = state.messagesRevision !== prev.lastMessagesRev;
      const toolCallsChanged = state.toolCallsRevision !== prev.lastToolCallsRev;
      ompTrace("snap", {
        sid: state.sessionId.slice(0, 8),
        rev: state.revision,
        msgs: state.messages.length,
        tools: Object.keys(state.toolCalls).length,
        pending: state.promptPending,
        stop: state.stopReason,
        msgsΔ: messagesChanged,
        toolsΔ: toolCallsChanged,
      });

      let nextMessages = lastNextMessages;
      if (messagesChanged || toolCallsChanged) {
        nextMessages = coalesceToolAssistants(
          state.messages.flatMap((m) => toAgentMessages(m, state.toolCalls))
        );
        lastNextMessages = nextMessages;
      }

      set((s) => {
        s.lastMessagesRev = state.messagesRevision;
        s.lastToolCallsRev = state.toolCallsRevision;
        if (messagesChanged || toolCallsChanged) {
          // Merge assistant-side stats forward: keep previous usage/duration/
          // ttft/timestamp when the fresh AgentMessage carries no override.
          const previousAssistants = s.messages.filter(
            (m): m is AssistantMessage => m.role === "assistant"
          );
          let idx = 0;
          s.messages = nextMessages.map((m) => {
            if (m.role !== "assistant") return m;
            const previous = previousAssistants[idx++];
            if (!previous) return m;
            const usage = m.usage ?? previous.usage;
            const duration = m.duration ?? previous.duration;
            const ttft = m.ttft ?? previous.ttft;
            const timestamp = m.timestamp ?? previous.timestamp;
            if (usage === m.usage && duration === m.duration &&
                ttft === m.ttft && timestamp === m.timestamp) return m;
            return { ...m, usage, duration, ttft, timestamp };
          });
          if (s.pendingUserMessage) {
            const sig = userMessageSignature(s.pendingUserMessage);
            if (nextMessages.some(
              (m) => m.role === "user" && userMessageSignature(m) === sig
            )) s.pendingUserMessage = null;
          }
        }
        // Only the transcript TAIL is the live streamer (see comment above).
        if (state.promptPending) {
          const tail = nextMessages[nextMessages.length - 1];
          const streaming = tail?.role === "assistant" ? tail : undefined;
          s.streaming = { isStreaming: true, streamingMessage: streaming ?? null };
        } else s.streaming = IDLE;
      });

      const tail = nextMessages[nextMessages.length - 1];
      const streamingTail = state.promptPending && tail?.role === "assistant"
        ? (tail as AssistantMessage) : undefined;
      return { processed: true, messagesChanged, toolCallsChanged,
               nextMessages, streamingTail };
    },
  }))
);
