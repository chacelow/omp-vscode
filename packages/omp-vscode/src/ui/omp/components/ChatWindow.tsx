"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  BashExecutionMessage,
  CustomMessage,
  SessionInfo,
  SessionTreeNode,
  ToolResultMessage,
} from "@/lib/types";
import {
  countToolCallBlocks,
  getAssistantErrorMessage,
  getDisplayableAssistantBlocks,
  splitFinalAssistantBlocks,
} from "@/lib/message-display";
import { MessageView, type AssistantHoverMeta } from "./MessageView";
import {
  ChatInput,
  type ChatInputHandle,
  type ChatInputProps,
} from "./ChatInput";
import { ChatFooterBar } from "./chat/ChatFooterBar";
import {
  ApprovalBar,
  supportsInlineApproval,
} from "./chat/ApprovalBar";
import { ChatMinimap } from "./chat/ChatMinimap";
import { Shimmer } from "./ai-elements/shimmer";
import { InteractionDialog } from "./InteractionDialog";
import { PlanReviewOverlay } from "./panels/PlanReviewOverlay";
import { ModelHub } from "./ModelHub";
import { TemporaryModelPicker } from "./TemporaryModelPicker";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { UserMessageSelector } from "./UserMessageSelector";
import { AgentHub } from "./agent-hub/AgentHub";
import { HistorySearchDialog } from "./HistorySearchDialog";
import { AppLoading } from "./ui/app-loading";
import { ChevronDown, ChevronRight, Clock, TriangleAlert } from "lucide-react";
import { registerScrollControl } from "@/lib/scroll-control";
import { useI18n } from "@/hooks/useI18n";
import {
  useAgentSession,
  type AgentPhase,
  type NoticeItem,
} from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { hostCall } from "../../bridge";
import { useDragDrop } from "@/hooks/useDragDrop";
import type { SessionStatsInfo } from "@/lib/pi-types";
import {
  captureScrollDistance,
  getNextVisibleCount,
  getVisibleRenderWindow,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  /** AppShell-controlled: header "Full history" toggle mounts the minimap. */
  minimapOpen?: boolean;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (
    tree: SessionTreeNode[],
    activeLeafId: string | null,
    onLeafChange: (leafId: string | null) => Promise<void>
  ) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onOpenSettings?: () => void;
  onOpenResumeDialog?: () => void;
  onContextUsageChange?: (
    usage: {
      percent: number | null;
      contextWindow: number;
      tokens: number | null;
    } | null
  ) => void;
  onOpenFile?: (filePath: string) => void;
  /** Current project (short name) + full path + change callback — for the
   *  project switcher in the empty chat page (input top-left). */
  cwdName?: string | null;
  cwd?: string | null;
  onCwdChange?: (cwd: string) => void;
}

function phaseLabel(
  phase: AgentPhase,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return t("chat.runningTool");
    if (names.length === 1)
      return t("chat.runningNamedTool", { name: names[0] });
    if (names.length <= 3)
      return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", {
      names: names.slice(0, 3).join(", "),
      count: names.length - 3,
    });
  }
  if (phase?.kind === "waiting_model") return t("chat.waitingModel");
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}

const CHAT_MINIMAP_WIDTH = 36;
const CHAT_COLUMN_PADDING = 16;
const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING + CHAT_MINIMAP_WIDTH;

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(
    message as AssistantMessage
  ).answerBlocks.some(
    (block) =>
      block.type === "image" ||
      (block.type === "text" && block.text.trim().length > 0)
  );
}

function findFinalAssistantIndex(
  messages: AgentMessage[],
  userIdx: number,
  endIdx: number
): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(
      getDisplayableAssistantBlocks(msg as AssistantMessage)
    );
  }
  return count;
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return (
      getDisplayableAssistantBlocks(message as AssistantMessage).length > 0
    );
  }
  return message.role === "custom";
}

// A user message normally anchors a turn (user prompt → process → final
// answer), and the process messages in between get folded into a collapsed
// ProcessDetailsGroup. When compaction fires mid-turn, pi drops the original
// user prompt and inserts a compaction summary (role "custom", customType
// "compaction") in its place; the agent then keeps producing tool calls and a
// final answer with no user message left to anchor them. Treat a compaction
// summary as an anchor too, otherwise every post-compaction message renders
// standalone and never collapses.
function isGroupAnchor(message: AgentMessage): boolean {
  if (message.role === "user") return true;
  return (
    message.role === "custom" &&
    (message as CustomMessage).customType === "compaction"
  );
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {}
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

function ProcessDetailsGroup({
  messageCount,
  toolCallCount,
  durationSec,
  defaultExpanded = false,
  children,
  t,
}: {
  messageCount: number;
  toolCallCount: number;
  durationSec?: number;
  /** Start expanded when there's no separate final answer to follow —
   *  otherwise the whole turn (thinking / tool calls) is invisible behind
   *  a collapsed summary. */
  defaultExpanded?: boolean;
  children: ReactNode;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [overflowing, setOverflowing] = useState(false);
  const parts = [t("chat.processDetails")];
  if (durationSec !== undefined && durationSec > 0) {
    const minutes = Math.floor(durationSec / 60);
    const seconds = durationSec % 60;
    const formatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    parts.push(`Worked for ${formatted}`);
  }
  parts.push(
    `${messageCount} ${t(messageCount === 1 ? "chat.message" : "chat.messages")}`
  );
  if (toolCallCount > 0)
    parts.push(
      `${toolCallCount} ${t(toolCallCount === 1 ? "chat.toolCall" : "chat.toolCalls")}`
    );

  return (
    <div style={{ marginBottom: 7 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
        title={expanded ? t("chat.collapseProcess") : t("chat.expandProcess")}
      >
        <ChevronRight
          size={12}
          strokeWidth={1.6}
          style={{
            flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {parts.join(" · ")}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onAnimationComplete={() => setOverflowing(true)}
            onAnimationStart={() => setOverflowing(false)}
            className={overflowing ? "" : "overflow-hidden"}
          >
            <div style={{ marginTop: 4 }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
function planReviewSchema(request: unknown): Record<string, unknown> | null {
  if (!request || typeof request !== "object" || !("request" in request))
    return null;
  const nested = request.request;
  if (!nested || typeof nested !== "object" || !("requestedSchema" in nested))
    return null;
  const schema = nested.requestedSchema;
  if (
    !schema ||
    typeof schema !== "object" ||
    !("properties" in schema) ||
    !schema.properties ||
    typeof schema.properties !== "object"
  )
    return null;
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return null;
  const typedProperties = properties as Record<string, unknown>;
  const plan = typedProperties.plan ?? null;
  const feedback = typedProperties.feedback ?? null;
  if (
    !plan ||
    typeof plan !== "object" ||
    !("type" in plan) ||
    plan.type !== "string"
  )
    return null;
  if (
    !feedback ||
    typeof feedback !== "object" ||
    !("type" in feedback) ||
    feedback.type !== "string"
  )
    return null;
  return schema;
}

function planReviewDefault(
  schema: Record<string, unknown>,
  key: "plan" | "feedback"
): string {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return "";
  const property = Object.entries(properties).find(
    ([name]) => name === key
  )?.[1];
  return property &&
    typeof property === "object" &&
    "default" in property &&
    typeof property.default === "string"
    ? property.default
    : "";
}

function planReviewChoices(schema: Record<string, unknown>): string[] {
  const raw = "enum" in schema ? schema.enum : [];
  return Array.isArray(raw)
    ? raw.filter((choice): choice is string => typeof choice === "string")
    : [];
}

export function ChatWindow({
  session,
  newSessionCwd,
  minimapOpen,
  onAgentEnd,
  onSessionCreated,
  onSessionForked,
  modelsRefreshKey,
  chatInputRef,
  onBranchDataChange,
  onSessionStatsChange,
  onOpenSettings,
  onOpenResumeDialog,
  onContextUsageChange,
  onOpenFile,
  cwdName,
  cwd,
  onCwdChange,
}: Props) {
  const { t } = useI18n();
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } =
    useAudio();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback(
    (content: string) => {
      chatInputRef?.current?.insertIfEmpty(content);
    },
    [chatInputRef]
  );

  const {
    loading,
    error,
    messages: rawMessages,
    pendingUserMessage,
    entryIds,
    streamState,
    data,
    agentRunning,
    bashRunning,
    pendingBash,
    modelNames,
    modelList,
    modelError,
    modelScopeWarnings,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    toolPreset,
    thinkingLevel,
    modelRoles,
    fastMode,
    handleRoleChange,
    loadModels,
    retryInfo,
    contextUsage,
    forkingEntryId,
    compactionBoundary,
    imageSupported,
    isCompacting,
    compactError,
    compactResult,
    displayModel: displayModelValue,
    sessionStats,
    currentModel,
    slashCommands,
    notices,
    slashCommandsLoading,
    interactionDialog,
    respondInteraction,
    isAutoModelSelection,
    agentPhase,
    liveTps,
    isNew,
    activeModes,
    sessionIdRef,
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    handleSend,
    handleAbort,
    handleFork,
    handleEditResend,
    handleNavigate,
    handleModelChange,
    setPendingRestoreModel,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleBuiltinSlashCommand,
    handleToolPresetChange,
    handleThinkingLevelChange,
    loadSlashCommands,
  } = useAgentSession({
    session,
    newSessionCwd,
    onAgentEnd: wrappedOnAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    chatInputRef,
    onBranchDataChange,
    onOpenSettings,
    onOpenResumeDialog,
  });
  // Optimistic user message rendered as a separate slot. When a live turn
  // is streaming, its authoritative streaming assistant is the LAST entry
  // in rawMessages; we splice the pending user right before it so the
  // user appears above the streaming response. When there's no live turn
  // (idle or between turns) we simply append the pending user at the end
  // — the previous turn's assistant stays where it is.
  const messages = useMemo(() => {
    if (!pendingUserMessage) return rawMessages;
    const last = rawMessages[rawMessages.length - 1];
    const streamingTail =
      (agentRunning || streamState.isStreaming) && last?.role === "assistant";
    if (streamingTail) {
      return [...rawMessages.slice(0, -1), pendingUserMessage, last];
    }
    return [...rawMessages, pendingUserMessage];
  }, [rawMessages, pendingUserMessage, agentRunning, streamState.isStreaming]);
  const paddedEntryIds = useMemo(() => {
    if (!pendingUserMessage) return entryIds;
    const last = rawMessages[rawMessages.length - 1];
    const streamingTail =
      (agentRunning || streamState.isStreaming) && last?.role === "assistant";
    if (streamingTail) {
      return [
        ...entryIds.slice(0, -1),
        "__pending__",
        entryIds[entryIds.length - 1] ?? "",
      ];
    }
    return [...entryIds, "__pending__"];
  }, [
    entryIds,
    rawMessages,
    pendingUserMessage,
    agentRunning,
    streamState.isStreaming,
  ]);
  const sessionBusy = agentRunning || bashRunning;
  const [modelHubOpen, setModelHubOpen] = useState(false);
  const [temporaryModelPickerOpen, setTemporaryModelPickerOpen] =
    useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [expandAllTools, setExpandAllTools] = useState(false);
  const [toolsHidden, setToolsHidden] = useState(false);
  const [displayResetKey, setDisplayResetKey] = useState(0);
  const [agentHubOpen, setAgentHubOpen] = useState(false);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [hoveredMeta, setHoveredMeta] = useState<AssistantHoverMeta | null>(
    null
  );
  const handleHoverMeta = useCallback(
    (meta: AssistantHoverMeta | null) => setHoveredMeta(meta),
    []
  );

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const [branchSelectorOpen, setBranchSelectorOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMoreRef = useRef<boolean>(false);
  const loadingEarlierRef = useRef<boolean>(false);
  // Message DOM refs for scroll-into-view (minimap was removed for the
  // sidebar; the refs are still used for auto-scroll to the latest message).
  const messageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const prevScrollDistanceRef = useRef<number | null>(null);

  // Auto-load earlier messages when the user scrolls near the top of the
  // container. IntersectionObserver misbehaves in some VS Code webview
  // layouts (nested flex + programmatic scrolls), so a plain scroll listener
  // reads scrollTop directly — simpler and more reliable.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const THRESHOLD_PX = 320;
    const check = (): void => {
      if (!hasMoreRef.current || loadingEarlierRef.current) return;
      if (container.scrollTop > THRESHOLD_PX) return;
      loadingEarlierRef.current = true;
      prevScrollDistanceRef.current = captureScrollDistance(
        container.scrollHeight,
        container.scrollTop
      );
      setVisibleCount((prev) => getNextVisibleCount(prev));
    };
    container.addEventListener("scroll", check, { passive: true });
    check();
    return () => container.removeEventListener("scroll", check);
    // `loading` matters because the scroll container is unmounted while the
    // session-loading state is shown; once loading flips false the container
    // is fresh and we need to (re)attach the listener.
  }, [scrollContainerRef, loading, messages.length]);

  // Release the loading guard once the new page has been prepended and the
  // scroll restoration effect below has run.
  useEffect(() => {
    if (!loadingEarlierRef.current) return;
    const timer = setTimeout(() => {
      loadingEarlierRef.current = false;
    }, 80);
    return () => clearTimeout(timer);
  }, [visibleCount]);

  // After visibleCount increases (more messages prepended), restore the
  // scroll position so the viewport doesn't jump.
  useEffect(() => {
    if (prevScrollDistanceRef.current == null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = restoreScrollTop(
      container.scrollHeight,
      prevScrollDistanceRef.current
    );
    prevScrollDistanceRef.current = null;
  }, [visibleCount, scrollContainerRef]);

  // Auto-follow while streaming — ported from assistant-ui's
  // useThreadViewportAutoScroll (see hooks/useAutoScroll.ts). Follows
  // content growth ONLY while pinned at the bottom, with instant jumps
  // (no animation loop to fight user input). User scroll-up releases;
  // explicit intents (send/load) re-engage.
  const autoScroll = useAutoScroll();
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  useEffect(
    () => autoScroll.subscribe(setPinnedToBottom),
    [autoScroll.subscribe]
  );
  const mergedScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      autoScroll.scrollRef(node);
    },
    [scrollContainerRef, autoScroll.scrollRef]
  );
  // Expose release/scrollToBottom to nested components (edit-mode mounts,
  // tool expanders) so user-initiated layout growth releases the follow lock
  // instead of being mistaken for streaming output. See lib/scroll-control.ts.
  useEffect(
    () =>
      registerScrollControl({
        stopScroll: autoScroll.release,
        scrollToBottom: () => autoScroll.scrollToBottom("smooth"),
        getScrollElement: () => scrollContainerRef.current,
      }),
    [autoScroll.release, autoScroll.scrollToBottom]
  );
  // Load intent: when a session finishes loading (or the user switches
  // sessions) the scroll container remounts at the top — jump to the
  // bottom instantly and re-engage follow (assistant-ui's
  // scrollToBottomOnInitialize / OnThreadSwitch semantics).
  useEffect(() => {
    if (loading) return;
    autoScroll.scrollToBottom("instant");
  }, [loading, session?.id, autoScroll.scrollToBottom]);
  // Edit-resend anchoring (ChatGPT edit semantics; cf. Continue's
  // useAutoScroll: "Only reset scroll state when a new user message is
  // added"). The rewind+reload rebuilds the transcript with fresh entry
  // ids, so exact scrollTop restoration is meaningless — instead anchor
  // the resent user message (now the LAST user message) near the top of
  // the viewport and let the new response stream in below it. Follow
  // stays released; the ↓ button re-engages.
  const pendingResendAnchorRef = useRef(false);
  useEffect(() => {
    if (!pendingResendAnchorRef.current) return;
    const el = lastUserMsgRef.current;
    const scroller = scrollContainerRef.current;
    if (!(el && scroller)) return;
    pendingResendAnchorRef.current = false;
    requestAnimationFrame(() => {
      const top =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        scroller.clientHeight * 0.15;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    });
  }, [messages, lastUserMsgRef, scrollContainerRef]);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
        sessionStats.sessionId,
        sessionStats.sessionFile ?? "",
        sessionStats.sessionName ?? "",
        sessionStats.userMessages,
        sessionStats.assistantMessages,
        sessionStats.toolCalls,
        sessionStats.toolResults,
        sessionStats.totalMessages,
        sessionStats.tokens.input,
        sessionStats.tokens.output,
        sessionStats.tokens.cacheRead,
        sessionStats.tokens.cacheWrite,
        sessionStats.tokens.total,
        sessionStats.cost ?? 0,
      ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(
    () => () => {
      onSessionStatsChange?.(null);
    },
    [onSessionStatsChange]
  );

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(
    () => () => {
      onContextUsageChange?.(null);
    },
    [onContextUsageChange]
  );

  const onDrop = useCallback(
    (files: File[]) => {
      if (sessionBusy) return;
      chatInputRef?.current?.addImages(files);
    },
    [sessionBusy, chatInputRef]
  );

  const {
    isDragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragDrop(onDrop);

  const visibleMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const revealHistoryForMinimap = useCallback(() => {
    setVisibleCount((current) => Math.max(current, messages.length * 2));
  }, [messages.length]);

  const isEmptyNew =
    isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const [serviceVersions, setServiceVersions] = useState<{
    cli: string;
    pi: string;
    omp: string;
  } | null>(null);
  const [versionsUnavailable, setVersionsUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    hostCall("version", {})
      .then((versions) => {
        if (!cancelled) setServiceVersions(versions);
      })
      .catch(() => {
        if (!cancelled) setVersionsUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[
        `${displayModelValue.provider}:${displayModelValue.modelId}`
      ] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[
        `${displayModelValue.provider}:${displayModelValue.modelId}`
      ] ?? null)
    : null;

  // Streaming tokens-per-second for the footer (chars/4 estimate, same
  // heuristic as the message-level badge).
  const [tps, setTps] = useState<number | null>(null);
  const tpsWindowRef = useRef<{ start: number; chars: number } | null>(null);
  useEffect(() => {
    const msg = streamState.streamingMessage;
    if (!msg) {
      setTps(null);
      tpsWindowRef.current = null;
      return;
    }
    const content = Array.isArray((msg as { content?: unknown }).content)
      ? (msg as { content: unknown[] }).content
      : [];
    let chars = 0;
    for (const b of content) {
      const block = b as {
        type?: string;
        text?: string;
        thinking?: string;
        input?: unknown;
      };
      if (block.type === "text") chars += block.text?.length ?? 0;
      else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
      else if (block.type === "toolCall")
        chars += JSON.stringify(block.input ?? {}).length;
    }
    const now = Date.now();
    const w = tpsWindowRef.current;
    if (!w) {
      tpsWindowRef.current = { start: now, chars };
      return;
    }
    const elapsed = (now - w.start) / 1000;
    if (elapsed >= 0.5 && chars > w.chars) {
      setTps((chars - w.chars) / 4 / elapsed);
      tpsWindowRef.current = { start: now, chars };
    }
  }, [streamState.streamingMessage]);

  // Shared props for both the bottom composer and inline edit-from-here.
  // Big-action scroll intents (the ONLY places that programmatically scroll):
  // send → smooth scroll to bottom (runStart semantics);
  // session load → instant jump (initialize semantics, effect above).
  // Edit-resend deliberately plants NO intent: the user is reading at the
  // edited message; the viewport must not move (ChatGPT edit semantics).
  const sendWithIntent = useCallback(
    (...args: Parameters<typeof handleSend>) => {
      autoScroll.scrollToBottom("smooth");
      return handleSend(...args);
    },
    [autoScroll.scrollToBottom, handleSend]
  );
  const editResendAnchored = useCallback(
    (...args: Parameters<typeof handleEditResend>) => {
      // No scroll intent — the viewport must not move now. The anchor
      // effect above repositions once the rewound transcript arrives.
      pendingResendAnchorRef.current = true;
      return handleEditResend(...args);
    },
    [handleEditResend]
  );
  const chatInputProps: ChatInputProps = {
    onSend: sendWithIntent,
    onAbort: handleAbort,
    onSteer: agentRunning ? handleSteer : undefined,
    onFollowUp: agentRunning ? handleFollowUp : undefined,
    onPromptWithStreamingBehavior: agentRunning
      ? handlePromptWithStreamingBehavior
      : undefined,
    isStreaming: sessionBusy,
    model: displayModelValue,
    isAutoModelSelection,
    modelNames,
    modelList,
    modelError,
    modelScopeWarnings,
    onModelChange: handleModelChange,
    onModelOpen: () => {
      void loadModels();
    },
    modelRoles,
    fastMode,
    onRoleChange: handleRoleChange,
    onCompact: session || isNew ? handleCompact : undefined,
    onAbortCompaction: handleAbortCompaction,
    isCompacting,
    compactError,
    compactResult,
    toolPreset,
    onToolPresetChange: undefined,
    thinkingLevel,
    onThinkingLevelChange:
      session || isNew ? handleThinkingLevelChange : undefined,
    availableThinkingLevels,
    thinkingLevelMap: currentThinkingLevelMap,
    retryInfo,
    imageSupported,
    contextUsage,
    stats: sessionStats,
    inputHistory,
    onOpenHistorySearch: () => setHistorySearchOpen(true),
    slashCommands,
    slashCommandsLoading,
    onLoadSlashCommands: loadSlashCommands,
    onBuiltinCommand: handleBuiltinSlashCommand,
    soundEnabled,
    onSoundToggle,
    onAudioUnlock: unlockAudio,
    onOpenModelSelector: () => setModelHubOpen(true),
    onOpenTemporaryModelPicker: () => setTemporaryModelPickerOpen(true),
    onToggleThinking: () => setShowThinking((visible) => !visible),
    onDisplayReset: () => {
      // Route through the auto-scroll controller so its pinned state stays
      // consistent with the jump.
      autoScroll.scrollToBottom("instant");
      setDisplayResetKey((key) => key + 1);
    },
    onToggleExpandAllTools: () => setExpandAllTools((expanded) => !expanded),
    onToggleToolsHidden: () => setToolsHidden((hidden) => !hidden),
    onOpenAgentHub: () => setAgentHubOpen(true),
  };

  const approvalBar =
    interactionDialog && supportsInlineApproval(interactionDialog) ? (
      <ApprovalBar request={interactionDialog} onRespond={respondInteraction} />
    ) : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      {...chatInputProps}
      draftKey={
        session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)
      }
      cwd={messageCwd}
    />
  );
  const modelHub = (
    <ModelHub
      open={modelHubOpen}
      onClose={() => setModelHubOpen(false)}
      sessionId={sessionIdRef.current}
      modelList={modelList}
      currentModel={currentModel}
      modelRoles={modelRoles}
      modelThinkingLevelMaps={modelThinkingLevelMaps}
      currentModeId={activeModes[0] ?? null}
      onModelChanged={handleModelChange}
    />
  );
  const temporaryModelPicker = (
    <TemporaryModelPicker
      open={temporaryModelPickerOpen}
      onClose={() => setTemporaryModelPickerOpen(false)}
      currentModel={currentModel}
      modelList={modelList.map((model) => ({
        provider: model.provider,
        modelId: model.id,
        name: model.name,
      }))}
      onSelect={({ provider, modelId }) => {
        if (!currentModel) return;
        setPendingRestoreModel(currentModel);
        void handleModelChange(provider, modelId);
      }}
    />
  );

  const renderEditInput = useCallback(
    (
      entryId: string,
      content: string,
      onCancel: () => void,
      onSubmit?: (
        text: string,
        images?: Array<{ data: string; mimeType: string }>
      ) => void,
      collapsed?: boolean
    ) => (
      <ChatInput
        {...chatInputProps}
        initialValue={content}
        cwd={messageCwd}
        collapsed={collapsed}
        onSend={(text, images) => {
          onSubmit?.(
            text,
            images?.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          );
        }}
        onCancelEdit={onCancel}
      />
    ),
    [chatInputProps, messageCwd]
  );

  const chatFooterElement = (
    <ChatFooterBar
      t={t}
      isStreaming={sessionBusy}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      cwd={messageCwd}
      tps={liveTps ?? tps}
      activeModes={activeModes}
      fastMode={fastMode}
      onRoleChange={handleRoleChange}
      hoveredMeta={hoveredMeta}
    />
  );

  if (loading) {
    // Prefer the human title, fall back to the short id, then the cwd. All
    // three may be absent on the very first render (session prop hydrating);
    // in that case the label alone carries the state.
    const sessionLabel = session?.name?.trim() || (session?.id ? session.id.slice(0, 8) : null);
    const subtitle = sessionLabel ?? messageCwd ?? undefined;
    return (
      <AppLoading
        label={t("chat.loadingSession")}
        subtitle={subtitle}
      />
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-[var(--destructive)]">
        <TriangleAlert size={14} className="shrink-0" />
        {error}
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 flex min-w-0 flex-col overflow-hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {branchSelectorOpen && (
        <UserMessageSelector
          messages={messages}
          entryIds={entryIds}
          onClose={() => setBranchSelectorOpen(false)}
          onSelectEntry={(entryId) => {
            setBranchSelectorOpen(false);
            void handleFork(entryId);
          }}
        />
      )}
      {agentHubOpen && (
        <AgentHub
          cwd={messageCwd ?? ""}
          sessionId={sessionIdRef.current}
          onClose={() => setAgentHubOpen(false)}
        />
      )}
      {isDragOver && !sessionBusy && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[var(--accent)]/6 backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] animate-[drop-ripple_2.4s_ease-out_infinite_backwards] rounded-full border-[1.5px] border-solid border-[var(--accent)]/50"
                style={{
                  transformOrigin: "center",
                  animationDelay: `${delay}s`,
                }}
              />
            ))}
          </div>
          <svg
            width="280"
            height="280"
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_color-mix(in_srgb,var(--accent)_18%,transparent)]"
          >
            <rect
              x="28"
              y="44"
              width="84"
              height="60"
              rx="8"
              fill="color-mix(in srgb, var(--accent) 8%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 50%, transparent)"
              strokeWidth="1.8"
            />
            <path
              d="M36 100 L54 72 L68 88 L80 74 L104 100Z"
              fill="color-mix(in srgb, var(--accent) 16%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 40%, transparent)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <circle
              cx="96"
              cy="58"
              r="8"
              fill="color-mix(in srgb, var(--accent) 22%, transparent)"
              stroke="color-mix(in srgb, var(--accent) 55%, transparent)"
              strokeWidth="1.6"
            />
            <g
              stroke="color-mix(in srgb, var(--accent) 45%, transparent)"
              strokeWidth="1.4"
              strokeLinecap="round"
            >
              <line x1="96" y1="46" x2="96" y2="43" />
              <line x1="96" y1="70" x2="96" y2="73" />
              <line x1="84" y1="58" x2="81" y2="58" />
              <line x1="108" y1="58" x2="111" y2="58" />
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4" />
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6" />
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4" />
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6" />
            </g>
          </svg>
        </div>
      )}

      {interactionDialog && planReviewSchema(interactionDialog) ? (
        <PlanReviewOverlay
          plan={planReviewDefault(planReviewSchema(interactionDialog)!, "plan")}
          feedback={planReviewDefault(
            planReviewSchema(interactionDialog)!,
            "feedback"
          )}
          choices={planReviewChoices(planReviewSchema(interactionDialog)!)}
          cwd={cwd ?? undefined}
          onRespond={(response) =>
            respondInteraction(interactionDialog, response)
          }
        />
      ) : (
        interactionDialog &&
        !supportsInlineApproval(interactionDialog) && (
          <InteractionDialog
            request={interactionDialog}
            onRespond={respondInteraction}
          />
        )
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-[820px]">
            {/* Brand: logo centered, version below */}
            <div
              className="mb-3"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                fontFamily: "var(--font-mono)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  lineHeight: 1.4,
                }}
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 2455 2449"
                  fill="currentColor"
                  style={{ color: "var(--text)", flexShrink: 0 }}
                  aria-hidden="true"
                >
                  <path d="M2455 777.771H2045.99V2122.09L1381.8 2449V777.771H1079.65V1937.72L415.462 1553.45V777.771H0V0H2455V777.771Z" />
                </svg>
                <span
                  style={{
                    fontSize: 22,
                    color: "var(--text)",
                    fontWeight: 700,
                    letterSpacing: 0,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  OMP Web
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                title="Versions reported by the local omp-web service"
              >
                {serviceVersions ? (
                  <>
                    <span>
                      omp{" "}
                      <span style={{ color: "var(--text)" }}>
                        {serviceVersions.cli
                          ? `v${serviceVersions.cli}`
                          : "unavailable"}
                      </span>
                    </span>
                    {serviceVersions.pi && (
                      <>
                        <span style={{ opacity: 0.6 }}>·</span>
                        <span>
                          pi{" "}
                          <span style={{ color: "var(--text)" }}>
                            v{serviceVersions.pi}
                          </span>
                        </span>
                      </>
                    )}
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>
                      ext{" "}
                      <span style={{ color: "var(--text)" }}>
                        {serviceVersions.omp
                          ? `v${serviceVersions.omp}`
                          : "unavailable"}
                      </span>
                    </span>
                  </>
                ) : versionsUnavailable ? (
                  <span>Versions unavailable</span>
                ) : (
                  <Shimmer
                    as="span"
                    className="text-[11px]"
                    duration={2.5}
                    spread={1}
                  >
                    Loading versions…
                  </Shimmer>
                )}
              </div>
            </div>

            {/* Project switcher — input top-left entry point (aligned with
                the input's 16px left padding; hidden once the chat has content) */}
            <div style={{ marginBottom: 10, paddingLeft: 16 }}>
              <ProjectSwitcher
                cwdName={cwdName ?? null}
                cwd={cwd ?? null}
                onSelect={onCwdChange ?? (() => {})}
              />
            </div>

            <NoticeShelf notices={notices} align="right" />
            <div className="relative">
              <AnimatePresence initial={false}>{approvalBar}</AnimatePresence>
              {chatInputElement}
              {chatFooterElement}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative flex min-w-0 flex-1 overflow-hidden">
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 0,
                right: CHAT_MINIMAP_WIDTH,
                zIndex: 40,
                padding: `0 ${CHAT_COLUMN_PADDING}px`,
                pointerEvents: "none",
              }}
            >
              <div style={{ maxWidth: 820, margin: "0 auto" }}>
                <NoticeShelf notices={notices} floating align="right" />
              </div>
            </div>
            <div
              ref={mergedScrollRef}
              className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-4"
              style={{ overflowAnchor: "none" }}
            >
              <div
                ref={autoScroll.contentRef}
                style={{ minWidth: 0, padding: `0 ${CHAT_COLUMN_PADDING}px` }}
              >
                <div
                  key={displayResetKey}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    maxWidth: 820,
                    margin: "0 auto",
                  }}
                >
                  {(() => {
                    const toolResultsMap = new Map<string, ToolResultMessage>();
                    for (const msg of messages) {
                      if (msg.role === "toolResult") {
                        toolResultsMap.set(
                          (msg as ToolResultMessage).toolCallId,
                          msg as ToolResultMessage
                        );
                      }
                    }

                    let lastUserIdx = -1;
                    for (let i = messages.length - 1; i >= 0; i--) {
                      if (messages[i].role === "user") {
                        lastUserIdx = i;
                        break;
                      }
                    }
                    // Anchor for live-tail detection: the last user message, or a
                    // compaction summary when compaction has replaced it mid-turn.
                    // Computed independently from lastUserIdx (which is kept for the
                    // scroll-to-user ref) because a compaction summary can sit after
                    // the last user message and anchor the still-streaming segment.
                    let lastAnchorIdx = -1;
                    for (let i = messages.length - 1; i >= 0; i--) {
                      if (isGroupAnchor(messages[i])) {
                        lastAnchorIdx = i;
                        break;
                      }
                    }

                    const visibleRefIndexByMessage = new Map<number, number>();
                    let refIdx = 0;
                    messages.forEach((msg, idx) => {
                      if (msg.role === "user" || msg.role === "assistant") {
                        visibleRefIndexByMessage.set(idx, refIdx++);
                      }
                    });

                    const attachVisibleRef =
                      (idx: number, refIndex: number) =>
                      (el: HTMLDivElement | null) => {
                        messageRefs.current[refIndex] = el;
                        if (idx === lastUserIdx) {
                          (
                            lastUserMsgRef as { current: HTMLDivElement | null }
                          ).current = el;
                        }
                      };

                    const renderMessage = (
                      idx: number,
                      options: {
                        attachRef?: boolean;
                        keyPrefix?: string;
                        messageOverride?: AgentMessage;
                        showTimestamp?: boolean;
                        hideFork?: boolean;
                      } = {}
                    ): ReactNode => {
                      const msg = options.messageOverride ?? messages[idx];
                      const prevAssistantEntryId =
                        msg.role === "user" &&
                        idx > 0 &&
                        messages[idx - 1].role === "assistant"
                          ? paddedEntryIds[idx - 1]
                          : undefined;
                      const isVisible =
                        msg.role === "user" || msg.role === "assistant";
                      const currentRefIdx = visibleRefIndexByMessage.get(idx);
                      const keyPrefix = options.keyPrefix ?? "message";
                      let showTimestamp = false;
                      if (msg.role === "assistant") {
                        showTimestamp = true;
                        for (let j = idx + 1; j < messages.length; j++) {
                          const r = messages[j].role;
                          if (r === "user") break;
                          if (r === "assistant") {
                            showTimestamp = false;
                            break;
                          }
                        }
                        // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                        if (
                          showTimestamp &&
                          streamState.isStreaming &&
                          idx === messages.length - 1
                        ) {
                          showTimestamp = false;
                        }
                      }
                      if (options.showTimestamp !== undefined)
                        showTimestamp = options.showTimestamp;
                      const isStreamingTail =
                        streamState.isStreaming &&
                        msg.role === "assistant" &&
                        idx === messages.length - 1;
                      const view = (
                        <MessageView
                          key={`${keyPrefix}-view-${idx}`}
                          message={msg}
                          toolResults={toolResultsMap}
                          modelNames={modelNames}
                          cwd={messageCwd}
                          onOpenFile={onOpenFile}
                          entryId={paddedEntryIds[idx]}
                          onFork={
                            options.hideFork ||
                            sessionBusy ||
                            isNew ||
                            (idx === 0 && msg.role === "user")
                              ? undefined
                              : handleFork
                          }
                          forking={forkingEntryId === paddedEntryIds[idx]}
                          onNavigate={sessionBusy ? undefined : handleNavigate}
                          prevAssistantEntryId={
                            sessionBusy ? undefined : prevAssistantEntryId
                          }
                          onEditResend={editResendAnchored}
                          editInputRender={renderEditInput}
                          onEditContent={handleEditContent}
                          showTimestamp={showTimestamp}
                          prevTimestamp={
                            idx > 0
                              ? (
                                  messages[idx - 1] as AgentMessage & {
                                    timestamp?: number;
                                  }
                                ).timestamp
                              : undefined
                          }
                          sessionId={
                            session?.id ?? sessionIdRef.current ?? undefined
                          }
                          hideFork={options.hideFork}
                          showThinking={showThinking}
                          expandAllTools={expandAllTools}
                          toolsHidden={toolsHidden}
                          isStreaming={isStreamingTail}
                          onHoverMeta={handleHoverMeta}
                        />
                      );
                      if (
                        !isVisible ||
                        options.attachRef === false ||
                        currentRefIdx === undefined
                      )
                        return view;
                      return (
                        <div
                          data-omp-mount
                          key={`${keyPrefix}-${idx}`}
                          ref={attachVisibleRef(idx, currentRefIdx)}
                          data-entry-id={paddedEntryIds[idx]}
                        >
                          {view}
                        </div>
                      );
                    };

                    const rendered: ReactNode[] = [];
                    const renderCompactionBoundary = (
                      idx: number
                    ): ReactNode => {
                      if (
                        !compactionBoundary ||
                        idx !== compactionBoundary.messageIndex
                      )
                        return null;
                      const label = new Date(
                        compactionBoundary.at
                      ).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <div
                          key={`compaction-boundary-${compactionBoundary.at}`}
                          className="my-4 flex items-center gap-3 text-[10px] font-medium tracking-wide text-[var(--text-dim)] uppercase"
                        >
                          <div className="h-px flex-1 bg-[var(--border)]" />
                          <span>Context compacted at {label}</span>
                          <div className="h-px flex-1 bg-[var(--border)]" />
                        </div>
                      );
                    };
                    for (let idx = 0; idx < messages.length;) {
                      const msg = messages[idx];
                      if (!isGroupAnchor(msg)) {
                        const boundary = renderCompactionBoundary(idx);
                        if (boundary) rendered.push(boundary);
                        rendered.push(renderMessage(idx));
                        idx += 1;
                        continue;
                      }

                      const userIdx = idx;
                      let endIdx = userIdx + 1;
                      while (
                        endIdx < messages.length &&
                        !isGroupAnchor(messages[endIdx])
                      )
                        endIdx += 1;

                      const finalAssistantIdx = findFinalAssistantIndex(
                        messages,
                        userIdx,
                        endIdx
                      );

                      if (finalAssistantIdx === -1) {
                        for (
                          let renderIdx = userIdx;
                          renderIdx < endIdx;
                          renderIdx++
                        ) {
                          rendered.push(renderMessage(renderIdx));
                        }
                        idx = endIdx;
                        continue;
                      }

                      // Inline the LAST turn even after it completes.
                      // Wrapping it in ProcessDetailsGroup adds a header
                      // row + a collapsed fold at the exact moment
                      // streaming ends, which shows up as a visible
                      // layout jump ("样式跳了一下"). Wrap only turns
                      // that have been superseded by a newer user
                      // message — the fold happens on a user action, not
                      // implicit on completion.
                      const isTailTurn =
                        endIdx === messages.length &&
                        userIdx === lastAnchorIdx;
                      if (isTailTurn) {
                        for (
                          let renderIdx = userIdx;
                          renderIdx < endIdx;
                          renderIdx++
                        ) {
                          rendered.push(renderMessage(renderIdx));
                        }
                        idx = endIdx;
                        continue;
                      }

                      const boundary = renderCompactionBoundary(userIdx);
                      if (boundary) rendered.push(boundary);
                      rendered.push(renderMessage(userIdx));

                      // Overall turn duration: from this user message to the final
                      // assistant reply (includes all thinking + tool execution).
                      const userTs = (
                        messages[userIdx] as AgentMessage & {
                          timestamp?: string | number;
                        }
                      ).timestamp;
                      const finalTs = (
                        messages[finalAssistantIdx] as AgentMessage & {
                          timestamp?: string | number;
                        }
                      ).timestamp;
                      let groupDuration: number | undefined;
                      if (userTs && finalTs) {
                        const start =
                          typeof userTs === "number"
                            ? userTs
                            : Date.parse(userTs);
                        const end =
                          typeof finalTs === "number"
                            ? finalTs
                            : Date.parse(finalTs);
                        if (
                          Number.isFinite(start) &&
                          Number.isFinite(end) &&
                          end >= start
                        ) {
                          groupDuration = Math.round((end - start) / 1000);
                        }
                      }

                      const processIndices: number[] = [];
                      for (
                        let processIdx = userIdx + 1;
                        processIdx < finalAssistantIdx;
                        processIdx++
                      ) {
                        processIndices.push(processIdx);
                      }
                      const visibleProcessIndices = processIndices.filter(
                        (processIdx) =>
                          hasDisplayableProcessMessage(messages[processIdx])
                      );
                      const finalAssistant = messages[
                        finalAssistantIdx
                      ] as AssistantMessage;
                      const finalSplit =
                        splitFinalAssistantBlocks(finalAssistant);
                      const finalProcessMessage =
                        finalSplit.processBlocks.length > 0
                          ? withAssistantBlocks(
                              finalAssistant,
                              finalSplit.processBlocks,
                              { omitUsage: true }
                            )
                          : null;
                      const finalAnswerMessage =
                        finalSplit.answerBlocks.length > 0 ||
                        getAssistantErrorMessage(finalAssistant)
                          ? withAssistantBlocks(
                              finalAssistant,
                              finalSplit.answerBlocks
                            )
                          : null;

                      const processCount =
                        visibleProcessIndices.length +
                        (finalProcessMessage ? 1 : 0);
                      if (processCount > 0) {
                        const processRefIdx =
                          visibleProcessIndices
                            .map((processIdx) =>
                              visibleRefIndexByMessage.get(processIdx)
                            )
                            .find(
                              (value): value is number =>
                                typeof value === "number"
                            ) ??
                          (finalAnswerMessage
                            ? undefined
                            : visibleRefIndexByMessage.get(finalAssistantIdx));
                        const processGroup = (
                          <ProcessDetailsGroup
                            messageCount={processCount}
                            t={t}
                            toolCallCount={
                              countToolCalls(messages, visibleProcessIndices) +
                              countToolCallBlocks(finalSplit.processBlocks)
                            }
                            durationSec={groupDuration}
                            defaultExpanded={!finalAnswerMessage || userIdx === lastAnchorIdx}
                          >
                            {visibleProcessIndices.map((processIdx) =>
                              renderMessage(processIdx, {
                                attachRef: false,
                                keyPrefix: "process",
                                hideFork: true,
                              })
                            )}
                            {finalProcessMessage &&
                              renderMessage(finalAssistantIdx, {
                                attachRef: false,
                                keyPrefix: "process-final",
                                messageOverride: finalProcessMessage,
                                showTimestamp: false,
                                hideFork: true,
                              })}
                          </ProcessDetailsGroup>
                        );
                        rendered.push(
                          <div
                            key={`process-group-${userIdx}-${finalAssistantIdx}`}
                            ref={
                              processRefIdx === undefined
                                ? undefined
                                : (el) => {
                                    messageRefs.current[processRefIdx] = el;
                                  }
                            }
                          >
                            {processGroup}
                          </div>
                        );
                      }

                      if (finalAnswerMessage) {
                        rendered.push(
                          renderMessage(finalAssistantIdx, {
                            messageOverride: finalAnswerMessage,
                          })
                        );
                      }
                      for (
                        let renderIdx = finalAssistantIdx + 1;
                        renderIdx < endIdx;
                        renderIdx++
                      ) {
                        rendered.push(renderMessage(renderIdx));
                      }
                      idx = endIdx;
                    }
                    const { startIndex, hasMore } = getVisibleRenderWindow(
                      rendered.length,
                      visibleCount
                    );
                    // Keep the imperative refs in sync so the scroll
                    // listener can bail out when there's nothing more to
                    // load / a load is already in flight.
                    hasMoreRef.current = hasMore;
                    return (
                      <>
                        {hasMore && (
                          <div
                            ref={sentinelRef}
                            role="status"
                            aria-live="polite"
                            className="mx-auto my-1 flex items-center justify-center gap-2 py-2 text-[12px] text-[var(--text-muted)]"
                          >
                            <span
                              className="size-1.5 animate-pulse rounded-full bg-current"
                              aria-hidden="true"
                            />
                            <Shimmer
                              className="text-[12px]"
                              duration={2.5}
                              spread={1}
                            >
                              {t("chat.loadEarlier", { count: startIndex })}
                            </Shimmer>
                          </div>
                        )}
                        {rendered.slice(startIndex)}
                      </>
                    );
                  })()}
                  {/* The streaming assistant message is already the last
                      entry in \`messages\`; MessageView receives an
                      \`isStreaming\` hint via the block-level check inside.
                      Separately rendering \`streamState.streamingMessage\`
                      here duplicated the live turn on screen. */}

                  {agentRunning &&
                    !streamState.streamingMessage &&
                    agentPhase && (
                      <div
                        data-omp-mount
                        className="text-text-muted flex items-center gap-2 py-2 text-[13px]"
                        role="status"
                        aria-live="polite"
                      >
                        <span
                          className="size-1.5 animate-pulse rounded-full bg-current"
                          aria-hidden="true"
                        />
                        <Shimmer
                          className="text-[13px]"
                          duration={2.5}
                          spread={1}
                        >
                          {phaseLabel(agentPhase, t) ?? ""}
                        </Shimmer>
                      </div>
                    )}

                  {bashRunning && !pendingBash && (
                    <div className="py-2 text-[13px]">
                      <Shimmer
                        className="text-[13px]"
                        duration={2.5}
                        spread={1}
                      >
                        {t("chat.runningCommand")}
                      </Shimmer>
                    </div>
                  )}

                  {pendingBash && (
                    <MessageView
                      message={
                        {
                          role: "bashExecution",
                          command: pendingBash.command,
                          output: "",
                          excludeFromContext: pendingBash.excludeFromContext,
                        } as BashExecutionMessage
                      }
                      sessionId={
                        session?.id ?? sessionIdRef.current ?? undefined
                      }
                      onHoverMeta={handleHoverMeta}
                    />
                  )}

                  {/* Viewport reservation. Padding the tail with ~40% of
                      the visible height means the actively-streaming reply
                      renders in the UPPER half of the viewport instead of
                      pressed against the input frame. Matches Continue.dev
                      / ChatGPT / Cursor. Auto-follow scrolls into this
                      pad, so no extra scroll math needed. */}
                  <div aria-hidden="true" className="min-h-[40vh]" />
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>
            {!pinnedToBottom && (
              <button
                type="button"
                aria-label={t("chat.jumpToBottom")}
                onClick={() => autoScroll.scrollToBottom("smooth")}
                className="absolute bottom-3 left-1/2 z-40 flex size-7 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-muted)] shadow-md transition-colors duration-100 hover:text-[var(--text)]"
              >
                <ChevronDown size={14} />
              </button>
            )}
            {minimapOpen && (
              <ChatMinimap
                messages={messages}
                streamingMessage={streamState.streamingMessage}
                scrollContainer={scrollContainerRef}
                messageRefs={messageRefs}
                onRevealHistory={revealHistoryForMinimap}
                onNavigateStart={autoScroll.release}
              />
            )}
          </div>

          <div className="relative">
            <AnimatePresence initial={false}>{approvalBar}</AnimatePresence>
            {chatInputElement}
            {chatFooterElement}
          </div>
        </>
      )}
      {modelHub}
      {temporaryModelPicker}
      {historySearchOpen && (
        <HistorySearchDialog
          items={inputHistory}
          onClose={() => setHistorySearchOpen(false)}
          onSelect={(prompt) => {
            chatInputRef?.current?.insertIfEmpty(prompt);
            setHistorySearchOpen(false);
          }}
        />
      )}
    </div>
  );
}


function NoticeShelf({
  notices,
  floating = false,
  align = "left",
}: {
  notices: NoticeItem[];
  floating?: boolean;
  align?: "left" | "right";
}) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color =
          notice.type === "error"
            ? "#ef4444"
            : notice.type === "warning"
              ? "#d97706"
              : notice.type === "success"
                ? "#10b981"
                : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 60,
              height: 60,
              maxHeight: 60,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: 14,
              border:
                "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating
                ? "0 1px 2px var(--vscode-widget-shadow, rgba(15,23,42,0.05)), 0 10px 28px -14px var(--vscode-widget-shadow, rgba(15,23,42,0.24))"
                : "0 1px 2px var(--vscode-widget-shadow, rgba(15,23,42,0.04)), 0 8px 24px -12px var(--vscode-widget-shadow, rgba(15,23,42,0.10))",
              fontSize: 18,
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                padding: "14px 0",
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

