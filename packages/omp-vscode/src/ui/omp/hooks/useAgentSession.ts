"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import type {
  AgentMessage,
  AssistantMessage,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { getToolNamesForPreset } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { acpRequest, hostCall } from "../../bridge";
import type {
  AcpCapabilitySnapshot,
  AcpElicitationRequest,
  AcpPermissionRequest,
  AcpSessionState,
} from "../../../core/acp/protocol";
import type {
  ContentBlock,
  ElicitationContentValue,
} from "@agentclientprotocol/sdk";
import type { ModelsResult } from "../../../core/host/protocol";

import { useSessionStore } from "@/state/session-store";
import { useTranscriptStore } from "@/state/transcript-store";
import { useToolsStore } from "@/state/tools-store";
import { usePermissionsStore } from "@/state/permissions-store";
import { useSubagentsStore } from "@/state/subagents-store";
import { installAcpEventBridge } from "@/transport/acp-events";
import { messageText } from "@/domain/acp-message-adapter";
import {
  useCurrentSessionId,
  useSessionData,
  useSessionLoading,
  useSessionError,
  useActiveLeafId,
} from "@/hooks/useCurrentSession";
import {
  useMessages,
  usePendingUserMessage,
  useEntryIds,
  useStreamState,
} from "@/hooks/useTranscript";
import { useToolPreset } from "@/hooks/useTools";
import { useInteractionDialog } from "@/hooks/usePermissions";

// SessionData is now owned by the session-store; re-export the type so
// existing consumers of `useAgentSession` continue to see it here.
export type { SessionData } from "@/state/session-store";

export type NoticeType = "info" | "success" | "warning" | "error";
export type NoticeItem = {
  id: string;
  message: string;
  type: NoticeType;
  exiting?: boolean;
};
type NoticeState = { visible: NoticeItem[]; pending: NoticeItem[] };
type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "mark_oldest_exiting" }
  | { type: "remove"; id: string };

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}

export interface SlashCommandInfo {
  name: string;
  description?: string;
  inputHint?: string;
  aliases?: string[];
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  { handled: false } | { handled: true; message?: string; error?: string };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
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
  onOpenSettings?: () => void;
  /** Opens the webview-native full session picker for the local `/resume` command. */
  onOpenResumeDialog?: () => void;
  setToolPreset?: (preset: "none" | "default" | "full") => void;
}

export type ThinkingLevelOption =
  "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}
export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
};
type InteractionDialog = AcpPermissionRequest | AcpElicitationRequest;

// The historical StreamAction shape is preserved so the facade's returned
// `dispatch` still accepts the same messages any legacy caller might send.
// External code does not use `dispatch` today (see grep), so this shim is
// only exercised by the facade itself.
type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

const LAST_MODEL_KEY = "omp.lastModel";
const MAX_NOTICES = 5;
const NOTICE_VISIBLE_MS = 5000;
const NOTICE_EXIT_ANIMATION_MS = 180;

function createNoticeId(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function readLastModel(): SelectedModel | null {
  try {
    const raw = localStorage.getItem(LAST_MODEL_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("provider" in value) ||
      !("modelId" in value)
    )
      return null;
    return typeof value.provider === "string" &&
      typeof value.modelId === "string"
      ? { provider: value.provider, modelId: value.modelId }
      : null;
  } catch {
    return null;
  }
}
function saveLastModel(provider: string, modelId: string): void {
  try {
    localStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ provider, modelId }));
  } catch {
    /* storage is optional */
  }
}
function markOldestNoticeExiting(notices: NoticeItem[]): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting);
  return index < 0
    ? notices
    : notices.map((notice, i) =>
        i === index ? { ...notice, exiting: true } : notice
      );
}
function fillPendingNotices(
  visible: NoticeItem[],
  pending: NoticeItem[]
): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    if (!next) break;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting))
    nextVisible = markOldestNoticeExiting(nextVisible);
  return { visible: nextVisible, pending: nextPending };
}
function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  if (action.type === "add") {
    if (
      state.visible.some((notice) => notice.id === action.notice.id) ||
      state.pending.some((notice) => notice.id === action.notice.id)
    )
      return state;
    if (
      state.visible.some((notice) => notice.exiting) ||
      state.visible.length >= MAX_NOTICES
    ) {
      return {
        visible: state.visible.some((notice) => notice.exiting)
          ? state.visible
          : markOldestNoticeExiting(state.visible),
        pending: [...state.pending, action.notice],
      };
    }
    return { ...state, visible: [...state.visible, action.notice] };
  }
  if (action.type === "mark_oldest_exiting")
    return { ...state, visible: markOldestNoticeExiting(state.visible) };
  if (action.type === "remove")
    return fillPendingNotices(
      state.visible.filter((notice) => notice.id !== action.id),
      state.pending
    );
  return state;
}
function parseModel(value: string | undefined): SelectedModel | null {
  if (!value) return null;
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1
    ? {
        provider: value.slice(0, separator),
        modelId: value.slice(separator + 1),
      }
    : null;
}
function responseSessionId(response: unknown): string | null {
  if (
    !response ||
    typeof response !== "object" ||
    !("sessionId" in response) ||
    typeof response.sessionId !== "string"
  )
    return null;
  return response.sessionId;
}
function activeModesFromSnapshot(snapshot: AcpSessionState | null): string[] {
  if (!snapshot || !("_meta" in snapshot)) return [];
  const meta: unknown = snapshot._meta;
  if (
    !meta ||
    typeof meta !== "object" ||
    !("activeModes" in meta) ||
    !Array.isArray(meta.activeModes)
  )
    return [];
  return meta.activeModes.filter(
    (mode): mode is string => typeof mode === "string"
  );
}
function contentFor(message: string, images?: AttachedImage[]): ContentBlock[] {
  return [
    { type: "text", text: message },
    ...(images ?? []).map(
      (image) =>
        ({
          type: "image",
          data: image.data,
          mimeType: image.mimeType,
        }) as unknown as ContentBlock
    ),
  ];
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session,
    newSessionCwd,
    onAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    onBranchDataChange,
    onOpenSettings,
    onOpenResumeDialog,
  } = opts;
  const isNew = session === null && newSessionCwd !== null;

  // ---- Store-backed slices (session/transcript/tools/permissions/subagents).
  // The facade reads via narrow selector hooks and writes via each store's
  // named methods; ACP-driven mutations flow through
  // `transport/acp-events.ts` (installed once below).
  const initRef = useRef(false);
  if (!initRef.current) {
    initRef.current = true;
    // Synchronously seed the store so the very first render matches the
    // previous `useState(session !== null)` behavior: loading=true when a
    // session is provided, false for a blank chat.
    const s = useSessionStore.getState();
    s.setCurrent(session?.id ?? null, isNew);
    s.setLoading(session !== null);
    s.setError(null);
    // Stores are module-level singletons; reset on fresh mount so a
    // previous ChatWindow's state doesn't leak into this one.
    useTranscriptStore.getState().resetAll();
    useToolsStore.getState().reset();
    usePermissionsStore.getState().reset();
    useSubagentsStore.getState().reset();
  }
  const data = useSessionData();
  const loading = useSessionLoading();
  const error = useSessionError();
  const activeLeafId = useActiveLeafId();
  const messages = useMessages();
  const pendingUserMessage = usePendingUserMessage();
  const entryIds = useEntryIds();
  const streamState = useStreamState();
  const currentSessionId = useCurrentSessionId();
  const toolPreset = useToolPreset();
  const interactionDialog = useInteractionDialog();

  // Track messages through a ref for the ACP callback / turn-end backfill —
  // the store IS the source of truth, but a ref sidesteps closure staleness
  // in nested callbacks scheduled outside React's render cycle.
  const messagesRef = useRef<AgentMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Dispatch shim — preserves the return-shape signature (`dispatch({type})`)
  // for any legacy caller. Internally routes to the transcript-store's
  // stream actions.
  const dispatch = useCallback((action: StreamAction) => {
    const t = useTranscriptStore.getState();
    if (action.type === "start") t.streamStart();
    else if (action.type === "update") t.streamUpdate(action.message);
    else if (action.type === "end") t.streamEnd();
    else if (action.type === "reset") t.streamReset();
  }, []);
  // Store-method proxies — the previous return exposed these as
  // per-instance setState fns. Wrapping in useCallback preserves reference
  // stability so downstream memoization doesn't invalidate on every render.
  const setData = useCallback(
    (
      next:
        | ReturnType<typeof useSessionData>
        | ((
            current: ReturnType<typeof useSessionData>
          ) => ReturnType<typeof useSessionData>)
    ) => useSessionStore.getState().setData(next),
    []
  );
  const setActiveLeafId = useCallback(
    (id: string | null) => useSessionStore.getState().setActiveLeafId(id),
    []
  );
  const setMessages = useCallback(
    (
      next: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[])
    ) => useTranscriptStore.getState().setMessages(next),
    []
  );

  // ---- Facade-owned state (concerns not yet extracted). ------------------
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelRoles, setModelRoles] = useState<
    Record<
      string,
      { provider: string; modelId: string; thinkingLevel?: string }
    >
  >({});
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<
    Record<string, string[]>
  >({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<
    Record<string, Record<string, string | null>>
  >({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(
    null
  );
  const [newSessionDefaultModel, setNewSessionDefaultModel] =
    useState<SelectedModel | null>(null);
  const [thinkingLevel, setThinkingLevel] =
    useState<ThinkingLevelOption>("auto");
  const [contextUsage, setContextUsage] = useState<{
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  } | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(
    null
  );
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [liveTps, setLiveTps] = useState<number | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(true);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, {
    visible: [],
    pending: [],
  });
  const [retryInfo, setRetryInfo] = useState<{
    attempt: number;
    maxAttempts: number;
    errorMessage?: string;
  } | null>(null);
  const [compactionBoundary, setCompactionBoundary] = useState<{
    at: number;
    messageIndex: number;
  } | null>(null);
  const [sessionStatsOverride, setSessionStatsOverride] =
    useState<SessionStatsInfo | null>(null);
  const [capabilities, setCapabilities] =
    useState<AcpCapabilitySnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<AcpSessionState | null>(null);
  const [pendingRestoreModel, setPendingRestoreModel] =
    useState<SelectedModel | null>(null);
  // Optimistic model override: shows immediately on picker click and clears
  // once the ACP snapshot catches up. Without it the picker looks unresponsive
  // while omp round-trips setConfigOption.
  const [optimisticModel, setOptimisticModel] = useState<SelectedModel | null>(
    null
  );
  const activeModes = useMemo(
    () => activeModesFromSnapshot(snapshot),
    [snapshot]
  );

  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  // Tracks the session id we've actually LOADED (sessionDetail returned).
  // Distinct from sessionIdRef, which mirrors the current session-in-flight
  // for outbound requests. The load guard checks this so an unloaded session
  // never gets skipped even if sessionIdRef was already set at mount.
  const lastLoadedSessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<null>(null);
  const handleAgentEventRef = useRef<null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const agentRunningRef = useRef(false);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const preCompactUsedRef = useRef<number | null>(null);
  const latestUsedRef = useRef<number | null>(null);
  const sawErrorStopRef = useRef(false);
  const tpsRef = useRef({ chars: 0, startedAt: 0 });
  const restoredTurnRef = useRef<string | null>(null);
  // Commands revision — orthogonal to the message/toolCalls partitions the
  // transcript-store tracks; slashCommands remains a facade-owned concern
  // until its own store extraction.
  const lastAcpCommandsRevRef = useRef(-1);

  const addNotice = useCallback(
    (notice: Omit<NoticeItem, "id"> & { id?: string }) =>
      dispatchNotice({
        type: "add",
        notice: { ...notice, id: notice.id ?? createNoticeId() },
      }),
    []
  );
  const currentModel = useMemo(() => {
    const option = snapshot?.configOptions.find(
      (config) => config.category === "model"
    );
    return parseModel(
      typeof option?.currentValue === "string" ? option.currentValue : undefined
    );
  }, [snapshot]);
  // Once the snapshot's model matches the optimistic pick, drop the override.
  useEffect(() => {
    if (!optimisticModel || !currentModel) return;
    if (
      currentModel.provider === optimisticModel.provider &&
      currentModel.modelId === optimisticModel.modelId
    ) {
      setOptimisticModel(null);
    }
  }, [currentModel, optimisticModel]);
  const displayModel =
    optimisticModel ??
    currentModel ??
    (isNew ? (newSessionModel ?? newSessionDefaultModel) : null) ??
    readLastModel() ??
    modelRoles.default ??
    null;
  const fastMode = Boolean(
    snapshot?.currentMode && /fast/i.test(snapshot.currentMode)
  );
  const bashRunning = false;
  const setToolPresetInternal = useCallback(
    (preset: "none" | "default" | "full") =>
      useToolsStore.getState().setToolPreset(preset),
    []
  );
  const setToolPresetState = opts.setToolPreset ?? setToolPresetInternal;
  const pendingBash = null as {
    command: string;
    excludeFromContext?: boolean;
  } | null;
  const sessionStats = useMemo(() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const tokens = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    };
    let cost = 0,
      userMessages = 0,
      assistantMessages = 0,
      toolResults = 0,
      toolCalls = 0;
    for (const message of messages) {
      if (message.role === "user") userMessages += 1;
      if (message.role === "toolResult") toolResults += 1;
      if (message.role !== "assistant") continue;
      toolCalls += message.content.filter(
        (block) => block.type === "toolCall"
      ).length;
      const usage = message.usage;
      if (!usage) continue;
      tokens.input += usage.input ?? 0;
      tokens.output += usage.output ?? 0;
      tokens.cacheRead += usage.cacheRead ?? 0;
      tokens.cacheWrite += usage.cacheWrite ?? 0;
      cost += usage.cost?.total ?? 0;
    }
    tokens.total =
      tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    // Context ring — canonical, no guessing:
    //   1. Live turn ended → ACP `usage_update`: `used` + `size`, both
    //      guaranteed non-optional numbers per SDK schema. `size` IS the
    //      real model.contextWindow at the agent side.
    //   2. No live usage yet (session loaded from disk, no turn this
    //      process) → walk assistants backward for the newest
    //      contextSnapshot.promptTokens — same field omp's session-stats
    //      reads via `correctedPromptTokens`. Errored/aborted turns don't
    //      write the snapshot so they get skipped naturally.
    //   3. contextWindow at load time comes from modelList lookup, which
    //      is populated from omp's own model registry (same source omp
    //      uses internally). Falls back to null when unknown — the ring
    //      then shows tokens without a percentage rather than fabricating
    //      one against 128k.
    let currentTokens: number | null = null;
    let contextWindow: number | null = null;
    if (contextUsage) {
      currentTokens = contextUsage.tokens;
      contextWindow =
        contextUsage.contextWindow > 0 ? contextUsage.contextWindow : null;
    } else {
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role !== "assistant" || !message.contextSnapshot) continue;
        currentTokens = message.contextSnapshot.promptTokens;
        break;
      }
    }
    if (contextWindow === null) {
      const matched = displayModel
        ? modelList.find(
            (model) =>
              model.provider === displayModel.provider &&
              (model.id === displayModel.modelId ||
                displayModel.modelId.includes(model.id))
          )
        : null;
      contextWindow = matched?.contextWindow ?? null;
    }
    const percent =
      currentTokens !== null && contextWindow !== null && contextWindow > 0
        ? (currentTokens / contextWindow) * 100
        : null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      contextUsage: {
        percent,
        contextWindow: contextWindow ?? 0,
        tokens: currentTokens,
      },
    } satisfies SessionStatsInfo;
  }, [
    contextUsage,
    data?.filePath,
    displayModel,
    messages,
    modelList,
    session?.id,
    session?.name,
    sessionStatsOverride,
  ]);

  const promoteNewSession = useCallback(
    (messageCount = 0, firstMessage = "(no messages)") => {
      const sid = sessionIdRef.current;
      if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current)
        return;
      newSessionPromotedRef.current = true;
      onSessionCreated?.({
        id: sid,
        path: data?.filePath ?? "",
        cwd: newSessionCwd,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        messageCount,
        firstMessage,
      });
    },
    [data?.filePath, isNew, newSessionCwd, onSessionCreated]
  );
  const beginCompaction = useCallback(() => {
    preCompactUsedRef.current = latestUsedRef.current;
    setIsCompacting(true);
    setCompactError(null);
  }, []);

  // ---- Snapshot side effects (message-processing half lives inside the
  // transcript-store; here we handle everything else the snapshot drives).
  const handleSnapshotExtras = useCallback(
    (
      state: AcpSessionState,
      summary: {
        processed: boolean;
        toolCallsChanged: boolean;
        nextMessages: readonly AgentMessage[];
        streamingTail: AssistantMessage | undefined;
      }
    ) => {
      // Foreign session or empty-guard suppressed → still update snapshot
      // (mode/config/plan/etc.) but skip everything else.
      setSnapshot(state);
      if (!summary.processed) return;

      const wasRunning = agentRunningRef.current;
      agentRunningRef.current = state.promptPending;
      setAgentRunning(state.promptPending);
      // Skip activeTools+agentPhase recompute when toolCalls and
      // promptPending both stable — a usage_update carries neither.
      if (summary.toolCallsChanged || wasRunning !== state.promptPending) {
        // `activeTools` was derived by `tools-store.syncFromSnapshot` on
        // this same event — read it back and copy into a fresh array so
        // later store mutations don't leak into the stored `agentPhase`.
        const activeTools = useToolsStore.getState().activeTools;
        setAgentPhase(
          activeTools.length > 0
            ? { kind: "running_tools", tools: [...activeTools] }
            : state.promptPending
              ? { kind: "waiting_model" }
              : null
        );
      }
      // availableCommands is a stable reference across chunk-style
      // updates; only recompute when it actually changed.
      const cmdsChanged =
        state.commandsRevision !== lastAcpCommandsRevRef.current;
      lastAcpCommandsRevRef.current = state.commandsRevision;
      if (cmdsChanged) {
        setSlashCommands(
          state.availableCommands.map((command) => ({
            name: command.name,
            description: command.description,
            inputHint: command.input?.hint,
            source: "prompt",
          }))
        );
        setSlashCommandsLoading(false);
      }
      // ACP `usage_update` maps to `state.usage`. Both `used` and
      // contextWindow are required numbers when the field exists — no
      // defensive nullish/zero filtering needed here. Absence of `usage`
      // means "no usage_update has arrived", not "0 tokens": leave the
      // slot null and let sessionStats fall back to the JSONL snapshot.
      const usage = state.usage;
      const nextUsed = usage ? usage.used : null;
      const preCompactUsed = preCompactUsedRef.current;
      latestUsedRef.current = nextUsed;
      setContextUsage(
        usage
          ? {
              percent: null,
              contextWindow: usage.contextWindow,
              tokens: usage.used,
            }
          : null
      );
      if (
        isCompacting &&
        (state.stopReason ||
          (preCompactUsed !== null &&
            nextUsed !== null &&
            nextUsed < preCompactUsed))
      ) {
        if (
          preCompactUsed !== null &&
          nextUsed !== null &&
          nextUsed < preCompactUsed
        )
          setCompactionBoundary({
            at: Date.now(),
            messageIndex: summary.nextMessages.length,
          });
        preCompactUsedRef.current = null;
        setIsCompacting(false);
      }
      if (state.stopReason === "error") sawErrorStopRef.current = true;
      else if (state.promptPending) {
        sawErrorStopRef.current = false;
        setRetryInfo(null);
      }
      if (state.promptPending) {
        const chars = messageText(summary.streamingTail ?? null);
        const now = performance.now();
        if (
          tpsRef.current.startedAt === 0 ||
          chars.length < tpsRef.current.chars
        )
          tpsRef.current = { chars: chars.length, startedAt: now };
        else if (now > tpsRef.current.startedAt)
          setLiveTps(
            (chars.length - tpsRef.current.chars) /
              ((now - tpsRef.current.startedAt) / 1000)
          );
      } else {
        setLiveTps(null);
        tpsRef.current = { chars: 0, startedAt: 0 };
        if (isCompacting) setIsCompacting(false);
        // Only fire onAgentEnd on the pending→idle transition, not on every
        // idle snapshot. omp publishes snapshots for usage_update / plan /
        // tool_call state that arrive after the agent has settled, and each
        // one would otherwise re-fire onAgentEnd → bump sidebar refreshKey →
        // spam worktreesList/sessionsList every couple of seconds.
        if (wasRunning) onAgentEnd?.();
      }
    },
    [isCompacting, onAgentEnd]
  );

  const loadSession = useCallback(
    async (sid: string, showLoading = false) => {
      const store = useSessionStore.getState();
      if (showLoading) store.setLoading(true);
      try {
        const detail = await hostCall("sessionDetail", { sessionId: sid });
        if (sessionIdRef.current !== sid) return null;
        if (!detail) throw new Error("Session not found");
        const loaded = {
          sessionId: detail.sessionId,
          filePath: detail.filePath,
          tree: detail.tree.filter(
            (node): node is SessionTreeNode =>
              typeof node === "object" && node !== null
          ),
          leafId: detail.leafId,
          context: detail.context,
        };
        store.setData(loaded);
        store.setActiveLeafId(loaded.leafId);
        useTranscriptStore
          .getState()
          .setMessages(loaded.context.messages.map(normalizeToolCalls));
        useTranscriptStore.getState().setEntryIds(loaded.context.entryIds);
        setThinkingLevel(loaded.context.thinkingLevel as ThinkingLevelOption);
        store.setError(null);
        // JSONL is painted → release the loading overlay NOW. Attaching ACP
        // (which re-parses the same JSONL server-side and replays it as
        // notifications) can take another 2–5 s for long sessions; blocking
        // the UI on that felt like "loading half a day".
        if (showLoading) store.setLoading(false);

        // ACP subscription is best-effort: if the agent hasn't heard of this
        // session yet (fresh cold start after the file was written) we still
        // want the transcript visible so the user can inspect / branch. Runs
        // in the background — the local snapshot from sessionDetail stays
        // authoritative until the first ACP snapshot arrives.
        const cwd = detail.cwd || newSessionCwd || session?.cwd || "";
        const alreadyOwned =
          sessionIdRef.current === sid &&
          lastLoadedSessionIdRef.current === sid;
        lastLoadedSessionIdRef.current = sid;
        // If this hook already owns the ACP session (e.g. we just created it
        // via `session/new`), skip `session/load` entirely — that op is
        // historical replay and would wipe the live transcript. Just refresh
        // the subscription. For a genuinely different session-from-disk,
        // call `session/load` so omp opens the JSONL and replays it.
        void (async () => {
          try {
            if (!alreadyOwned) {
              await acpRequest({
                type: "acp/loadSession",
                sessionId: sid,
                cwd,
              });
            }
            await acpRequest({ type: "acp/subscribeSession", sessionId: sid });
          } catch (acpErr) {
            addNotice({
              type: "warning",
              message:
                acpErr instanceof Error
                  ? `Agent could not attach: ${acpErr.message}`
                  : "Agent could not attach to this session",
            });
          }
        })();
        return loaded;
      } catch (cause) {
        store.setError(cause instanceof Error ? cause.message : String(cause));
        if (showLoading) store.setLoading(false);
        return null;
      }
    },
    [addNotice, newSessionCwd, session?.cwd]
  );

  // ACP-native session creation: a blank chat has NO session; the first
  // send creates one via session/new. Attaching to existing sessions is
  // always EXPLICIT (sidebar pick / reopen restore → loadSession →
  // session/load full replay). The previous "silently attach the most
  // recent session in this cwd" magic put messages into old sessions the
  // user never chose and raced the background attach ("Session … not
  // found" on send).
  const ensureNewSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;
    const task = (async () => {
      const cwd = newSessionCwd ?? session?.cwd;
      if (!cwd) return null;
      const created = await acpRequest({ type: "acp/newSession", cwd });
      const sid = responseSessionId(created);
      if (!sid) return null;
      sessionIdRef.current = sid;
      useSessionStore.getState().setCurrent(sid, isNew);
      // session/new returns a fully-live session — mark it loaded so the
      // later selectedSession promotion doesn't re-run loadSession (which
      // would trigger a pointless historical replay of an empty session).
      lastLoadedSessionIdRef.current = sid;
      try {
        await acpRequest({ type: "acp/subscribeSession", sessionId: sid });
      } catch {
        /* subscription is best-effort */
      }
      return sid;
    })();
    ensuringNewSessionRef.current = task;
    try {
      return await task;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [newSessionCwd, session?.cwd, isNew]);

  const sendPrompt = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const sid = sessionIdRef.current ?? (await ensureNewSession());
      if (!sid) throw new Error("No active session");
      return acpRequest({
        type: "acp/prompt",
        sessionId: sid,
        prompt: contentFor(message, images),
      });
    },
    [ensureNewSession]
  );

  const handleSend = useCallback(
    async (
      message: string,
      images?: AttachedImage[],
      _flags?: { bashExcluded?: boolean }
    ) => {
      if (/^\/compact/i.test(message)) beginCompaction();
      try {
        const sid = sessionIdRef.current ?? (await ensureNewSession());
        if (!sid) return;
        const command = message
          .trim()
          .match(/^\/(live|collab|join|leave)(?:\s|$)/i)?.[1];
        if (command)
          addNotice({
            type: "info",
            message: `/${command.toLowerCase()} is TUI-only for now`,
          });
        // Optimistic user message lives in its own slot until the ACP
        // snapshot's messages array contains a signature-matched user row.
        // Do NOT push into `messages` — that races with applySnapshot and
        // caused duplicates + wrong ordering.
        useTranscriptStore.getState().setPendingUserMessage({
          role: "user",
          content: [
            { type: "text", text: message },
            ...(images ?? []).map((image) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: image.mimeType,
                data: image.data,
              },
            })),
          ],
          timestamp: Date.now(),
        });
        await acpRequest({
          type: "acp/prompt",
          sessionId: sid,
          prompt: contentFor(message, images),
        });
        promoteNewSession(1, message);
      } catch (cause) {
        useTranscriptStore.getState().setPendingUserMessage(null);
        addNotice({
          type: "error",
          message:
            cause instanceof Error ? cause.message : "Failed to send message",
        });
      }
    },
    [addNotice, beginCompaction, ensureNewSession, promoteNewSession]
  );

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) await acpRequest({ type: "acp/cancel", sessionId: sid });
  }, []);
  const handleFork = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const cwd = newSessionCwd ?? session?.cwd ?? "";
      setForkingEntryId(entryId);
      try {
        await acpRequest({ type: "acp/closeSession", sessionId: sid });
        await hostCall("sessionNavigateLeaf", { sessionId: sid, entryId });
        const response = await acpRequest({
          type: "acp/forkSession",
          sessionId: sid,
          cwd,
        });
        const newId = responseSessionId(response);
        if (newId) onSessionForked?.(newId);
      } catch (cause) {
        addNotice({
          type: "error",
          message:
            cause instanceof Error ? cause.message : "Failed to fork session",
        });
      } finally {
        setForkingEntryId(null);
      }
    },
    [addNotice, newSessionCwd, onSessionForked, session?.cwd]
  );
  const reloadAfterFileChange = useCallback(
    async (sid: string) => {
      await acpRequest({
        type: "acp/loadSession",
        sessionId: sid,
        cwd: newSessionCwd ?? session?.cwd ?? "",
      });
      await acpRequest({ type: "acp/subscribeSession", sessionId: sid });
    },
    [newSessionCwd, session?.cwd]
  );
  const handleEditResend = useCallback(
    async (
      entryId: string,
      text: string,
      images?: Array<{ type: "image"; data: string; mimeType: string }>
    ) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      await acpRequest({ type: "acp/closeSession", sessionId: sid });
      await hostCall("sessionRewind", { sessionId: sid, entryId });
      await reloadAfterFileChange(sid);
      // A model switched in the edit composer may not have been confirmed
      // by the agent before closeSession, and session/load restores the
      // model persisted in the JSONL — re-assert the user's optimistic
      // pick so the resent prompt runs on the model they just chose.
      if (optimisticModel) {
        try {
          await acpRequest({
            type: "acp/setConfigOption",
            sessionId: sid,
            configId: "model",
            value: `${optimisticModel.provider}/${optimisticModel.modelId}`,
          });
        } catch {
          // Non-fatal: the prompt still runs on the session's persisted model.
        }
      }
      const attached = images?.map((img) => ({
        data: img.data,
        mimeType: img.mimeType,
        previewUrl: "",
      }));
      await sendPrompt(text, attached);
    },
    [optimisticModel, reloadAfterFileChange, sendPrompt]
  );
  const handleNavigate = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      await acpRequest({ type: "acp/closeSession", sessionId: sid });
      await hostCall("sessionNavigateLeaf", { sessionId: sid, entryId });
      await reloadAfterFileChange(sid);
      useSessionStore.getState().setActiveLeafId(entryId);
    },
    [reloadAfterFileChange]
  );
  const handleLeafChange = useCallback(
    async (leafId: string | null) => {
      if (leafId) await handleNavigate(leafId);
    },
    [handleNavigate]
  );

  const handleModelChange = useCallback(
    async (provider: string, modelId: string) => {
      // Optimistic: paint the picker with the chosen model immediately so the
      // click feels instant, then round-trip through omp in the background.
      setOptimisticModel({ provider, modelId });
      saveLastModel(provider, modelId);
      setNewSessionModel({ provider, modelId });
      const sid = sessionIdRef.current ?? (await ensureNewSession());
      if (!sid) return;
      try {
        await acpRequest({
          type: "acp/setConfigOption",
          sessionId: sid,
          configId: "model",
          value: `${provider}/${modelId}`,
        });
      } catch {
        try {
          await acpRequest({
            type: "acp/prompt",
            sessionId: sid,
            prompt: contentFor(`/model ${provider}/${modelId}`),
          });
        } catch {
          // Rollback the optimistic paint if both channels fail.
          setOptimisticModel(null);
        }
      }
    },
    [ensureNewSession]
  );

  const handleThinkingLevelChange = useCallback(
    async (level: ThinkingLevelOption) => {
      setThinkingLevel(level);
      if (level === "auto") return;
      const sid = sessionIdRef.current ?? (await ensureNewSession());
      if (!sid) return;
      try {
        await acpRequest({
          type: "acp/setConfigOption",
          sessionId: sid,
          configId: "thinking",
          value: level,
        });
      } catch {
        await acpRequest({
          type: "acp/prompt",
          sessionId: sid,
          prompt: contentFor(`/thinking-level ${level}`),
        });
      }
    },
    [ensureNewSession]
  );
  const handleToolPresetChange = useCallback(
    async (preset: "none" | "default" | "full") => {
      setToolPresetState(preset);
      const sid = sessionIdRef.current ?? (await ensureNewSession());
      if (!sid) return;
      try {
        await acpRequest({
          type: "acp/setConfigOption",
          sessionId: sid,
          configId: "tool_preset",
          value: preset,
        });
      } catch {
        await acpRequest({
          type: "acp/prompt",
          sessionId: sid,
          prompt: contentFor(
            `/tools ${getToolNamesForPreset(preset).join(" ")}`
          ),
        });
      }
    },
    [ensureNewSession, setToolPresetState]
  );
  const handleRoleChange = useCallback(
    async (role: string) => {
      const sid = sessionIdRef.current ?? (await ensureNewSession());
      if (!sid) return;
      if (role === "fast") {
        try {
          await acpRequest({
            type: "acp/setConfigOption",
            sessionId: sid,
            configId: "mode",
            value: "fast",
          });
        } catch {
          await sendPrompt("/fast");
        }
        return;
      }
      if (role === "plan") {
        const mode = snapshot?.availableModes.find((candidate) =>
          candidate.id.startsWith("plan")
        );
        if (mode)
          await acpRequest({
            type: "acp/setMode",
            sessionId: sid,
            modeId: mode.id,
          });
        else await sendPrompt("/plan");
        return;
      }
      if (role === "default" && modelRoles.default)
        await handleModelChange(
          modelRoles.default.provider,
          modelRoles.default.modelId
        );
    },
    [
      ensureNewSession,
      handleModelChange,
      modelRoles.default,
      sendPrompt,
      snapshot?.availableModes,
    ]
  );
  const handleCompact = useCallback(async () => {
    beginCompaction();
    try {
      await sendPrompt("/compact");
    } catch (cause) {
      setIsCompacting(false);
      setCompactError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [beginCompaction, sendPrompt]);
  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) await acpRequest({ type: "acp/cancel", sessionId: sid });
  }, []);
  const steeringPrompt = useCallback(
    (message: string, images?: AttachedImage[]) => sendPrompt(message, images),
    [sendPrompt]
  );
  const handleSteer = steeringPrompt;
  const handleFollowUp = steeringPrompt;
  const handlePromptWithStreamingBehavior = useCallback(
    (
      message: string,
      _behavior: "steer" | "followUp",
      images?: AttachedImage[]
    ) => steeringPrompt(message, images),
    [steeringPrompt]
  );

  // In-flight dedupe: multiple effects (session change, modelsRefreshKey,
  // isNew path) all fire loadModels on the same tick. Coalesce into one
  // hostCall by keeping the last inflight promise per cwd.
  const modelsGetInflightRef = useRef<{
    cwd: string;
    promise: Promise<ModelsResult>;
  } | null>(null);
  const loadModels = useCallback(
    async (_signal?: AbortSignal) => {
      const cwd = newSessionCwd ?? "";
      const inflight = modelsGetInflightRef.current;
      if (inflight && inflight.cwd === cwd) return inflight.promise;
      const promise = hostCall("modelsGet", { cwd }).then((response) => {
        setModelNames(response.models);
        setModelList(response.modelList);
        setModelRoles(response.modelRoles);
        setNewSessionDefaultModel(response.defaultModel);
        setModelError(response.modelError);
        setModelScopeWarnings(
          response.modelScopeWarnings.filter(
            (warning): warning is string => typeof warning === "string"
          )
        );
        setModelThinkingLevels({});
        setModelThinkingLevelMaps({});
        return response;
      });
      modelsGetInflightRef.current = { cwd, promise };
      // Clear the cache once the request settles (success or failure) so a
      // later invalidation (modelsRefreshKey bump, user save) refetches.
      promise.finally(() => {
        if (modelsGetInflightRef.current?.promise === promise) {
          modelsGetInflightRef.current = null;
        }
      });
      return promise;
    },
    [newSessionCwd]
  );
  const loadTools = useCallback(async (_sid?: string) => [], []);
  const loadSlashCommands = useCallback(
    async () => slashCommands,
    [slashCommands]
  );
  // Local slash-command whitelist (see tui-parity-plan Phase 0). Every other command MUST
  // fall through to ACP as prompt text so omp can execute its own slash commands.
  const handleBuiltinSlashCommand = useCallback(
    async (text: string): Promise<BuiltinSlashCommandResult> => {
      const [command] = text.trim().slice(1).split(/\s+/, 1);
      const name = command?.toLowerCase();
      if (!name) return { handled: false };
      if (name === "history-search") {
        addNotice({ type: "info", message: "History search coming soon" });
        return { handled: true };
      }
      if (name === "copy") {
        const assistant = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");
        const textToCopy = messageText(assistant ?? null);
        if (!textToCopy)
          return { handled: true, error: "No assistant message to copy" };
        await navigator.clipboard.writeText(textToCopy);
        return { handled: true, message: "Copied last assistant message" };
      }
      if (name === "new") {
        onSessionCreated?.({
          id: "",
          path: "",
          cwd: newSessionCwd ?? "",
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          messageCount: 0,
          firstMessage: "(new session)",
        });
        return { handled: true, message: "Started a new session" };
      }
      if (name === "quit") {
        addNotice({
          type: "info",
          message: "Close the webview via the panel's close button",
        });
        return { handled: true };
      }
      if (name === "help" || name === "hotkeys") {
        addNotice({
          type: "info",
          message:
            "Enter sends; Shift+Enter newline; Ctrl+R history search; Alt+M models; Alt+A agent hub. Type /<cmd> to run omp commands.",
        });
        return { handled: true };
      }
      if (name === "settings") {
        onOpenSettings?.();
        return { handled: true };
      }
      if (name === "models" || name === "model") {
        /* Alt+M / palette CTA opens ModelSelector; do not swallow */ return {
          handled: false,
        };
      }
      if (name === "resume") {
        if (!onOpenResumeDialog) return { handled: false };
        onOpenResumeDialog();
        return { handled: true };
      }
      // Everything else falls through to ACP (session/prompt) so omp handles it natively.
      return { handled: false };
    },
    [
      addNotice,
      messages,
      newSessionCwd,
      onOpenResumeDialog,
      onOpenSettings,
      onSessionCreated,
    ]
  );

  const respondInteraction = useCallback(
    async (
      request: InteractionDialog,
      response: {
        optionId?: string;
        action?: "accept" | "decline" | "cancel";
        content?: Record<string, ElicitationContentValue>;
      }
    ) => {
      if ("toolCall" in request)
        await acpRequest({
          type: "acp/respondPermission",
          resolverId: request.resolverId,
          optionId: response.optionId,
        });
      else
        await acpRequest({
          type: "acp/respondElicitation",
          resolverId: request.resolverId,
          action: response.action ?? "cancel",
          content: response.content,
        });
      usePermissionsStore.getState().clearDialog();
    },
    []
  );
  const handleDeleteSession = useCallback(async (sid: string) => {
    await acpRequest({ type: "acp/deleteSession", sessionId: sid });
    await hostCall("sessionDelete", { sessionId: sid });
  }, []);

  // ACP event bridge — single subscription installed once per mount. The
  // getter pattern keeps the subscription stable while allowing the
  // handlers' closures to evolve across renders (standard latest-ref
  // pattern; avoids the previous [addNotice, applySnapshot] re-subscribe
  // dance and its identity-cache churn).
  const handlersRef = useRef<Parameters<typeof installAcpEventBridge>[0]>(
    () => ({})
  );
  handlersRef.current = () => ({
    onSnapshot: handleSnapshotExtras,
    onConnection: (snap) => setCapabilities(snap.capabilities),
    onNotice: (level, message, sid) => {
      if (sid && sid !== sessionIdRef.current) return;
      addNotice({ type: level, message });
      if (sawErrorStopRef.current && /retry|retrying/i.test(message)) {
        const attemptMatch = /attempt (\d+)\/(\d+)/i.exec(message);
        setRetryInfo({
          attempt: attemptMatch ? Number(attemptMatch[1]) : 1,
          maxAttempts: attemptMatch ? Number(attemptMatch[2]) : 1,
          errorMessage: message,
        });
      }
    },
    onError: (message) => useSessionStore.getState().setError(message),
  });
  useEffect(() => installAcpEventBridge(() => handlersRef.current()), []);

  // Load a session on `session.id` change only. React may hand us a new
  // `session` OBJECT with the same id (e.g. AppShell hydrates missing
  // projectRoot metadata after promoteNewSession) — re-running loadSession
  // in that case wipes messages, shows the loading overlay, then races the
  // ACP replay to rebuild them, producing a visible flicker and doubled
  // rows during the merge.
  useEffect(() => {
    if (!session) return;
    if (lastLoadedSessionIdRef.current === session.id) {
      // Already loaded — parent handed us a new object (e.g. hydrated with
      // projectRoot) but the same session. No reload needed.
      return;
    }
    lastLoadedSessionIdRef.current = session.id;
    sessionIdRef.current = session.id;
    useSessionStore.getState().setCurrent(session.id, isNew);
    void loadSession(session.id, true);
    return () => {
      void acpRequest({
        type: "acp/unsubscribeSession",
        sessionId: session.id,
      });
    };
  }, [loadSession, session?.id, session, isNew]);
  // Blank-chat mount: ACP-native means NO session exists until the first
  // send (handleSend → ensureNewSession → session/new). Just load models
  // and release the loading overlay; nothing to create or attach here.
  useEffect(() => {
    if (session || !isNew || !newSessionCwd || sessionIdRef.current) return;
    void loadModels();
    useSessionStore.getState().setLoading(false);
  }, [isNew, loadModels, newSessionCwd, session]);
  useEffect(() => {
    if (onBranchDataChange)
      onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [activeLeafId, data?.tree, handleLeafChange, onBranchDataChange]);
  useEffect(() => {
    const controller = new AbortController();
    void loadModels(controller.signal);
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);
  useEffect(() => {
    if (!compactResult) return;
    const timeout = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(timeout);
  }, [compactResult]);
  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    const timeout = setTimeout(
      () =>
        dispatchNotice(
          exiting
            ? { type: "remove", id: exiting.id }
            : { type: "mark_oldest_exiting" }
        ),
      exiting ? NOTICE_EXIT_ANIMATION_MS : NOTICE_VISIBLE_MS
    );
    return () => clearTimeout(timeout);
  }, [noticeState.visible]);
  useEffect(() => {
    setSessionStatsOverride(null);
  }, [
    contextUsage?.contextWindow,
    contextUsage?.percent,
    contextUsage?.tokens,
    messages.length,
  ]);
  useEffect(() => {
    const stopReason = snapshot?.stopReason;
    if (
      !pendingRestoreModel ||
      !stopReason ||
      restoredTurnRef.current === stopReason
    )
      return;
    restoredTurnRef.current = stopReason;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void acpRequest({
      type: "acp/setConfigOption",
      sessionId,
      configId: "model",
      value: `${pendingRestoreModel.provider}/${pendingRestoreModel.modelId}`,
    }).finally(() => setPendingRestoreModel(null));
  }, [pendingRestoreModel, snapshot?.stopReason]);

  // Turn-end backfill from JSONL — ACP snapshots don't carry the fields
  // omp persists to disk:
  //   • entryIds       (edit-resend / fork / rewind address by these)
  //   • usage / duration / ttft / contextSnapshot (per-assistant stats)
  //
  // Previous version overwrote `messages` wholesale on every turn end,
  // which meant every message object was replaced by a fresh reference
  // → MessageView.memo failed for the whole transcript → visible
  // "重新推拉数据 → 跳一下" flash. We already have the live text via ACP
  // streaming; the JSONL is only needed for these auxiliary fields.
  //
  // Now: align by index, patch only the missing fields, keep the original
  // AgentMessage object when nothing needs enrichment. React sees the
  // same references across the diff → memo skips → no re-render.
  const lastHydratedStopReasonRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!snapshot || snapshot.promptPending) return;
    if (!snapshot.stopReason) return;
    const signature = `${snapshot.stopReason}#${snapshot.messages?.length ?? 0}`;
    if (lastHydratedStopReasonRef.current === signature) return;
    lastHydratedStopReasonRef.current = signature;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    let cancelled = false;
    void hostCall("sessionDetail", { sessionId })
      .then((detail) => {
        if (cancelled || !detail || sessionIdRef.current !== sessionId) return;
        // A new turn may have started while the fetch was in flight — the
        // JSONL doesn't have the live turn yet; don't wipe it.
        if (agentRunningRef.current) return;

        // Non-message updates are safe to swap wholesale — they don't
        // feed the message list.
        useSessionStore.getState().setData(() => ({
          sessionId: detail.sessionId,
          filePath: detail.filePath,
          tree: detail.tree.filter(
            (node): node is SessionTreeNode =>
              typeof node === "object" && node !== null
          ),
          leafId: detail.leafId,
          context: detail.context,
        }));
        useSessionStore.getState().setActiveLeafId(detail.leafId);
        useTranscriptStore.getState().setEntryIds(detail.context.entryIds);

        // Index-aligned in-place merge into the LIVE `messages` array.
        // Only patches assistant stats fields (usage/duration/ttft/
        // contextSnapshot) — content, role, and everything else stay put.
        useTranscriptStore.getState().setMessages((current) => {
          const persisted = detail.context.messages;
          let mutated = false;
          const next = current.map((message, index) => {
            if (message.role !== "assistant") return message;
            const source = persisted[index];
            if (!source || source.role !== "assistant") return message;
            const usage = message.usage ?? source.usage;
            const duration = message.duration ?? source.duration;
            const ttft = message.ttft ?? source.ttft;
            const timestamp = message.timestamp ?? source.timestamp;
            const contextSnapshot =
              message.contextSnapshot ?? source.contextSnapshot;
            if (
              usage === message.usage &&
              duration === message.duration &&
              ttft === message.ttft &&
              timestamp === message.timestamp &&
              contextSnapshot === message.contextSnapshot
            ) return message;
            mutated = true;
            return {
              ...message,
              usage,
              duration,
              ttft,
              timestamp,
              contextSnapshot,
            } satisfies AssistantMessage;
          });
          return mutated ? next : current;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    snapshot?.promptPending,
    snapshot?.stopReason,
    snapshot?.messages?.length,
  ]);
  void currentSessionId; // read to keep the store subscription alive for the
  // future in which acp-events reads currentId in-line and downstream selectors
  // are added; today it's used only inside the event bridge closure.

  return {
    data,
    loading,
    error,
    activeLeafId,
    messages,
    pendingUserMessage,
    entryIds,
    streamState,
    agentRunning,
    modelNames,
    modelList,
    modelError,
    modelScopeWarnings,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    modelRoles,
    fastMode,
    newSessionModel,
    toolPreset,
    thinkingLevel,
    pendingRestoreModel,
    retryInfo,
    contextUsage: sessionStats?.contextUsage ?? contextUsage,
    imageSupported: capabilities?.prompts.image ?? false,
    forkingEntryId,
    compactionBoundary,
    isCompacting,
    compactError,
    compactResult,
    currentModel,
    displayModel,
    sessionStats,
    agentPhase,
    liveTps,
    isNew,
    activeModes,
    notices: noticeState.visible,
    isAutoModelSelection: isNew && newSessionModel === null,
    slashCommands,
    slashCommandsLoading,

    sessionIdRef,
    eventSourceRef,
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
    handleRoleChange,
    loadModels,
    loadTools,
    loadSlashCommands,
    setActiveLeafId,
    setData,
    setMessages,
    dispatch,
    setAgentRunning,
    setForkingEntryId,
    bashRunning,
    pendingBash,
    handleAgentEventRef,
    interactionDialog,
    respondInteraction,
    handleDeleteSession,
  };
}
