"use client";

import {
  memo,
  useState,
  useRef,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { MarkdownBody } from "./MarkdownBody";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { parseAnsiLine } from "@/lib/ansi";
import { Shimmer } from "./ai-elements/shimmer";
import {
  ArrowDownRight,
  ArrowUpRight,
  BrainIcon,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Database,
  Gauge,
  GitBranch,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { useI18n } from "@/hooks/useI18n";
import { usePreferences } from "@/hooks/usePreferences";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { ExploringGroup, ToolLine, isBashTool, isExploringTool, isLineStyleTool } from "./chat/ToolLine";
import {
  getAssistantErrorMessage,
  isEmptyThinkingBlock,
} from "@/lib/message-display";
import { parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  BashExecutionMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
} from "@/lib/types";
import { hostCall } from "../../bridge";
import { useStreamingReveal } from "../hooks/useStreamingReveal";
import { useToolArgsReveal } from "../hooks/useToolArgsReveal";

const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();

function loadThinkingContent(
  sessionId: string,
  entryId: string,
  blockIndex: number
): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached;
  }

  const request = hostCall("sessionEntryThinking", {
    sessionId,
    entryId,
    blockIndex,
  })
    .then((data) => {
      if (typeof data.thinking !== "string")
        throw new Error("Invalid thinking response");
      return data.thinking;
    })
    .catch((error) => {
      thinkingContentCache.delete(key);
      throw error;
    });

  thinkingContentCache.set(key, request);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}
export interface AssistantHoverMeta {
  input?: number;
  output?: number;
  cacheRead?: number;
  durationSec?: number;
  tps?: number;
}


interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  onEditResend?: (
    entryId: string,
    text: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>
  ) => void;
  /** Renders the full ChatInput in inline edit mode (edit-from-here). */
  editInputRender?: (
    entryId: string,
    content: string,
    onCancel: () => void,
    onSubmit?: (
      text: string,
      images?: Array<{ data: string; mimeType: string }>
    ) => void,
    collapsed?: boolean
  ) => ReactNode;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  /** Suppress the new-session (fork) action (used for split process blocks). */
  hideFork?: boolean;
  showThinking?: boolean;
  expandAllTools?: boolean;
  toolsHidden?: boolean;
  /**
   * Shared assistant metadata sink. Assistant messages call this on mouse
   * enter with their in/out/cache/duration/tps stats, and with `null` on
   * mouse leave, so the layout can render a single hover-only meta strip
   * (near the input footer) instead of repeating stats under every message.
   */
  onHoverMeta?: (meta: AssistantHoverMeta | null) => void;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${date} ${time}`;
}

function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (
      block.type === "toolCall" &&
      previous?.get(block.toolCallId) !== next?.get(block.toolCallId)
    ) {
      return false;
    }
  }
  return true;
}

export const MessageView = memo(
  function MessageView({
    message,
    isStreaming,
    toolResults,
    modelNames,
    cwd,
    onOpenFile,
    entryId,
    onFork,
    forking,
    onNavigate,
    prevAssistantEntryId,
    onEditContent,
    onEditResend,
    editInputRender,
    showTimestamp,
    prevTimestamp,
    sessionId,
    hideFork,
    showThinking = true,
    expandAllTools = false,
    toolsHidden = false,
    onHoverMeta,
  }: Props) {
    if (message.role === "user") {
      return (
        <UserMessageView
          message={message as UserMessage}
          cwd={cwd}
          onOpenFile={onOpenFile}
          entryId={entryId}
          onFork={onFork}
          forking={forking}
          onNavigate={onNavigate}
          prevAssistantEntryId={prevAssistantEntryId}
          onEditContent={onEditContent}
          onEditResend={onEditResend}
          editInputRender={editInputRender}
        />
      );
    }
    if (message.role === "assistant") {
      return (
        <div className="px-4">
          <AssistantMessageView
            message={message as AssistantMessage}
            isStreaming={isStreaming}
            toolResults={toolResults}
            modelNames={modelNames}
            cwd={cwd}
            onOpenFile={onOpenFile}
            showTimestamp={showTimestamp}
            prevTimestamp={prevTimestamp}
            sessionId={sessionId}
            entryId={entryId}
            hideFork={hideFork}
            onFork={onFork}
            forking={forking}
            showThinking={showThinking}
            expandAllTools={expandAllTools}
            toolsHidden={toolsHidden}
            onHoverMeta={onHoverMeta}
          />
        </div>
      );
    }
    if (message.role === "toolResult") {
      // Rendered inline under its toolCall — skip standalone rendering if paired
      return null;
    }
    if (message.role === "custom") {
      const customView =
        (message as CustomMessage).customType === "compaction" ? (
          <CompactionMessageView message={message as CustomMessage} />
        ) : (
          <CustomMessageView
            message={message as CustomMessage}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        );
      return <div className="px-4">{customView}</div>;
    }
    if (message.role === "bashExecution") {
      return (
        <div className="px-4">
          <BashExecutionView
            message={message as BashExecutionMessage}
            sessionId={sessionId}
          />
        </div>
      );
    }
    return null;
  },
  (prev, next) => {
    return (
      prev.message === next.message &&
      prev.isStreaming === next.isStreaming &&
      haveSameRelevantToolResults(
        prev.message,
        prev.toolResults,
        next.toolResults
      ) &&
      prev.modelNames === next.modelNames &&
      prev.cwd === next.cwd &&
      prev.onOpenFile === next.onOpenFile &&
      prev.entryId === next.entryId &&
      prev.onFork === next.onFork &&
      prev.forking === next.forking &&
      prev.onNavigate === next.onNavigate &&
      prev.prevAssistantEntryId === next.prevAssistantEntryId &&
      prev.onEditContent === next.onEditContent &&
      prev.showTimestamp === next.showTimestamp &&
      prev.prevTimestamp === next.prevTimestamp &&
      prev.sessionId === next.sessionId &&
      prev.hideFork === next.hideFork &&
      prev.showThinking === next.showThinking &&
      prev.expandAllTools === next.expandAllTools &&
      prev.toolsHidden === next.toolsHidden &&
      prev.onHoverMeta === next.onHoverMeta
    );
  }
);

function UserMessageView({
  message,
  cwd,
  onOpenFile,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  onEditResend,
  editInputRender,
}: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  onEditResend?: (
    entryId: string,
    text: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>
  ) => void;
  editInputRender?: (
    entryId: string,
    content: string,
    onCancel: () => void,
    onSubmit?: (
      text: string,
      images?: Array<{ data: string; mimeType: string }>
    ) => void,
    collapsed?: boolean
  ) => ReactNode;
}) {
  const { t } = useI18n();
  const { showImages } = usePreferences();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<{
    text: string;
    images?: Array<{ data: string; mimeType: string }>;
  } | null>(null);
  const resendBtnRef = useRef<HTMLButtonElement>(null);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  // Edit-from-here: the message row renders the full composer — the same
  // component as the bottom input, at ONE position across both states, so
  // the toolbar AnimatePresence runs on the collapsed flip instead of a
  // remount. The composer bleeds past the message-column padding so its
  // box aligns with the bottom input (CHAT_COLUMN_PADDING = 16px per side).
  const cancelEdit = () => {
    if (!confirmOpen) setEditing(false);
  };

  if (!editInputRender) return null;

  return (
    <div
      style={{
        marginBottom: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
      onPointerDown={!editing ? () => setEditing(true) : undefined}
    >
      {/* Inline composer/editor: full column width, no side padding or bleed
          — same box geometry as the bottom composer. */}
      <div style={{ width: "100%", maxWidth: 820 }}>
        {showImages && imageBlocks.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              justifyContent: "flex-end",
              marginBottom: 6,
            }}
          >
            {imageBlocks.map((img, i) => {
              const flat = img as unknown as {
                data?: string;
                mimeType?: string;
              };
              const src = img.source
                ? img.source.type === "base64"
                  ? `data:${img.source.media_type};base64,${img.source.data}`
                  : (img.source.url ?? "")
                : flat.data
                  ? `data:${flat.mimeType};base64,${flat.data}`
                  : "";
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  style={{
                    maxWidth: 180,
                    maxHeight: 180,
                    borderRadius: 6,
                    objectFit: "contain",
                    display: "block",
                    border:
                      "1px solid color-mix(in srgb, var(--accent) 15%, transparent)",
                  }}
                />
              );
            })}
          </div>
        )}
        {editInputRender(
          entryId ?? "",
          content,
          cancelEdit,
          (text, images) => {
            if (!text.trim() && !(images && images.length > 0)) return;
            setPendingSubmit({ text, images });
            setConfirmOpen(true);
          },
          !editing
        )}
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          className="max-w-[380px]"
          onOpenAutoFocus={(e) => {
            // Enter in the dialog must confirm (Resend), not hit the Cancel
            // button which is first in DOM order — Radix focuses the first
            // tabbable by default.
            e.preventDefault();
            resendBtnRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              {t("i18n.resendTitle") ?? "Resend edited message"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {t("i18n.editFromHereConfirm") ??
                "This rewinds the conversation to this message and regenerates from your edited text."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-7 text-xs"
              onClick={() => {
                // Leave edit mode (draft stays in the composer) — the dialog
                // alone closing would strand the editor open.
                setEditing(false);
              }}
            >
              {t("i18n.cancel") ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              ref={resendBtnRef}
              className="h-7 text-xs"
              onClick={() => {
                setConfirmOpen(false);
                const p = pendingSubmit;
                setPendingSubmit(null);
                if (p && entryId) {
                  onEditResend?.(
                    entryId,
                    p.text,
                    p.images?.map((img) => ({
                      type: "image" as const,
                      data: img.data,
                      mimeType: img.mimeType,
                    }))
                  );
                  setEditing(false);
                }
              }}
            >
              {t("i18n.resend") ?? "Resend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  cwd,
  onOpenFile,
  showTimestamp,
  prevTimestamp,
  sessionId,
  entryId,
  hideFork,
  onFork,
  forking,
  showThinking = true,
  expandAllTools = false,
  toolsHidden = false,
  onHoverMeta,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  entryId?: string;
  hideFork?: boolean;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  showThinking?: boolean;
  expandAllTools?: boolean;
  toolsHidden?: boolean;
  onHoverMeta?: (meta: AssistantHoverMeta | null) => void;
}) {
  const { t } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const canFork = !isStreaming && !hideFork && !!entryId && !!onFork;
  const blockItems = (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => showThinking || block.type !== "thinking")
    .filter(({ block }) => !toolsHidden || block.type !== "toolCall")
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming }));
  const blocks = blockItems.map(({ block }) => block);
  const providerError = getAssistantErrorMessage(message, { isStreaming });
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const [durationHover, setDurationHover] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<
    Map<number, number>
  >(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    // Timestamps may be ISO strings (session file) or epoch ms (streaming) —
    // normalize both before subtracting.
    const end =
      typeof message.timestamp === "number"
        ? message.timestamp
        : Date.parse(message.timestamp);
    const start =
      typeof prevTimestamp === "number"
        ? prevTimestamp
        : Date.parse(prevTimestamp);
    if (!Number.isFinite(end) || !Number.isFinite(start)) return undefined;
    const secs = Math.round((end - start) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    const end =
      typeof message.timestamp === "number"
        ? message.timestamp
        : Date.parse(message.timestamp);
    if (!Number.isFinite(end)) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp) {
        const start =
          typeof result.timestamp === "number"
            ? result.timestamp
            : Date.parse(result.timestamp);
        if (!Number.isFinite(start)) continue;
        const secs = Math.round((end - start) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const bs = items.map(({ block }) => block);
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex))
          blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (
            !next.has(originalIndex) &&
            blockStartTimesRef.current.has(originalIndex)
          ) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart =
              blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      let chars = 0;
      for (const b of bs) {
        if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
        else if (b.type === "thinking")
          chars += (b as ThinkingContent).thinking?.length ?? 0;
        else if (b.type === "toolCall")
          chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
      }
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      setDurationHover(elapsed);
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (blocks.length === 0 && !isStreaming && !providerError) return null;

  // Tool calls chain together visually: a message that ends with a tool call
  // gets a tight bottom margin so the next (often also a tool) message sits
  // right below — one continuous tool stream, same gap everywhere.
  const lastBlock = blocks[blocks.length - 1];
  const endsWithTool = lastBlock?.type === "toolCall";

  // Completed messages: use the engine-computed duration (message.duration,
  // ms) with usage.output — same formula as the TUI status line. Our own
  // timestamp diff was wrong (ISO strings / partial spans → 545 tok/s).
  const engineDurationMs = useMemo<number | undefined>(() => {
    const d = (message as AssistantMessage & { duration?: number }).duration;
    return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined;
  }, [message]);

  const completedTps = useMemo<number | null>(() => {
    if (isStreaming || !message.usage) return null;
    const durMs = engineDurationMs;
    if (durMs === undefined || durMs < 100) return null;
    const out = message.usage.output ?? 0;
    if (!Number.isFinite(out) || out <= 0) return null;
    return Math.round((out * 1000) / durMs);
  }, [isStreaming, message.usage, engineDurationMs]);

  // Publish own stats to a shared meta panel on hover. Values are computed
  // lazily inside the callback so we don't re-subscribe every render.
  const publishMeta = onHoverMeta
    ? () => onHoverMeta({
        input: message.usage?.input,
        output: message.usage?.output,
        cacheRead: message.usage?.cacheRead,
        durationSec: engineDurationMs !== undefined ? engineDurationMs / 1000 : durationHover ?? undefined,
        tps: tps ?? completedTps ?? undefined,
      })
    : undefined;
  const clearMeta = onHoverMeta ? () => onHoverMeta(null) : undefined;

  return (
    <div
      className="group assistant-message"
      style={{ marginBottom: endsWithTool ? 2 : 16, position: "relative" }}
      onMouseEnter={publishMeta}
      onMouseLeave={clearMeta}
    >
      {/* Model label / streaming estimate — hidden from layout; the hover
          tooltip above shows model, usage and tok/s instead. */}
      {false && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {message.provider && (
            <span>
              {modelNames?.[`${message.provider}:${message.model}`] ??
                modelNames?.[message.model] ??
                message.model}
            </span>
          )}
          {isStreaming &&
            (() => {
              let chars = 0;
              for (const b of blocks) {
                if (b.type === "text")
                  chars += (b as TextContent).text?.length ?? 0;
                else if (b.type === "thinking")
                  chars += (b as ThinkingContent).thinking?.length ?? 0;
                else if (b.type === "toolCall")
                  chars += JSON.stringify(
                    (b as ToolCallContent).input ?? {}
                  ).length;
              }
              const est = Math.round(chars / 4);
              return (
                <>
                  {est > 0 && (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        color: "var(--text)",
                      }}
                      title={t("i18n.estimatedTokens")}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 2,
                          fontSize: 11,
                          fontWeight: 400,
                        }}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="5" y1="1.5" x2="5" y2="8.5" />
                          <polyline points="2 6 5 8.5 8 6" />
                        </svg>
                        {est}
                      </span>
                      {tps !== null &&
                        (() => {
                          const t = tps ?? 0;
                          const bg =
                            t >= 50
                              ? "#53b3cb"
                              : t >= 30
                                ? "#9bc53d"
                                : t >= 15
                                  ? "#f9c22e"
                                  : "#e01a4f";
                          return (
                            <span
                              style={{
                                marginLeft: 6,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: bg,
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 400,
                              }}
                            >
                              {t.toFixed(1)} t/s
                            </span>
                          );
                        })()}
                    </span>
                  )}
                </>
              );
            })()}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {(() => {
          const rendered: ReactNode[] = [];
          let index = 0;
          while (index < blockItems.length) {
            const item = blockItems[index];
            const { block, originalIndex } = item;
            if (block.type === "toolCall" && isExploringTool(block)) {
              const group: ToolCallContent[] = [block];
              let next = index + 1;
              while (next < blockItems.length) {
                const candidate = blockItems[next].block;
                if (candidate.type !== "toolCall" || !isExploringTool(candidate)) break;
                group.push(candidate);
                next += 1;
              }
              if (group.length >= 2) {
                rendered.push(
                  <ExploringGroup
                    key={`${entryId ?? "stream"}-explore-${originalIndex}`}
                    blocks={group}
                    toolResults={toolResults}
                    toolCallDurations={toolCallDurations}
                    onOpenFile={onOpenFile}
                    variant="exploring"
                  />
                );
                index = next;
                continue;
              }
              rendered.push(
                <ToolLine
                  key={`${entryId ?? "stream"}-line-${block.toolCallId}`}
                  block={block}
                  result={toolResults?.get(block.toolCallId)}
                  duration={toolCallDurations?.get(block.toolCallId)}
                  onOpenFile={onOpenFile}
                />
              );
              index += 1;
              continue;
            }
            if (block.type === "toolCall" && isBashTool(block)) {
              const group: ToolCallContent[] = [block];
              let next = index + 1;
              while (next < blockItems.length) {
                const candidate = blockItems[next].block;
                if (candidate.type !== "toolCall" || !isBashTool(candidate)) break;
                group.push(candidate);
                next += 1;
              }
              if (group.length >= 2) {
                rendered.push(
                  <ExploringGroup
                    key={`${entryId ?? "stream"}-bash-${originalIndex}`}
                    blocks={group}
                    toolResults={toolResults}
                    toolCallDurations={toolCallDurations}
                    onOpenFile={onOpenFile}
                    variant="bash"
                  />
                );
                index = next;
                continue;
              }
              rendered.push(
                <ToolLine
                  key={`${entryId ?? "stream"}-line-${block.toolCallId}`}
                  block={block}
                  result={toolResults?.get(block.toolCallId)}
                  duration={toolCallDurations?.get(block.toolCallId)}
                  onOpenFile={onOpenFile}
                />
              );
              index += 1;
              continue;
            }
            if (block.type === "toolCall" && isLineStyleTool(block)) {
              rendered.push(
                <ToolLine
                  key={`${entryId ?? "stream"}-line-${block.toolCallId}`}
                  block={block}
                  result={toolResults?.get(block.toolCallId)}
                  duration={toolCallDurations?.get(block.toolCallId)}
                  onOpenFile={onOpenFile}
                />
              );
              index += 1;
              continue;
            }
            const nextBlock = blockItems[index + 1]?.block;
            rendered.push(
              <BlockView
                key={`${entryId ?? "stream"}-${originalIndex}`}
                block={block}
                toolResults={toolResults}
                isStreaming={isStreaming}
                streamingDuration={
                  streamingDurations.get(originalIndex) ??
                  (block.type === "thinking" ? thinkingDurationFromFile : undefined)
                }
                toolCallDurations={toolCallDurations}
                cwd={cwd}
                onOpenFile={onOpenFile}
                sessionId={sessionId}
                entryId={entryId}
                blockIndex={originalIndex}
                snapReveal={nextBlock?.type === "toolCall"}
                expandAllTools={expandAllTools}
              />
            );
            index += 1;
          }
          return rendered;
        })()}
      </div>

      {providerError && (
        <div
          role="alert"
          style={{
            marginTop: blocks.length > 0 ? 8 : 0,
            padding: "7px 10px",
            border:
              "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)",
            borderRadius: 6,
            background:
              "color-mix(in srgb, var(--destructive) 7%, transparent)",
            color: "#ef4444",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          Error: {providerError}
        </div>
      )}
      {(!isStreaming && (time || canFork)) ? (
        <div className="assistant-message-meta mt-1 flex min-w-0 flex-nowrap items-center justify-end gap-3 overflow-hidden font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
          {canFork && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onFork?.(entryId!)}
              disabled={forking}
              title={
                forking ? t("i18n.creatingSession") : t("i18n.newSessionTitle")
              }
              className={cn(
                "assistant-meta-action h-[18px] shrink-0 gap-1 px-1.5 text-[10px] font-normal",
                forking && "cursor-not-allowed text-[var(--accent)]"
              )}
            >
              <GitBranch size={10} strokeWidth={1.8} />
              {forking ? t("i18n.creating") : t("i18n.newSession")}
            </Button>
          )}
          {time && <span className="assistant-meta-time shrink-0">{time}</span>}
        </div>
      ) : null}
    </div>
  );
}

function BlockView({
  block,
  toolResults,
  isStreaming,
  streamingDuration,
  toolCallDurations,
  cwd,
  onOpenFile,
  sessionId,
  entryId,
  blockIndex,
  snapReveal,
  expandAllTools,
}: {
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
}) {
  if (block.type === "text") {
    return (
      <TextBlock
        block={block}
        isStreaming={isStreaming}
        cwd={cwd}
        onOpenFile={onOpenFile}
        snapReveal={snapReveal}
      />
    );
  }
  if (block.type === "thinking") {
    return (
      <ThinkingBlock
        block={block}
        isStreaming={isStreaming}
        duration={streamingDuration}
        sessionId={sessionId}
        entryId={entryId}
        blockIndex={blockIndex}
      />
    );
  }
  if (block.type === "toolCall") {
    const result = toolResults?.get(block.toolCallId);
    const duration = toolCallDurations?.get(block.toolCallId);
    return (
      <ToolCallBlock
        block={block}
        result={result}
        duration={duration}
        onOpenFile={onOpenFile}
        isStreaming={isStreaming}
        expanded={expandAllTools}
      />
    );
  }
  return null;
}

function TextBlock({
  block,
  isStreaming,
  cwd,
  onOpenFile,
  snapReveal,
}: {
  block: TextContent;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  snapReveal?: boolean;
}) {
  const { displayText } = useStreamingReveal(
    block.text,
    false,
    !isStreaming || snapReveal
  );
  return (
    <MarkdownBody isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>
      {displayText}
    </MarkdownBody>
  );
}

function ThinkingBlock({
  block,
  isStreaming,
  duration,
  sessionId,
  entryId,
  blockIndex,
}: {
  block: ThinkingContent;
  isStreaming?: boolean;
  duration?: number;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
}) {
  const { t } = useI18n();
  // Stream: expanded live (auto-follow); done: collapsed to a one-line
  // summary — zoeymind-style lifecycle.
  const [expanded, setExpanded] = useState(isStreaming === true);
  const prevStreamingRef = useRef(isStreaming);
  const contentRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const { displayText } = useStreamingReveal(
    block.thinking,
    true,
    !isStreaming
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = prevStreamingRef.current;
    if (isStreaming && !prev) setExpanded(true);
    else if (!isStreaming && prev) setExpanded(false);
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // While streaming + expanded, keep the tail of the thinking visible.
  useEffect(() => {
    if (isStreaming && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, block.thinking, isStreaming, expanded]);

  const toggle = async () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded || !block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(t("i18n.thinkingUnavailable"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setContent(await loadThinkingContent(sessionId, entryId, blockIndex));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sf-thinking-block text-[13px]">
      <button
        onClick={() => void toggle()}
        className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left text-[11px] text-[var(--text-dim)] transition-colors duration-100 hover:text-[var(--text-muted)]"
      >
        {isStreaming ? (
          <span className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--text-dim)_30%,transparent)] border-t-[var(--text-muted)]" />
        ) : (
          <ChevronDown
            size={10}
            className={cn(
              "shrink-0 transition-transform duration-150",
              expanded && "rotate-180"
            )}
          />
        )}
        <BrainIcon
          size={12}
          className={cn(
            "shrink-0",
            isStreaming ? "text-[var(--text-muted)]" : "text-[var(--text-dim)]"
          )}
        />
        {isStreaming ? (
          <Shimmer className="text-[11px]" duration={2} spread={1}>
            {t("i18n.thinkingShort") ?? "Thinking…"}
          </Shimmer>
        ) : (
          <span>{t("i18n.thinking") ?? "Thinking"}</span>
        )}
        {duration !== undefined && (
          <span className="ml-auto font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
            {duration}s
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              ref={contentRef}
              className={cn(
                "ml-[5px] max-h-[200px] overflow-y-auto border-l border-[color-mix(in_srgb,var(--border)_60%,transparent)] py-0.5 pl-3 text-[12px] leading-[1.65] whitespace-pre-wrap",
                error ? "text-[#f87171]" : "text-[var(--text-muted)]"
              )}
            >
              {loading
                ? t("i18n.loadingThinking")
                : (error ?? (block.deferred ? content : displayText))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** `read` tool — flowing style like thinking: a single label row (`read`
 * keyword + basename + grab range). No card, no green, no expand/collapse —
 * clicking the filename opens it in VS Code. Failures are greyed out. */
function ReadToolBlock({
  block,
  result,
  duration,
  onOpenFile,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onOpenFile?: (path: string) => void;
}) {
  const path = typeof block.input.path === "string" ? block.input.path : "";
  const grab = block.input.grab;
  const isError = result?.isError === true;
  const grabText =
    typeof grab === "string"
      ? (grab
          .match(/(\d+)\s*[-:]\s*(\d+)/)
          ?.slice(1)
          .join(":") ?? grab)
      : Array.isArray(grab) &&
          grab.length === 2 &&
          typeof grab[0] === "number" &&
          typeof grab[1] === "number"
        ? `${grab[0]}:${grab[1]}`
        : isRecord(grab) &&
            typeof grab.start === "number" &&
            typeof grab.end === "number"
          ? `${grab.start}:${grab.end}`
          : null;

  return (
    <div className={cn("sf-read-block text-[12px]", isError && "opacity-50")}>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] font-semibold",
            isError ? "text-[var(--text-dim)]" : "text-[var(--text-muted)]"
          )}
        >
          read
        </span>
        <button
          type="button"
          onClick={() => onOpenFile?.(path)}
          disabled={!onOpenFile}
          title={path}
          className={cn(
            "min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left font-mono text-[11px] underline-offset-2",
            isError ? "text-[var(--text-dim)]" : "text-[var(--text-muted)]",
            onOpenFile &&
              "cursor-pointer hover:text-[var(--text)] hover:underline"
          )}
        >
          {path ? (path.split("/").filter(Boolean).pop() ?? path) : "(no path)"}
        </button>
        {grabText && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)]">
            L{grabText}
          </span>
        )}
        {duration !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
            {duration}s
          </span>
        )}
      </div>
    </div>
  );
}

function ReadToolGroup({
  blocks,
  toolResults,
  toolCallDurations,
  onOpenFile,
}: {
  blocks: ToolCallContent[];
  toolResults?: Map<string, ToolResultMessage>;
  toolCallDurations?: Map<string, number>;
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-1"
      aria-label={`${blocks.length} read tool calls`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 border-none bg-transparent p-0 text-left font-mono text-[11px] text-[var(--text-muted)]"
      >
        <ChevronDown
          size={12}
          className={cn("transition-transform", expanded && "rotate-180")}
        />
        {blocks.length} reads
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-1">
          {blocks.map((block) => (
            <ReadToolBlock
              key={block.toolCallId}
              block={block}
              result={toolResults?.get(block.toolCallId)}
              duration={toolCallDurations?.get(block.toolCallId)}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ToolCallBlock({
  block,
  result,
  duration,
  onOpenFile,
  isStreaming,
  expanded: forceExpanded = false,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onOpenFile?: (path: string) => void;
  isStreaming?: boolean;
  expanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = forceExpanded || expanded;
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  const { displayInput } = useToolArgsReveal(
    isStreaming ? block.input : JSON.stringify(block.input)
  );
  const inputStr = JSON.stringify(
    isStreaming ? displayInput : block.input,
    null,
    2
  );
  const isEditTool = isEditToolName(block.toolName);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;

  // `read` gets a dedicated flowing style (like thinking): no card, no
  // success green — a label row with the keyword + path + grab range, and
  // file/dir content that opens in VS Code or lists as a scrollable tree.
  if (block.toolName === "read") {
    return (
      <ReadToolBlock
        block={block}
        result={result}
        duration={duration}
        onOpenFile={onOpenFile}
      />
    );
  }

  // Result display
  const resultText = result
    ? result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
    : null;
  const resultIsEmpty =
    resultText === null
      ? false
      : resultText.trim() === "(no output)" || resultText.trim() === "";
  const isError = result?.isError ?? false;

  return (
    <div
      className={`sf-tool-block${isError ? "sf-tool-error" : ""}`}
      style={{
        borderRadius: 7,
        overflow: "hidden",
        fontSize: 12,
        opacity: isError ? 0.55 : 1,
        // Card = widget layer (editorWidget-background), one step above the
        // editor background; border at full-ish strength so it reads as a
        // distinct surface. Failures: same surface, dimmed via opacity.
        border: isError
          ? "1px solid color-mix(in srgb, var(--border) 65%, transparent)"
          : "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
        background: "var(--tool-bg)",
      }}
    >
      {/* ── Tool call header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full min-w-0 cursor-pointer items-center gap-[7px] border-none bg-transparent p-0 text-left text-[12px] text-[var(--text-muted)]"
        style={{
          padding: "6px 10px",
        }}
      >
        {isStreaming ? (
          <Shimmer className="font-mono text-[11px] font-semibold" duration={2}>
            {block.toolName}
          </Shimmer>
        ) : (
          <span
            style={{
              color: isError ? "var(--text-dim)" : "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            {block.toolName}
          </span>
        )}
        {isStreaming ? (
          <Shimmer
            className="flex-1 truncate font-mono text-[11px]"
            duration={2}
            spread={1}
          >
            {getToolPreview(block)}
          </Shimmer>
        ) : (
          <span
            style={{
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {getToolPreview(block)}
          </span>
        )}
        {block.toolName === "bash" &&
          (block.input as { command?: string })?.command && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void copyText(
                  (block.input as { command: string }).command
                ).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
              title={t("i18n.copyCommand") ?? "Copy command"}
              className="flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-[4px] border border-[var(--border)] bg-transparent p-0 px-1.5 text-[10px] text-[var(--text-dim)] opacity-0 transition-[opacity,color] duration-100 group-hover:opacity-100 hover:text-[var(--text-muted)]"
            >
              {copied ? (
                <Check size={10} className="text-[var(--success)]" />
              ) : (
                <Copy size={10} />
              )}
            </button>
          )}
        {duration !== undefined && (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {duration}s
          </span>
        )}
        <ChevronDown
          size={10}
          strokeWidth={1.6}
          className="shrink-0 text-[var(--text-dim)]"
          style={{
            transform: isExpanded ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            {/* ── Expanded: input args ── */}
            {!isEditTool && (
              <pre
                style={{
                  margin: 0,
                  padding: "8px 10px",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  overflow: "auto",
                  background: "var(--bg-subtle)",
                  borderTop: isError
                    ? "1px solid color-mix(in srgb, var(--border) 65%, transparent)"
                    : "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {inputStr}
              </pre>
            )}

            {/* ── Paired result — only shown when expanded ── */}
            {result &&
              (resultDiff ? (
                <PairedDiffResult diff={resultDiff} />
              ) : (
                <PairedResult
                  text={resultText ?? ""}
                  isEmpty={resultIsEmpty}
                  isError={isError}
                  terminalMode={block.toolName === "bash"}
                />
              ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ResultDiff {
  text: string;
}

function PairedDiffResult({ diff }: { diff: ResultDiff }) {
  return (
    <div
      style={{
        borderTop:
          "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
        background: "var(--bg)",
      }}
    >
      <SplitPatchView text={diff.text} />
    </div>
  );
}

function SplitPatchView({ text }: { text: string }) {
  const { t } = useI18n();
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  const showFileHeaders = files.length > 1;

  return (
    <div
      style={{
        maxHeight: 560,
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--bg)",
      }}
    >
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {showFileHeaders && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "var(--bg-panel)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <SplitDiffHeader
                title={file.oldPath || t("i18n.before")}
                side="left"
              />
              <SplitDiffHeader
                title={file.newPath || t("i18n.after")}
                side="right"
              />
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            }}
          >
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <SplitDiffCellView cell={row.left} side="left" />
                  <SplitDiffCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffHeader({
  title,
  side,
}: {
  title: string;
  side: "left" | "right";
}) {
  return (
    <div
      title={title}
      style={{
        padding: "5px 10px",
        color: "var(--text-dim)",
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({
  cell,
  side,
}: {
  cell: SplitDiffCell;
  side: "left" | "right";
}) {
  const bg =
    cell.type === "added"
      ? "color-mix(in srgb, var(--success) 12%, transparent)"
      : cell.type === "removed"
        ? "color-mix(in srgb, var(--destructive) 13%, transparent)"
        : cell.type === "empty"
          ? "var(--bg-subtle)"
          : "transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added"
      ? "#22c55e"
      : cell.type === "removed"
        ? "#f87171"
        : "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--text-dim)",
          userSelect: "none",
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight:
            cell.type === "context" || cell.type === "empty" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color: cell.type === "empty" ? "var(--text-dim)" : "var(--text)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div
      style={{
        maxHeight: 520,
        overflowY: "auto",
        overflowX: "hidden",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.55,
        minWidth: 0,
      }}
    >
      {lines.map((line, i) => {
        const kind = line.startsWith("@@")
          ? "hunk"
          : line.startsWith("+") && !line.startsWith("+++")
            ? "added"
            : line.startsWith("-") && !line.startsWith("---")
              ? "removed"
              : "context";
        const bg =
          kind === "added"
            ? "color-mix(in srgb, var(--success) 12%, transparent)"
            : kind === "removed"
              ? "color-mix(in srgb, var(--destructive) 13%, transparent)"
              : kind === "hunk"
                ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                : "transparent";
        const color =
          kind === "added"
            ? "#22c55e"
            : kind === "removed"
              ? "#f87171"
              : kind === "hunk"
                ? "var(--accent)"
                : "var(--text)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft:
                kind === "added"
                  ? "3px solid #22c55e"
                  : kind === "removed"
                    ? "3px solid #f87171"
                    : kind === "hunk"
                      ? "3px solid var(--accent)"
                      : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                borderRight: "1px solid var(--border)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span
              style={{
                padding: "0 10px",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                color,
              }}
            >
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  return null;
}

function isEditToolName(toolName: string | undefined | null): boolean {
  if (typeof toolName !== "string") return false;
  const name = toolName.toLowerCase();
  return (
    name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function PairedResult({
  text,
  isEmpty,
  isError,
  terminalMode,
}: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
  terminalMode?: boolean;
}) {
  const { t } = useI18n();
  const lines = useMemo(
    () => (terminalMode ? text.split("\n") : null),
    [terminalMode, text]
  );
  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "color-mix(in srgb, var(--border) 65%, transparent)" : "color-mix(in srgb, var(--border) 55%, transparent)"}`,
        background: isError ? "transparent" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          // Terminal mode mimics the VS Code terminal surface: its background
          // + foreground tokens and ANSI colors from the terminal theme.
          color: terminalMode
            ? "var(--vscode-terminal-foreground, var(--text-muted))"
            : isError
              ? "var(--text-dim)"
              : isEmpty
                ? "var(--text-dim)"
                : "var(--text-muted)",
          fontSize: 12,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: 400,
          background: terminalMode
            ? "var(--vscode-terminal-background, var(--bg))"
            : "var(--bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty
          ? t("i18n.noOutput")
          : lines
            ? lines.map((line, i) => (
                <div key={i}>
                  {parseAnsiLine(line).map((seg, j) => (
                    <span key={j} style={seg.style}>
                      {seg.text}
                    </span>
                  ))}
                </div>
              ))
            : text}
      </pre>
    </div>
  );
}

function CompactionMessageView({ message }: { message: CustomMessage }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(
    () => parseCompactionSummary(summary),
    [summary]
  );
  const time = formatTime(message.timestamp);
  const hasDetails = Boolean(
    parsedSummary.body ||
    parsedSummary.readFiles.length ||
    parsedSummary.modifiedFiles.length
  );

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex min-h-10 w-full items-center gap-2 bg-[var(--bg-panel)] px-3 py-2 text-left text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)]"
      >
        <span className="font-mono text-[11px] font-semibold">compaction</span>
        <span className="min-w-0 flex-1 truncate text-xs">
          {t("i18n.conversationCompacted")}
        </span>
        {time && (
          <span className="shrink-0 text-[10px] text-[var(--text-dim)]">
            {time}
          </span>
        )}
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 transition-transform duration-150",
            expanded && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pt-2.5 pb-3">
              <p className="mb-2 text-sm leading-5 text-[var(--text-muted)]">
                {t("i18n.compactionDescription")}
              </p>
              {parsedSummary.body ? (
                <MarkdownBody className="markdown-compaction-message">
                  {parsedSummary.body}
                </MarkdownBody>
              ) : (
                <span className="text-xs text-[var(--text-dim)]">
                  {t("i18n.noSummary")}
                </span>
              )}
              <CompactionFileMetadata
                readFiles={parsedSummary.readFiles}
                modifiedFiles={parsedSummary.modifiedFiles}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!hasDetails && <span className="sr-only">{t("i18n.noSummary")}</span>}
    </section>
  );
}

function CompactionFileMetadata({
  readFiles,
  modifiedFiles,
}: {
  readFiles: string[];
  modifiedFiles: string[];
}) {
  const { t } = useI18n();
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} read`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);

  return (
    <details className="compaction-file-details">
      <summary>{t("i18n.fileContext", { details: parts.join(", ") })}</summary>
      {modifiedFiles.length > 0 && (
        <CompactionFileList
          title={t("i18n.modifiedFiles")}
          files={modifiedFiles}
        />
      )}
      {readFiles.length > 0 && (
        <CompactionFileList title={t("i18n.readFiles")} files={readFiles} />
      )}
    </details>
  );
}

function CompactionFileList({
  title,
  files,
}: {
  title: string;
  files: string[];
}) {
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function CustomMessageView({
  message,
  cwd,
  onOpenFile,
}: {
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const { showImages } = usePreferences();
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => {
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: isHiddenDisplay ? "var(--bg-subtle)" : "var(--bg)",
          opacity: isHiddenDisplay && !contentExpanded ? 0.82 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 650,
            }}
          >
            {title}
          </span>
          {isHiddenDisplay && (
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
              {t("i18n.hiddenExtensionMessage")}
            </span>
          )}
          {time && (
            <span
              style={{
                marginLeft: "auto",
                color: "var(--text-dim)",
                fontSize: 10,
              }}
            >
              {time}
            </span>
          )}
        </div>

        {contentExpanded ? (
          <div style={{ padding: "6px 9px" }}>
            {showImages && images.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  marginBottom: text ? 8 : 0,
                }}
              >
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt=""
                      style={{
                        maxWidth: 240,
                        maxHeight: 240,
                        borderRadius: 6,
                        objectFit: "contain",
                        display: "block",
                        border: "1px solid var(--border)",
                      }}
                    />
                  );
                })}
              </div>
            )}
            {text ? (
              <MarkdownBody
                className="markdown-custom-message"
                cwd={cwd}
                onOpenFile={onOpenFile}
              >
                {text}
              </MarkdownBody>
            ) : (
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                {t("i18n.noMessage")}
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={() => setContentExpanded(true)}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
            }}
          >
            {text ? previewText(text) : t("i18n.showExtensionMessage")}
          </button>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 9px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-subtle)",
          }}
        >
          {text || detailsText ? (
            <button
              onClick={copyContent}
              style={{
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {copied ? t("i18n.copied") : t("i18n.copy")}
            </button>
          ) : null}
          {(hasDetails || isHiddenDisplay) && (
            <button
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              style={{
                marginLeft: "auto",
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {isHiddenDisplay
                ? contentExpanded
                  ? t("i18n.collapse")
                  : t("i18n.expand")
                : detailsExpanded
                  ? t("i18n.hideDetails")
                  : t("i18n.showDetails")}
            </button>
          )}
        </div>

        {hasDetails &&
          ((isHiddenDisplay && contentExpanded) ||
            (!isHiddenDisplay && detailsExpanded)) && (
            <pre
              style={{
                margin: 0,
                padding: "9px 10px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text-muted)",
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 360,
                overflow: "auto",
                fontFamily: "var(--font-mono)",
              }}
            >
              {detailsText}
            </pre>
          )}
      </div>
    </div>
  );
}

function getMessageText(
  content: CustomMessage["content"] | UserMessage["content"]
): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(
  content: CustomMessage["content"] | UserMessage["content"]
): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : (img.source.url ?? "");
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140
    ? `${normalized.slice(0, 140)}...`
    : normalized;
}

function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) {
    // bash: prefer the human-readable `i` (intent) field; fall back to the command.
    if (typeof input.i === "string" && input.i.trim())
      return input.i.trim().slice(0, 120);
    return String(input.command).slice(0, 120);
  }
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead)
    parts.push(`${usage.cacheRead.toLocaleString()} cache R`);
  if (usage.cacheWrite)
    parts.push(`${usage.cacheWrite.toLocaleString()} cache W`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

function BashExecutionView({
  message,
  sessionId,
}: {
  message: BashExecutionMessage;
  sessionId?: string;
}) {
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);

  const isPending =
    !message.output && message.exitCode === undefined && !message.cancelled;
  const isError =
    message.cancelled ||
    (message.exitCode !== undefined && message.exitCode !== 0);
  const fullOutputPath =
    sessionId && message.fullOutputPath ? message.fullOutputPath : null;
  const showFullButton =
    message.truncated && fullOutputPath && fullOutput === null;
  const displayOutput = fullOutput ?? message.output;

  async function loadFullOutput() {
    if (!sessionId || !fullOutputPath) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const data = await hostCall("sessionBashOutput", {
        sessionId,
        path: fullOutputPath,
      });
      if (data.success) {
        setFullOutput(data.data?.output ?? "");
      } else {
        setFullError(data.error ?? "failed");
      }
    } catch (e) {
      setFullError(String(e));
    } finally {
      setLoadingFull(false);
    }
  }

  async function copyFullOutput() {
    if (!sessionId || !fullOutputPath) return;
    try {
      const data = await hostCall("sessionBashOutput", {
        sessionId,
        path: fullOutputPath,
      });
      if (data.success)
        await navigator.clipboard.writeText(data.data?.output ?? "");
      else setFullError(data.error ?? "failed");
    } catch (e) {
      setFullError(String(e));
    }
  }

  // Reuse the existing ToolCallBlock so user-run bash looks identical to an
  // agent-run bash tool call: same header, collapse behavior, result pane.
  // Synthesize an equivalent ToolCallContent + ToolResultMessage pair.
  const toolName = message.excludeFromContext ? "bash (local)" : "bash";
  const block: ToolCallContent = {
    type: "toolCall",
    toolCallId: `bash-${message.timestamp ?? ""}`,
    toolName,
    input: { command: message.command },
  };
  const result: ToolResultMessage | undefined = isPending
    ? undefined
    : {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName,
        content: displayOutput ? [{ type: "text", text: displayOutput }] : [],
        isError,
        timestamp: message.timestamp,
      };

  return (
    <div style={{ margin: "6px 0" }}>
      <ToolCallBlock block={block} result={result} />
      {message.truncated && fullOutputPath && (
        <div style={{ padding: "4px 10px", fontSize: 11, marginTop: -1 }}>
          {showFullButton && (
            <button
              onClick={loadFullOutput}
              disabled={loadingFull}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: loadingFull ? "default" : "pointer",
                fontSize: 11,
                padding: 0,
                textDecoration: "underline",
              }}
            >
              {loadingFull ? "loading…" : "view full output"}
            </button>
          )}
          <button
            type="button"
            onClick={copyFullOutput}
            style={{
              marginLeft: showFullButton ? 10 : 0,
              background: "none",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              padding: 0,
              textDecoration: "underline",
            }}
          >
            download full output
          </button>
          {fullError && (
            <span
              style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: 11 }}
            >
              ({fullError})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
