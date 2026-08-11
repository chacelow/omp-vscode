"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";
import type {
  AgentMessage,
  AssistantMessage,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionTreeNode,
  ToolCallKind,
  ToolCallStatus,
  ToolResultMessage,
} from "@/lib/types";
import { getToolNamesForPreset } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { acpRequest, hostCall, subscribeAcp } from "../../bridge";
import type {
  AcpElicitationRequest,
  AcpHostEvent,
  AcpMessage,
  AcpPermissionRequest,
  AcpSessionState,
} from "../../../core/acp/protocol";
import type { ContentBlock, ElicitationContentValue, ToolCall } from "@agentclientprotocol/sdk";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start": return { isStreaming: true, streamingMessage: null };
    case "update": return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset": return { isStreaming: false, streamingMessage: null };
    default: return state;
  }
}

export interface QueuedMessages { steering: string[]; followUp: string[]; }
export type NoticeType = "info" | "success" | "warning" | "error";
export type NoticeItem = { id: string; message: string; type: NoticeType; exiting?: boolean };
type NoticeState = { visible: NoticeItem[]; pending: NoticeItem[] };
type NoticeAction = { type: "add"; notice: NoticeItem } | { type: "mark_oldest_exiting" } | { type: "remove"; id: string };

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
  sourceInfo?: { path: string; source: string; scope: "user" | "project" | "temporary"; origin: "package" | "top-level"; baseDir?: string };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => Promise<void>) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onOpenSettings?: () => void;
  /** Opens the webview-native full session picker for the local `/resume` command. */
  onOpenResumeDialog?: () => void;
  setToolPreset?: (preset: "none" | "default" | "full") => void;
  forceNewSession?: boolean;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}
export interface AttachedImage { data: string; mimeType: string; previewUrl: string; }

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = { id: string; name: string; provider: string; contextWindow?: number };
type InteractionDialog = AcpPermissionRequest | AcpElicitationRequest;

const LAST_MODEL_KEY = "omp.lastModel";
const MAX_NOTICES = 5;
const NOTICE_VISIBLE_MS = 5000;
const NOTICE_EXIT_ANIMATION_MS = 180;
const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
const USER_SCROLL_INTENT_MS = 1200;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);
type DisplayContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "thinking"; thinking: string }
>;
function createNoticeId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function readLastModel(): SelectedModel | null {
  try {
    const raw = localStorage.getItem(LAST_MODEL_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("provider" in value) || !("modelId" in value)) return null;
    return typeof value.provider === "string" && typeof value.modelId === "string"
      ? { provider: value.provider, modelId: value.modelId }
      : null;
  } catch { return null; }
}
function saveLastModel(provider: string, modelId: string): void {
  try { localStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ provider, modelId })); } catch { /* storage is optional */ }
}
function markOldestNoticeExiting(notices: NoticeItem[]): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting);
  return index < 0 ? notices : notices.map((notice, i) => i === index ? { ...notice, exiting: true } : notice);
}
function fillPendingNotices(visible: NoticeItem[], pending: NoticeItem[]): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    if (!next) break;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting)) nextVisible = markOldestNoticeExiting(nextVisible);
  return { visible: nextVisible, pending: nextPending };
}
function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  if (action.type === "add") {
    if (state.visible.some((notice) => notice.id === action.notice.id) || state.pending.some((notice) => notice.id === action.notice.id)) return state;
    if (state.visible.some((notice) => notice.exiting) || state.visible.length >= MAX_NOTICES) {
      return { visible: state.visible.some((notice) => notice.exiting) ? state.visible : markOldestNoticeExiting(state.visible), pending: [...state.pending, action.notice] };
    }
    return { ...state, visible: [...state.visible, action.notice] };
  }
  if (action.type === "mark_oldest_exiting") return { ...state, visible: markOldestNoticeExiting(state.visible) };
  if (action.type === "remove") return fillPendingNotices(state.visible.filter((notice) => notice.id !== action.id), state.pending);
  return state;
}
function blocksToContent(blocks: readonly ContentBlock[]): DisplayContent {
  const result: DisplayContent = [];
  for (const block of blocks) {
    if (block.type === "text") result.push({ type: "text", text: block.text });
    else if (block.type === "image") result.push({ type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } });
  }
  return result;
}
function normalizeKind(kind: string | undefined): ToolCallKind | undefined {
  const allowed: readonly ToolCallKind[] = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"];
  return kind && (allowed as readonly string[]).includes(kind) ? (kind as ToolCallKind) : undefined;
}
function normalizeStatus(status: string | undefined): ToolCallStatus | undefined {
  const allowed: readonly ToolCallStatus[] = ["pending", "in_progress", "completed", "failed"];
  return status && (allowed as readonly string[]).includes(status) ? (status as ToolCallStatus) : undefined;
}
function toolMessages(message: AcpMessage, tool: ToolCall | undefined): AgentMessage[] {
  if (message.role !== "toolCall" || !tool) return [];
  const toolName = tool.name?.trim() || tool.kind || tool.title || "tool";
  const input = typeof tool.rawInput === "object" && tool.rawInput !== null && !Array.isArray(tool.rawInput)
    ? tool.rawInput as Record<string, unknown>
    : {};
  const locations = (tool.locations ?? []).flatMap((location) => location.path ? [{ path: location.path, line: typeof location.line === "number" ? location.line : undefined }] : []);
  let output = "";
  if (typeof tool.rawOutput === "string") output = tool.rawOutput;
  else if (tool.rawOutput !== undefined) {
    try { output = JSON.stringify(tool.rawOutput, null, 2); } catch { output = String(tool.rawOutput); }
  } else {
    output = (tool.content ?? []).flatMap((item) => item.type === "content" && item.content.type === "text" ? [item.content.text] : item.type === "diff" ? [item.newText] : []).join("\n");
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
  const result: ToolResultMessage = { role: "toolResult", toolCallId: message.toolCallId, toolName, content: output ? [{ type: "text", text: output }] : [], isError: tool.status === "failed", timestamp: Date.now() };
  return [call, result];
}

function toAgentMessages(message: AcpMessage, tools: Record<string, ToolCall>): AgentMessage[] {
  return message.role === "toolCall" ? toolMessages(message, tools[message.toolCallId]) : [toAgentMessage(message)];
}

function toAgentMessage(message: AcpMessage): AgentMessage {
  const content = blocksToContent(message.content);
  if (message.role === "user") {
    return { role: "user", content: content.filter((block): block is DisplayContent[number] & ({ type: "text" } | { type: "image" }) => block.type === "text" || block.type === "image"), timestamp: Date.now() };
  }
  if (message.role === "thought") {
    return { role: "assistant", content: content.filter((block) => block.type === "text").map((block) => ({ type: "thinking" as const, thinking: block.text })), model: "", provider: "", timestamp: Date.now() };
  }
  return { role: "assistant", content, model: "", provider: "", timestamp: Date.now() };
}
function messageText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) return "";
  return message.content.reduce<string>((text, block) => {
    if (!block || typeof block !== "object" || !("type" in block) || block.type !== "text" || !("text" in block) || typeof block.text !== "string") return text;
    return text + block.text;
  }, "");
}
function parseModel(value: string | undefined): SelectedModel | null {
  if (!value) return null;
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1 ? { provider: value.slice(0, separator), modelId: value.slice(separator + 1) } : null;
}
function responseSessionId(response: unknown): string | null {
  if (!response || typeof response !== "object" || !("sessionId" in response) || typeof response.sessionId !== "string") return null;
  return response.sessionId;
}
function activeModesFromSnapshot(snapshot: AcpSessionState | null): string[] {
  if (!snapshot || !("_meta" in snapshot)) return [];
  const meta: unknown = snapshot._meta;
  if (!meta || typeof meta !== "object" || !("activeModes" in meta) || !Array.isArray(meta.activeModes)) return [];
  return meta.activeModes.filter((mode): mode is string => typeof mode === "string");
}
function contentFor(message: string, images?: AttachedImage[]): ContentBlock[] {
  return [{ type: "text", text: message }, ...(images ?? []).map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType } as unknown as ContentBlock))];
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const { session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onOpenSettings, onOpenResumeDialog } = opts;
  const isNew = session === null && newSessionCwd !== null;
  const initialForceNewSessionRef = useRef(opts.forceNewSession === true);
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(session !== null || (newSessionCwd !== null && opts.forceNewSession !== true));
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelRoles, setModelRoles] = useState<Record<string, { provider: string; modelId: string; thinkingLevel?: string }>>({});
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [toolPreset, setToolPreset] = useState<"none" | "default" | "full">("default");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [liveTps, setLiveTps] = useState<number | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(true);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [compactionBoundary, setCompactionBoundary] = useState<{ at: number; messageIndex: number } | null>(null);
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });
  const [snapshot, setSnapshot] = useState<AcpSessionState | null>(null);
  const [pendingRestoreModel, setPendingRestoreModel] = useState<SelectedModel | null>(null);
  const activeModes = useMemo(() => activeModesFromSnapshot(snapshot), [snapshot]);
  const [interactionDialog, setInteractionDialog] = useState<InteractionDialog | null>(null);

  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const eventSourceRef = useRef<null>(null);
  const handleAgentEventRef = useRef<null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const completionScrollAllowedRef = useRef(true);
  const agentRunningRef = useRef(false);
  const userScrollIntentUntilRef = useRef(0);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const preCompactUsedRef = useRef<number | null>(null);
  const latestUsedRef = useRef<number | null>(null);
  const sawErrorStopRef = useRef(false);
  const tpsRef = useRef({ chars: 0, startedAt: 0 });
  const restoredTurnRef = useRef<string | null>(null);
  const addNotice = useCallback((notice: Omit<NoticeItem, "id"> & { id?: string }) => dispatchNotice({ type: "add", notice: { ...notice, id: notice.id ?? createNoticeId() } }), []);
  const currentModel = useMemo(() => {
    const option = snapshot?.configOptions.find((config) => config.category === "model");
    return parseModel(typeof option?.currentValue === "string" ? option.currentValue : undefined);
  }, [snapshot]);
  const displayModel = currentModel ?? (isNew ? (newSessionModel ?? newSessionDefaultModel) : null) ?? readLastModel() ?? modelRoles.default ?? null;
  const fastMode = Boolean(snapshot?.currentMode && /fast/i.test(snapshot.currentMode));
  const bashRunning = false;
  const setToolPresetState = opts.setToolPreset ?? setToolPreset;
  const pendingBash = null as { command: string; excludeFromContext?: boolean } | null;
  // Intentional: ACP has no status bar, widget, or custom extension-UI transport; retain empty placeholders rather than inventing state.
  const extensionDialog = null as Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }> | null;
  const extensionCustomUi = null as Extract<ExtensionUiRequest, { method: "custom" }> | null;
  const extensionStatuses: ExtensionStatusItem[] = [];
  const extensionWidgets: ExtensionWidgetItem[] = [];
  const sessionStats = useMemo(() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0, userMessages = 0, assistantMessages = 0, toolResults = 0, toolCalls = 0;
    for (const message of messages) {
      if (message.role === "user") userMessages += 1;
      if (message.role === "toolResult") toolResults += 1;
      if (message.role !== "assistant") continue;
      assistantMessages += 1;
      toolCalls += message.content.filter((block) => block.type === "toolCall").length;
      const usage = message.usage;
      if (!usage) continue;
      tokens.input += usage.input ?? 0; tokens.output += usage.output ?? 0; tokens.cacheRead += usage.cacheRead ?? 0; tokens.cacheWrite += usage.cacheWrite ?? 0; cost += usage.cost?.total ?? 0;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    const matched = displayModel ? modelList.find((model) => model.provider === displayModel.provider && (model.id === displayModel.modelId || displayModel.modelId.includes(model.id))) : null;
    const contextWindow = contextUsage?.contextWindow || matched?.contextWindow || 128000;
    const currentTokens = contextUsage?.tokens ?? null;
    return { sessionFile: data?.filePath || undefined, sessionId: sessionIdRef.current ?? session?.id ?? "", sessionName: session?.name, userMessages, assistantMessages, toolCalls, toolResults, totalMessages: messages.length, tokens, cost, contextUsage: { percent: currentTokens === null ? null : (currentTokens / contextWindow) * 100, contextWindow, tokens: currentTokens } } satisfies SessionStatsInfo;
  }, [contextUsage, data?.filePath, displayModel, messages, modelList, session?.id, session?.name, sessionStatsOverride]);

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    onSessionCreated?.({ id: sid, path: data?.filePath ?? "", cwd: newSessionCwd, created: new Date().toISOString(), modified: new Date().toISOString(), messageCount, firstMessage });
  }, [data?.filePath, isNew, newSessionCwd, onSessionCreated]);
  const beginCompaction = useCallback(() => {
    preCompactUsedRef.current = latestUsedRef.current;
    setIsCompacting(true);
    setCompactError(null);
  }, []);


  const applySnapshot = useCallback((state: AcpSessionState) => {
    if (state.sessionId !== sessionIdRef.current) return;
    setSnapshot(state);
    const nextMessages = state.messages.flatMap((message) => toAgentMessages(message, state.toolCalls));
    setMessages((current) => {
      // ACP snapshots strip per-message usage/duration/ttft/timestamp because
      // ACP doesn't emit them. Preserve the JSONL-derived stats already on
      // local messages by aligning assistant-index across the diff.
      const previousAssistants: AssistantMessage[] = current.filter((message): message is AssistantMessage => message.role === "assistant");
      let assistantIndex = 0;
      const enriched = nextMessages.map((message) => {
        if (message.role !== "assistant") return message;
        const previous = previousAssistants[assistantIndex++];
        if (!previous) return message;
        return {
          ...message,
          usage: message.usage ?? previous.usage,
          duration: message.duration ?? previous.duration,
          ttft: message.ttft ?? previous.ttft,
          timestamp: message.timestamp ?? previous.timestamp,
        } satisfies AssistantMessage;
      });
      const optimisticKey = optimisticUserMessageKeyRef.current;
      if (!optimisticKey) return enriched;
      const hasAuthoritativeMessage = enriched.some((message) => message.role === "user" && messageText(message) === optimisticKey);
      if (hasAuthoritativeMessage) optimisticUserMessageKeyRef.current = null;
      return enriched;
    });
    agentRunningRef.current = state.promptPending;
    setAgentRunning(state.promptPending);
    const activeTools = Object.entries(state.toolCalls).flatMap(([id, tool]) => tool.status === "in_progress" ? [{ id, name: tool.title ?? tool.kind ?? "Tool" }] : []);
    setAgentPhase(activeTools.length > 0 ? { kind: "running_tools", tools: activeTools } : state.promptPending ? { kind: "waiting_model" } : null);
    setSlashCommands(state.availableCommands.map((command) => ({ name: command.name, description: command.description, inputHint: command.input?.hint, source: "prompt" })));
    setSlashCommandsLoading(false);
    const usage = state.usage;
    const nextUsed = usage?.totalTokens ?? null;
    const preCompactUsed = preCompactUsedRef.current;
    latestUsedRef.current = nextUsed;
    setContextUsage(usage ? { percent: null, contextWindow: 0, tokens: nextUsed } : null);
    if (isCompacting && (state.stopReason || (preCompactUsed !== null && nextUsed !== null && nextUsed < preCompactUsed))) {
      if (preCompactUsed !== null && nextUsed !== null && nextUsed < preCompactUsed) setCompactionBoundary({ at: Date.now(), messageIndex: nextMessages.length });
      preCompactUsedRef.current = null;
      setIsCompacting(false);
    }
    setSystemPrompt(null);
    if (state.stopReason === "error") sawErrorStopRef.current = true;
    else if (state.promptPending) {
      sawErrorStopRef.current = false;
      setRetryInfo(null);
    }
    if (state.promptPending) {
      const streaming = [...nextMessages].reverse().find((message) => message.role === "assistant");
      if (streaming) dispatch({ type: "update", message: streaming }); else dispatch({ type: "start" });
      const chars = messageText(streaming ?? null);
      const now = performance.now();
      if (tpsRef.current.startedAt === 0 || chars.length < tpsRef.current.chars) tpsRef.current = { chars: chars.length, startedAt: now };
      else if (now > tpsRef.current.startedAt) setLiveTps((chars.length - tpsRef.current.chars) / ((now - tpsRef.current.startedAt) / 1000));
    } else {
      dispatch({ type: "end" });
      setLiveTps(null);
      tpsRef.current = { chars: 0, startedAt: 0 };
      if (isCompacting) setIsCompacting(false);
      onAgentEnd?.();
    }
  }, [isCompacting, onAgentEnd]);

  const loadSession = useCallback(async (sid: string, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const detail = await hostCall("sessionDetail", { sessionId: sid });
      if (sessionIdRef.current !== sid) return null;
      if (!detail) throw new Error("Session not found");
      const loaded: SessionData = {
        sessionId: detail.sessionId,
        filePath: detail.filePath,
        tree: detail.tree.filter((node): node is SessionTreeNode => typeof node === "object" && node !== null),
        leafId: detail.leafId,
        context: detail.context,
      };
      setData(loaded);
      setActiveLeafId(loaded.leafId);
      setMessages(loaded.context.messages);
      setEntryIds(loaded.context.entryIds);
      setThinkingLevel(loaded.context.thinkingLevel as ThinkingLevelOption);
      setError(null);

      // ACP subscription is best-effort: if the agent hasn't heard of this
      // session yet (fresh cold start after the file was written) we still
      // want the transcript visible so the user can inspect / branch.
      const cwd = detail.cwd || newSessionCwd || session?.cwd || "";
      try {
        await acpRequest({ type: "acp/loadSession", sessionId: sid, cwd });
        await acpRequest({ type: "acp/subscribeSession", sessionId: sid });
      } catch (acpErr) {
        addNotice({
          type: "warning",
          message: acpErr instanceof Error
            ? `Agent could not attach: ${acpErr.message}`
            : "Agent could not attach to this session",
        });
      }
      return loaded;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [addNotice, newSessionCwd, session?.cwd]);

  const ensureNewSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;
    const task = (async () => {
      const cwd = newSessionCwd ?? session?.cwd;
      if (!cwd) return null;
      if (!initialForceNewSessionRef.current) {
        try {
          const listed = await hostCall("sessionsList", {});
          const recent = listed.sessions.filter((candidate) => candidate.cwd === cwd).sort((a, b) => b.modified.localeCompare(a.modified))[0];
          if (recent) {
            const resumed = await acpRequest({ type: "acp/resumeSession", sessionId: recent.id, cwd });
            const sid = responseSessionId(resumed) ?? recent.id;
            sessionIdRef.current = sid;
            return sid;
          }
        } catch { /* resume is best effort */ }
      }
      const created = await acpRequest({ type: "acp/newSession", cwd });
      const sid = responseSessionId(created);
      sessionIdRef.current = sid;
      return sid;
    })();
    ensuringNewSessionRef.current = task;
    try { return await task; } finally { ensuringNewSessionRef.current = null; }
  }, [newSessionCwd, session?.cwd]);

  const sendPrompt = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) throw new Error("No active session");
    return acpRequest({ type: "acp/prompt", sessionId: sid, prompt: contentFor(message, images) });
  }, [ensureNewSession]);

  const handleSend = useCallback(async (message: string, images?: AttachedImage[], _flags?: { bashExcluded?: boolean }) => {
    if (/^\/compact/i.test(message)) beginCompaction();
    try {
      const sid = sessionIdRef.current ?? await ensureNewSession();
      if (!sid) return;
      const command = message.trim().match(/^\/(live|collab|join|leave)(?:\s|$)/i)?.[1];
      if (command) addNotice({ type: "info", message: `/${command.toLowerCase()} is TUI-only for now` });
      optimisticUserMessageKeyRef.current = message;
      setMessages((previous) => [...previous, { role: "user", content: blocksToContent(contentFor(message, images)).filter((block): block is DisplayContent[number] & ({ type: "text" } | { type: "image" }) => block.type === "text" || block.type === "image"), timestamp: Date.now() }]);
      await acpRequest({ type: "acp/prompt", sessionId: sid, prompt: contentFor(message, images) });
      promoteNewSession(1, message);
    } catch (cause) {
      addNotice({ type: "error", message: cause instanceof Error ? cause.message : "Failed to send message" });
    }
  }, [addNotice, beginCompaction, ensureNewSession, promoteNewSession]);
  const handleAbort = useCallback(async () => { const sid = sessionIdRef.current; if (sid) await acpRequest({ type: "acp/cancel", sessionId: sid }); }, []);
  const handleFork = useCallback(async (_entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(_entryId);
    try { const response = await acpRequest({ type: "acp/forkSession", sessionId: sid, cwd: newSessionCwd ?? session?.cwd ?? "" }); const newId = responseSessionId(response); if (newId) onSessionForked?.(newId); }
    finally { setForkingEntryId(null); }
  }, [newSessionCwd, onSessionForked, session?.cwd]);
  const reloadAfterFileChange = useCallback(async (sid: string) => {
    await acpRequest({ type: "acp/loadSession", sessionId: sid, cwd: newSessionCwd ?? session?.cwd ?? "" });
    await acpRequest({ type: "acp/subscribeSession", sessionId: sid });
  }, [newSessionCwd, session?.cwd]);
  const handleEditResend = useCallback(async (entryId: string, text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    await acpRequest({ type: "acp/closeSession", sessionId: sid });
    await hostCall("sessionRewind", { sessionId: sid, entryId });
    await reloadAfterFileChange(sid);
    const attached = images?.map((img) => ({ data: img.data, mimeType: img.mimeType, previewUrl: "" }));
    await sendPrompt(text, attached);
  }, [reloadAfterFileChange, sendPrompt]);
  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current; if (!sid) return;
    await acpRequest({ type: "acp/closeSession", sessionId: sid });
    await hostCall("sessionNavigateLeaf", { sessionId: sid, entryId });
    await reloadAfterFileChange(sid);
    setActiveLeafId(entryId);
  }, [reloadAfterFileChange]);
  const handleLeafChange = useCallback(async (leafId: string | null) => { if (leafId) await handleNavigate(leafId); }, [handleNavigate]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    const sid = sessionIdRef.current ?? await ensureNewSession(); if (!sid) return;
    try { await acpRequest({ type: "acp/setConfigOption", sessionId: sid, configId: "model", value: `${provider}/${modelId}` }); }
    catch { await acpRequest({ type: "acp/prompt", sessionId: sid, prompt: contentFor(`/model ${provider}/${modelId}`) }); }
    saveLastModel(provider, modelId); setNewSessionModel({ provider, modelId });
  }, [ensureNewSession]);
  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level); if (level === "auto") return;
    const sid = sessionIdRef.current ?? await ensureNewSession(); if (!sid) return;
    try { await acpRequest({ type: "acp/setConfigOption", sessionId: sid, configId: "thinking", value: level }); }
    catch { await acpRequest({ type: "acp/prompt", sessionId: sid, prompt: contentFor(`/thinking-level ${level}`) }); }
  }, [ensureNewSession]);
  const handleToolPresetChange = useCallback(async (preset: "none" | "default" | "full") => {
    setToolPresetState(preset);
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) return;
    try { await acpRequest({ type: "acp/setConfigOption", sessionId: sid, configId: "tool_preset", value: preset }); }
    catch { await acpRequest({ type: "acp/prompt", sessionId: sid, prompt: contentFor(`/tools ${getToolNamesForPreset(preset).join(" ")}`) }); }
  }, [ensureNewSession, setToolPresetState]);
  const handleRoleChange = useCallback(async (role: string) => {
    const sid = sessionIdRef.current ?? await ensureNewSession(); if (!sid) return;
    if (role === "fast") { try { await acpRequest({ type: "acp/setConfigOption", sessionId: sid, configId: "mode", value: "fast" }); } catch { await sendPrompt("/fast"); } return; }
    if (role === "plan") { const mode = snapshot?.availableModes.find((candidate) => candidate.id.startsWith("plan")); if (mode) await acpRequest({ type: "acp/setMode", sessionId: sid, modeId: mode.id }); else await sendPrompt("/plan"); return; }
    if (role === "default" && modelRoles.default) await handleModelChange(modelRoles.default.provider, modelRoles.default.modelId);
  }, [ensureNewSession, handleModelChange, modelRoles.default, sendPrompt, snapshot?.availableModes]);
  const handleCompact = useCallback(async () => { beginCompaction(); try { await sendPrompt("/compact"); } catch (cause) { setIsCompacting(false); setCompactError(cause instanceof Error ? cause.message : String(cause)); } }, [beginCompaction, sendPrompt]);
  const handleAbortCompaction = useCallback(async () => { const sid = sessionIdRef.current; if (sid) await acpRequest({ type: "acp/cancel", sessionId: sid }); }, []);
  const steeringPrompt = useCallback(async (message: string, images?: AttachedImage[]) => { try { await sendPrompt(message, images); } catch { addNotice({ type: "warning", message: "Steering not supported in this omp version" }); } }, [addNotice, sendPrompt]);
  const handleSteer = steeringPrompt;
  const handleFollowUp = steeringPrompt;
  const handlePromptWithStreamingBehavior = useCallback(async (message: string, _behavior: "steer" | "followUp", images?: AttachedImage[]) => steeringPrompt(message, images), [steeringPrompt]);
  const handleRecallQueue = useCallback(async () => { setQueuedMessages({ steering: [], followUp: [] }); try { await sendPrompt("/clear-queue"); } catch { addNotice({ type: "warning", message: "Queue cannot be recalled in ACP mode" }); } }, [addNotice, sendPrompt]);

  const loadModels = useCallback(async (_signal?: AbortSignal) => {
    const response = await hostCall("modelsGet", { cwd: newSessionCwd ?? "" });
    setModelNames(response.models); setModelList(response.modelList); setModelRoles(response.modelRoles); setNewSessionDefaultModel(response.defaultModel); setModelError(response.modelError); setModelScopeWarnings(response.modelScopeWarnings.filter((warning): warning is string => typeof warning === "string")); setModelThinkingLevels({}); setModelThinkingLevelMaps({});
    return response;
  }, [newSessionCwd]);
  const loadTools = useCallback(async (_sid?: string) => [], []);
  const loadSlashCommands = useCallback(async () => slashCommands, [slashCommands]);
  // Local slash-command whitelist (see tui-parity-plan Phase 0). Every other command MUST
  // fall through to ACP as prompt text so omp can execute its own slash commands.
  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    const [command] = text.trim().slice(1).split(/\s+/, 1);
    const name = command?.toLowerCase();
    if (!name) return { handled: false };
    if (name === "history-search") {
      addNotice({ type: "info", message: "History search coming soon" });
      return { handled: true };
    }
    if (name === "copy") {
      const assistant = [...messages].reverse().find((message) => message.role === "assistant");
      const textToCopy = messageText(assistant ?? null);
      if (!textToCopy) return { handled: true, error: "No assistant message to copy" };
      await navigator.clipboard.writeText(textToCopy);
      return { handled: true, message: "Copied last assistant message" };
    }
    if (name === "new") {
      onSessionCreated?.({ id: "", path: "", cwd: newSessionCwd ?? "", created: new Date().toISOString(), modified: new Date().toISOString(), messageCount: 0, firstMessage: "(new session)" });
      return { handled: true, message: "Started a new session" };
    }
    if (name === "quit") {
      addNotice({ type: "info", message: "Close the webview via the panel's close button" });
      return { handled: true };
    }
    if (name === "help" || name === "hotkeys") {
      addNotice({ type: "info", message: "Enter sends; Shift+Enter newline; Ctrl+R history search; Alt+M models; Alt+A agent hub. Type /<cmd> to run omp commands." });
      return { handled: true };
    }
    if (name === "settings") { onOpenSettings?.(); return { handled: true }; }
    if (name === "models" || name === "model") { /* Alt+M / palette CTA opens ModelSelector; do not swallow */ return { handled: false }; }
    if (name === "resume") {
      if (!onOpenResumeDialog) return { handled: false };
      onOpenResumeDialog();
      return { handled: true };
    }
    // Everything else falls through to ACP (session/prompt) so omp handles it natively.
    return { handled: false };
  }, [addNotice, messages, newSessionCwd, onOpenResumeDialog, onOpenSettings, onSessionCreated]);

  const respondInteraction = useCallback(async (request: InteractionDialog, response: { optionId?: string; action?: "accept" | "decline" | "cancel"; content?: Record<string, ElicitationContentValue> }) => {
    if ("toolCall" in request) await acpRequest({ type: "acp/respondPermission", resolverId: request.resolverId, optionId: response.optionId });
    else await acpRequest({ type: "acp/respondElicitation", resolverId: request.resolverId, action: response.action ?? "cancel", content: response.content });
    setInteractionDialog(null);
  }, []);
  // ACP has no status/widget/custom UI transport; keep extension UI dark instead of inventing state.
  const respondToExtensionUi = useCallback(async () => {}, []);
  const sendExtensionCustomInput = useCallback(async () => {}, []);
  const handleDeleteSession = useCallback(async (sid: string) => { await acpRequest({ type: "acp/deleteSession", sessionId: sid }); await hostCall("sessionDelete", { sessionId: sid }); }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => { ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS; messagesEndRef.current?.scrollIntoView({ behavior }); }, []);
  const scrollUserMsgToTop = useCallback(() => { const container = scrollContainerRef.current; const element = lastUserMsgRef.current; if (!container || !element) return; const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop; ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS; container.scrollTo({ top: top - 16, behavior: "smooth" }); }, []);
  const markUserScrollIntent = useCallback((event: Event) => { if (event instanceof KeyboardEvent && (!SCROLL_KEYS.has(event.key) || (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")))) return; userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS; }, []);
  const handleScrollPositionChange = useCallback(() => { if (!agentRunningRef.current || Date.now() < ignoreProgrammaticScrollUntilRef.current || Date.now() > userScrollIntentUntilRef.current) return; completionScrollAllowedRef.current = false; }, []);

  useEffect(() => subscribeAcp((event: AcpHostEvent) => {
    if (event.type === "acp/sessionSnapshot") applySnapshot(event.state);
    else if (event.type === "acp/notice") {
      if (event.sessionId && event.sessionId !== sessionIdRef.current) return;
      addNotice({ type: event.level, message: event.message });
      if (sawErrorStopRef.current && /retry|retrying/i.test(event.message)) {
        const attemptMatch = /attempt (\d+)\/(\d+)/i.exec(event.message);
        setRetryInfo({ attempt: attemptMatch ? Number(attemptMatch[1]) : 1, maxAttempts: attemptMatch ? Number(attemptMatch[2]) : 1, errorMessage: event.message });
      }
    }
    // IRC peer messaging is intentionally absent from the ACP event mapper.
    else if (event.type === "acp/permissionRequest") setInteractionDialog(event.request);
    else if (event.type === "acp/elicitationRequest") setInteractionDialog(event.request);
    else if (event.type === "acp/error") setError(event.message);
  }), [addNotice, applySnapshot]);
  useEffect(() => { if (!session) return; sessionIdRef.current = session.id; void loadSession(session.id, true); void loadModels(); return () => { void acpRequest({ type: "acp/unsubscribeSession", sessionId: session.id }); }; }, [loadModels, loadSession, session]);
  useEffect(() => {
    if (session || !isNew || !newSessionCwd || sessionIdRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const sid = await ensureNewSession();
        if (!sid || cancelled) return;
        await loadSession(sid, !initialForceNewSessionRef.current);
        if (!cancelled) {
          void loadModels();
          if (!initialForceNewSessionRef.current) promoteNewSession(1, "");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        // A failed or empty new-session creation must never leave the composer
        // beneath the initial session-loading banner.
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ensureNewSession, isNew, loadModels, loadSession, newSessionCwd, promoteNewSession, session]);
  useEffect(() => { onSystemPromptChange?.(systemPrompt); }, [onSystemPromptChange, systemPrompt]);
  useEffect(() => { if (onBranchDataChange) onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange); }, [activeLeafId, data?.tree, handleLeafChange, onBranchDataChange]);
  useEffect(() => { window.addEventListener("keydown", markUserScrollIntent); window.addEventListener("pointerdown", markUserScrollIntent, { passive: true }); return () => { window.removeEventListener("keydown", markUserScrollIntent); window.removeEventListener("pointerdown", markUserScrollIntent); }; }, [markUserScrollIntent]);
  useEffect(() => { const container = scrollContainerRef.current; if (!container) return; container.addEventListener("wheel", markUserScrollIntent, { passive: true }); container.addEventListener("touchstart", markUserScrollIntent, { passive: true }); container.addEventListener("scroll", handleScrollPositionChange, { passive: true }); return () => { container.removeEventListener("wheel", markUserScrollIntent); container.removeEventListener("touchstart", markUserScrollIntent); container.removeEventListener("scroll", handleScrollPositionChange); }; }, [handleScrollPositionChange, loading, markUserScrollIntent, messages.length]);
  useEffect(() => { if (messages.length === 0) return; if (pendingScrollToUserRef.current) { pendingScrollToUserRef.current = false; initialScrollDoneRef.current = true; scrollUserMsgToTop(); } else if (!initialScrollDoneRef.current) { initialScrollDoneRef.current = true; scrollToBottom("instant"); } else if (!agentRunningRef.current && completionScrollAllowedRef.current) scrollToBottom("smooth"); }, [agentRunning, messages.length, scrollToBottom, scrollUserMsgToTop]);
  useEffect(() => { const controller = new AbortController(); void loadModels(controller.signal); return () => controller.abort(); }, [loadModels, modelsRefreshKey]);
  useEffect(() => { if (!compactResult) return; const timeout = setTimeout(() => setCompactResult(null), 6000); return () => clearTimeout(timeout); }, [compactResult]);
  useEffect(() => { if (noticeState.visible.length === 0) return; const exiting = noticeState.visible.find((notice) => notice.exiting); const timeout = setTimeout(() => dispatchNotice(exiting ? { type: "remove", id: exiting.id } : { type: "mark_oldest_exiting" }), exiting ? NOTICE_EXIT_ANIMATION_MS : NOTICE_VISIBLE_MS); return () => clearTimeout(timeout); }, [noticeState.visible]);
  useEffect(() => { setSessionStatsOverride(null); }, [contextUsage?.contextWindow, contextUsage?.percent, contextUsage?.tokens, messages.length]);
  useEffect(() => {
    const stopReason = snapshot?.stopReason;
    if (!pendingRestoreModel || !stopReason || restoredTurnRef.current === stopReason) return;
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

  // ACP doesn't emit per-message usage/duration/ttft. omp persists them to the
  // session JSONL — refetch on every turn end and merge onto local messages by
  // assistant-index alignment.
  useEffect(() => {
    if (!snapshot || snapshot.promptPending) return;
    if (!snapshot.stopReason && (snapshot.messages?.length ?? 0) === 0) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    let cancelled = false;
    void hostCall("sessionTail", { sessionId, sinceRevision: null }).then((tail) => {
      if (cancelled || !tail) return;
      const persisted: AssistantMessage[] = [];
      for (const entry of tail.entries) {
        if (entry.message.role === "assistant") persisted.push(entry.message);
      }
      setMessages((current) => {
        let index = 0;
        return current.map((message) => {
          if (message.role !== "assistant") return message;
          const source = persisted[index++];
          if (!source) return message;
          return {
            ...message,
            usage: source.usage ?? message.usage,
            duration: source.duration ?? message.duration,
            ttft: source.ttft ?? message.ttft,
            timestamp: source.timestamp ?? message.timestamp,
          } satisfies AssistantMessage;
        });
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [snapshot?.promptPending, snapshot?.stopReason, snapshot?.revision]);


  return {
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, modelRoles, fastMode, newSessionModel, toolPreset, thinkingLevel, pendingRestoreModel,
    retryInfo, contextUsage: sessionStats?.contextUsage ?? contextUsage, systemPrompt, forkingEntryId, compactionBoundary,
    isCompacting, compactError, compactResult, currentModel, displayModel, sessionStats,
    agentPhase, liveTps, isNew, activeModes,
    notices: noticeState.visible, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection: isNew && newSessionModel === null,
    slashCommands, slashCommandsLoading, queuedMessages,
    
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    handleSend, handleAbort, handleFork, handleEditResend, handleNavigate, handleModelChange, setPendingRestoreModel,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue, handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, handleRoleChange, loadModels, loadTools, loadSlashCommands, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId,
    bashRunning, pendingBash,
    handleAgentEventRef,
    interactionDialog, respondInteraction,
    handleDeleteSession,
  };
}
