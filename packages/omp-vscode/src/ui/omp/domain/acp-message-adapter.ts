import type {
  AgentMessage,
  AssistantMessage,
  ToolCallKind,
  ToolCallStatus,
  ToolResultMessage,
} from "@/lib/types";
import type { AcpMessage } from "../../../core/acp/protocol";
import type { ContentBlock, ToolCall } from "@agentclientprotocol/sdk";

/**
 * Pure adapters translating ACP wire messages into UI-shaped `AgentMessage`s.
 *
 * Extracted from `hooks/useAgentSession.ts` in T4 Phase A. These live in
 * `domain/` because they are pure functions with no React and no I/O —
 * only `Date.now()` for freshly-produced timestamps. The identity WeakMap
 * caches memoize by AcpMessage reference so a stable snapshot round-trip
 * returns the same AgentMessage objects (React.memo lifeline).
 */

type DisplayContent = Array<
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | { type: "thinking"; thinking: string }
>;

const ALLOWED_KINDS: readonly ToolCallKind[] = [
  "read", "edit", "delete", "move", "search",
  "execute", "think", "fetch", "switch_mode", "other",
];
const ALLOWED_STATUSES: readonly ToolCallStatus[] = [
  "pending", "in_progress", "completed", "failed",
];

function normalizeKind(kind: string | undefined): ToolCallKind | undefined {
  return kind && (ALLOWED_KINDS as readonly string[]).includes(kind)
    ? (kind as ToolCallKind)
    : undefined;
}
function normalizeStatus(
  status: string | undefined
): ToolCallStatus | undefined {
  return status && (ALLOWED_STATUSES as readonly string[]).includes(status)
    ? (status as ToolCallStatus)
    : undefined;
}

function blocksToContent(blocks: readonly ContentBlock[]): DisplayContent {
  const result: DisplayContent = [];
  for (const block of blocks) {
    if (block.type === "text") result.push({ type: "text", text: block.text });
    else if (block.type === "image")
      result.push({
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType,
          data: block.data,
        },
      });
  }
  return result;
}

function toolMessages(
  message: AcpMessage,
  tool: ToolCall | undefined
): AgentMessage[] {
  if (message.role !== "toolCall" || !tool) return [];
  const toolName = tool.name?.trim() || tool.kind || tool.title || "tool";
  const input =
    typeof tool.rawInput === "object" &&
    tool.rawInput !== null &&
    !Array.isArray(tool.rawInput)
      ? (tool.rawInput as Record<string, unknown>)
      : {};
  const locations = (tool.locations ?? []).flatMap((location) =>
    location.path
      ? [{
          path: location.path,
          line: typeof location.line === "number" ? location.line : undefined,
        }]
      : []
  );
  // Prefer the tool's content blocks (human-readable text the agent
  // produced) over rawOutput. rawOutput is a structured object; JSON.stringify
  // of it feeds garbage into tool-specific renderers (e.g. the grep match
  // list treated every JSON line as a match).
  let output = (tool.content ?? [])
    .flatMap((item) =>
      item.type === "content" && item.content.type === "text"
        ? [item.content.text]
        : item.type === "diff"
          ? [item.newText]
          : []
    )
    .join("\n");
  if (!output) {
    if (typeof tool.rawOutput === "string") output = tool.rawOutput;
    else if (tool.rawOutput !== undefined) {
      try { output = JSON.stringify(tool.rawOutput, null, 2); }
      catch { output = String(tool.rawOutput); }
    }
  }
  const call: AssistantMessage = {
    role: "assistant",
    content: [{
      type: "toolCall",
      toolCallId: message.toolCallId,
      toolName,
      input,
      toolKind: normalizeKind(tool.kind ?? undefined),
      title: tool.title ?? undefined,
      status: normalizeStatus(tool.status ?? undefined),
      locations: locations.length > 0 ? locations : undefined,
    }],
    model: "",
    provider: "",
    timestamp: Date.now(),
  };
  if (tool.status !== "completed" && tool.status !== "failed") return [call];
  const details =
    tool.rawOutput !== undefined && typeof tool.rawOutput !== "string"
      ? tool.rawOutput
      : undefined;
  const result: ToolResultMessage = {
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName,
    content: output ? [{ type: "text", text: output }] : [],
    isError: tool.status === "failed",
    details,
    timestamp: Date.now(),
  };
  return [call, result];
}

function toAgentMessage(message: AcpMessage): AgentMessage {
  const content = blocksToContent(message.content);
  if (message.role === "user") {
    return {
      role: "user",
      content: content.filter(
        (block): block is DisplayContent[number] &
          ({ type: "text" } | { type: "image" }) =>
          block.type === "text" || block.type === "image"
      ),
      timestamp: Date.now(),
    };
  }
  if (message.role === "thought") {
    return {
      role: "assistant",
      content: content
        .filter((block) => block.type === "text")
        .map((block) => ({ type: "thinking" as const, thinking: block.text })),
      model: "", provider: "", timestamp: Date.now(),
    };
  }
  return {
    role: "assistant",
    content,
    model: "", provider: "", timestamp: Date.now(),
  };
}

// Identity cache — one AgentMessage per AcpMessage reference. Snapshots
// arrive many times a second during streaming; acp-service returns the
// SAME AcpMessage object for messages that didn't change this update and
// only allocates a fresh one for the message whose content grew. Without
// this cache, `toAgentMessage(...)` rebuilt every message on every snapshot
// (new object refs, new Date.now() timestamps) → React saw them as
// different → every MessageView re-rendered per chunk.
//
// Keys: AcpMessage (unchanged → cache hit) AND for tool-call rows the
// ToolCall record it points at (tool progress mutates that separately).
const agentMessageCache = new WeakMap<AcpMessage, AgentMessage[]>();
const toolCallSnapshotCache = new WeakMap<AcpMessage, ToolCall | undefined>();

export function toAgentMessages(
  message: AcpMessage,
  tools: Record<string, ToolCall>
): AgentMessage[] {
  if (message.role === "toolCall") {
    const tool = tools[message.toolCallId];
    const cached = agentMessageCache.get(message);
    if (cached && toolCallSnapshotCache.get(message) === tool) return cached;
    const fresh = toolMessages(message, tool);
    agentMessageCache.set(message, fresh);
    toolCallSnapshotCache.set(message, tool);
    return fresh;
  }
  const cached = agentMessageCache.get(message);
  if (cached) return cached;
  const fresh = [toAgentMessage(message)];
  agentMessageCache.set(message, fresh);
  return fresh;
}

/**
 * ACP emits each tool_call as its own tool-only assistant message; merge
 * consecutive tool-only assistants (with toolResult dividers between) so
 * the message-scoped ToolLine grouping in `components/chat/ToolLine.tsx`
 * can fold sibling reads/greps/bashes across the whole tool run.
 */
export function coalesceToolAssistants(
  messages: AgentMessage[]
): AgentMessage[] {
  const merged: AgentMessage[] = [];
  const isToolOnlyAssistant = (
    message: AgentMessage
  ): message is AssistantMessage =>
    message.role === "assistant" &&
    message.content.length > 0 &&
    message.content.every((block) => block.type === "toolCall");

  for (const message of messages) {
    if (isToolOnlyAssistant(message)) {
      let prevIndex = merged.length - 1;
      while (prevIndex >= 0 && merged[prevIndex].role === "toolResult")
        prevIndex -= 1;
      const prev = prevIndex >= 0 ? merged[prevIndex] : null;
      if (prev && isToolOnlyAssistant(prev)) {
        merged[prevIndex] = {
          ...prev,
          content: [...prev.content, ...message.content],
        };
        continue;
      }
    }
    merged.push(message);
  }
  return merged;
}

/**
 * Walk any content-carrying message object and concatenate its plain text
 * blocks. Tolerates unknown shapes because it's fed AgentMessages,
 * Partial<AgentMessage>s from streaming, and inner blocks of both.
 */
export function messageText(message: unknown): string {
  if (
    !message || typeof message !== "object" ||
    !("content" in message) || !Array.isArray(message.content)
  ) return "";
  return message.content.reduce<string>((text, block) => {
    if (
      !block || typeof block !== "object" || !("type" in block) ||
      block.type !== "text" || !("text" in block) ||
      typeof block.text !== "string"
    ) return text;
    return text + block.text;
  }, "");
}

/**
 * Signature identifying a submitted user message so an authoritative
 * server-side copy can be matched against the optimistic one. Mirrors
 * TUI's `${text}\u0000${imageCount}` pattern (interactive-mode.ts:1609).
 */
export function userMessageSignature(message: AgentMessage): string {
  if (message.role !== "user") return "";
  const text = messageText(message);
  const imageCount = Array.isArray(message.content)
    ? message.content.reduce(
        (count, block) => count + (block?.type === "image" ? 1 : 0),
        0
      )
    : 0;
  return `${text}\u0000${imageCount}`;
}
