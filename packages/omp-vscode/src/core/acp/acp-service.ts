import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import {
  client,
  methods,
  ndJsonStream,
  type ClientApp,
  type ClientConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type SessionMode,
  type ToolCall,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { resolveOmpBinary } from "../omp-binary";
import type {
  AcpConnectionSnapshot,
  AcpConnectionState,
  AcpElicitationRequest,
  AcpPermissionRequest,
  AcpSessionInfo,
  AcpSessionState,
} from "./protocol";

const GRACEFUL_SHUTDOWN_MS = 2_000;
const ACP_BOOTSTRAP_RACE_GUARD_MS = 50;

export class AcpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpUnavailableError";
  }
}

type Unsubscribe = () => void;
type SessionListener = (session: AcpSessionState) => void;
type ConnectionListener = (snapshot: AcpConnectionSnapshot) => void;
type RunningListener = (sessionIds: string[]) => void;
type PermissionListener = (request: AcpPermissionRequest) => void;
type ElicitationListener = (request: AcpElicitationRequest) => void;
type NoticeLevel = "info" | "success" | "warning" | "error";
type NoticeListener = (sessionId: string, level: NoticeLevel, message: string) => void;

function readSessionNotice(update: unknown): { level: NoticeLevel; message: string } | null {
  if (typeof update !== "object" || update === null) return null;
  const message = "text" in update && typeof update.text === "string"
    ? update.text
    : "message" in update && typeof update.message === "string"
      ? update.message
      : null;
  if (!message) return null;
  const level = "level" in update ? update.level : undefined;
  return {
    level: level === "success" || level === "warning" || level === "error" ? level : "info",
    message,
  };
}

function isSessionNotice(update: unknown): boolean {
  return typeof update === "object" && update !== null && "sessionUpdate" in update && (update.sessionUpdate === "notification" || update.sessionUpdate === "notice");
}

interface PendingPermission {
  sessionId: string;
  resolve: (response: { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } }) => void;
}

interface PendingElicitation {
  sessionId?: string;
  resolve: (response: CreateElicitationResponse) => void;
}

interface AcpServiceOptions {
  cwd: string;
  clientName: string;
  clientVersion: string;
  output: (line: string) => void;
}

const emptySession = (sessionId: string, cwd: string): AcpSessionState => ({
  sessionId,
  cwd,
  messages: [],
  toolCalls: {},
  availableCommands: [],
  availableModes: [],
  configOptions: [],
  plan: [],
  revision: 0,
  loaded: false,
  replaying: false,
  promptPending: false,
});

/** Cast a ToolCallUpdate (which allows null on some fields) to a ToolCall-compatible entry. */
function toToolCallEntry(tc: ToolCall): ToolCall {
  return {
    toolCallId: tc.toolCallId,
    title: tc.title,
    kind: tc.kind ?? undefined,
    status: tc.status ?? undefined,
    name: tc.name ?? undefined,
    content: tc.content,
    locations: tc.locations ?? undefined,
    rawInput: tc.rawInput,
    rawOutput: tc.rawOutput,
  };
}

/**
 * Fold a streamed content chunk into an existing block list. When the incoming
 * chunk is a `text` block AND the last existing block is also `text`, the two
 * strings are concatenated so a paragraph doesn't render as N separate lines.
 * Non-text blocks (images, tool calls) are appended as-is.
 */
function mergeContentBlocks(prev: readonly ContentBlock[], next: ContentBlock): ContentBlock[] {
  const tail = prev[prev.length - 1];
  if (next.type === "text" && tail?.type === "text") {
    const merged: ContentBlock = { ...tail, text: (tail.text ?? "") + (next.text ?? "") };
    return [...prev.slice(0, -1), merged];
  }
  return [...prev, next];
}

/** The single owner of the OMP ACP process, connection, and session state. */
export class AcpService {
  private readonly executable = resolveOmpBinary();
  private readonly sessions = new Map<string, AcpSessionState>();
  private readonly sessionListeners = new Map<string, Set<SessionListener>>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private readonly runningListeners = new Set<RunningListener>();
  private readonly permissionListeners = new Set<PermissionListener>();
  private readonly elicitationListeners = new Set<ElicitationListener>();
  private readonly noticeListeners = new Set<NoticeListener>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly pendingElicitations = new Map<string, PendingElicitation>();
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: ClientConnection | null = null;
  private clientApp: ClientApp | null = null;
  private startup: Promise<void> | null = null;
  private state: AcpConnectionState = "idle";
  private unavailableError: AcpUnavailableError | null = null;
  private cliVersion?: string;
  private imageSupported = false;
  private embeddedContextSupported = false;

  constructor(private readonly options: AcpServiceOptions) {}

  getSnapshot(): AcpConnectionSnapshot {
    return {
      state: this.state,
      executable: this.executable,
      version: this.cliVersion,
      error: this.unavailableError?.message,
      imageSupported: this.imageSupported,
      embeddedContextSupported: this.embeddedContextSupported,
    };
  }

  subscribeConnection(listener: ConnectionListener): Unsubscribe {
    this.connectionListeners.add(listener);
    listener(this.getSnapshot());
    return () => this.connectionListeners.delete(listener);
  }

  subscribeSession(sessionId: string, listener: SessionListener): Unsubscribe {
    const set = this.sessionListeners.get(sessionId) ?? new Set<SessionListener>();
    set.add(listener);
    this.sessionListeners.set(sessionId, set);
    const snapshot = this.sessions.get(sessionId);
    if (snapshot) listener(snapshot);
    return () => set.delete(listener);
  }

  subscribeRunning(listener: RunningListener): Unsubscribe {
    this.runningListeners.add(listener);
    listener(this.runningSessionIds());
    return () => this.runningListeners.delete(listener);
  }

  subscribePermission(listener: PermissionListener): Unsubscribe {
    this.permissionListeners.add(listener);
    return () => this.permissionListeners.delete(listener);
  }

  subscribeElicitation(listener: ElicitationListener): Unsubscribe {
    this.elicitationListeners.add(listener);
    return () => this.elicitationListeners.delete(listener);
  }

  subscribeNotice(listener: NoticeListener): Unsubscribe {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  getSessionSnapshot(sessionId: string): AcpSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  async start(): Promise<void> {
    if (this.state === "ready") return;
    if (this.startup) return this.startup;
    if (this.state === "shutting_down") throw new AcpUnavailableError("OMP ACP is shutting down");
    if (this.unavailableError) throw this.unavailableError;

    this.state = "starting";
    this.publishConnection();
    this.startup = this.openConnection().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.markUnavailable(`OMP ACP unavailable (${this.executable}): ${message}`);
      throw this.unavailableError;
    }).finally(() => {
      this.startup = null;
    });
    return this.startup;
  }

  async retry(): Promise<void> {
    if (this.child) await this.shutdown();
    this.unavailableError = null;
    this.state = "idle";
    await this.start();
  }

  async listSessions(cwd = this.options.cwd): Promise<AcpSessionInfo[]> {
    const ctx = await this.ensureReady();
    const result = await ctx.agent.request(methods.agent.session.list, { cwd }) as { sessions: Array<{ sessionId: string; cwd: string; title?: string | null; updatedAt?: string | null }> };
    return (result.sessions ?? []).map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      title: s.title ?? undefined,
      updatedAt: s.updatedAt ?? undefined,
    }));
  }

  async newSession(cwd: string): Promise<AcpSessionState> {
    const ctx = await this.ensureReady();
    const sessionBuilder = ctx.agent.buildSession(cwd);
    const activeSession = await sessionBuilder.start();
    const response = activeSession.newSessionResponse as {
      sessionId: string;
      modes?: { currentModeId: string; availableModes?: SessionMode[] } | null;
      configOptions?: import("@agentclientprotocol/sdk").SessionConfigOption[] | null;
    };
    return this.registerSession(response.sessionId, cwd, {
      modes: response.modes?.availableModes ?? [],
      configOptions: response.configOptions ?? [],
      currentModeId: response.modes?.currentModeId,
    });
  }

  async loadSession(sessionId: string, cwd: string): Promise<AcpSessionState> {
    const ctx = await this.ensureReady();
    // Preserve any existing messages/toolCalls in the clearing snapshot.
    // omp's `session/load` replays historical events; before those arrive
    // the SDK stashes an intermediate state. If we overwrite our local
    // \`messages\` with [] here and publish, the webview flashes to a
    // blank transcript for the duration of the replay (multi-seconds for
    // long sessions). Kept fields survive because \`registerSession\`
    // reuses existing state when it merges the final response.
    const existing = this.sessions.get(sessionId);
    this.sessions.set(sessionId, {
      ...emptySession(sessionId, cwd),
      messages: existing?.messages ?? [],
      toolCalls: existing?.toolCalls ?? {},
      availableCommands: existing?.availableCommands ?? [],
      plan: existing?.plan ?? [],
      usage: existing?.usage,
      turnUsage: existing?.turnUsage,
      replaying: true,
      revision: (existing?.revision ?? 0) + 1,
    });
    // Skip publishing this transient clearing snapshot. registerSession
    // publishes once at the end with the merged final state; replay-time
    // chunks are already suppressed in updateSession while replaying=true.
    const response = await ctx.agent.request(methods.agent.session.load, { sessionId, cwd, mcpServers: [] } as never) as {
      modes?: { currentModeId: string; availableModes?: SessionMode[] } | null;
      configOptions?: import("@agentclientprotocol/sdk").SessionConfigOption[] | null;
    };
    return this.registerSession(sessionId, cwd, {
      modes: response.modes?.availableModes ?? [],
      configOptions: response.configOptions ?? [],
      currentModeId: response.modes?.currentModeId,
    });
  }

  async resumeSession(sessionId: string, cwd: string): Promise<AcpSessionState> {
    const ctx = await this.ensureReady();
    const response = await ctx.agent.request(methods.agent.session.resume, { sessionId, cwd, mcpServers: [] } as never) as {
      modes?: { currentModeId: string; availableModes?: SessionMode[] } | null;
      configOptions?: import("@agentclientprotocol/sdk").SessionConfigOption[] | null;
    };
    return this.registerSession(sessionId, cwd, {
      modes: response.modes?.availableModes ?? [],
      configOptions: response.configOptions ?? [],
      currentModeId: response.modes?.currentModeId,
    });
  }

  async forkSession(sessionId: string, cwd: string): Promise<AcpSessionState> {
    const ctx = await this.ensureReady();
    const response = await ctx.agent.request(methods.agent.session.fork, { sessionId, cwd }) as {
      sessionId: string;
      modes?: { currentModeId: string; availableModes?: SessionMode[] } | null;
    };
    return this.loadSession(response.sessionId, cwd);
  }

  async closeSession(sessionId: string): Promise<void> {
    const ctx = await this.ensureReady();
    this.cancelInteractionsForSession(sessionId);
    await ctx.agent.request(methods.agent.session.close, { sessionId });
    this.sessions.delete(sessionId);
    this.sessionListeners.delete(sessionId);
    this.publishRunning();
  }

  async prompt(sessionId: string, prompt: ContentBlock[]): Promise<void> {
    const ctx = await this.ensureReady();
    // Self-heal: if this session isn't registered (the background attach
    // failed — e.g. it raced the connection startup — or the omp process
    // was restarted and lost its in-memory sessions), load it now instead
    // of failing the send with "Session … not found". session/load is
    // idempotent for an already-open session.
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.loadSession(sessionId, this.options.cwd);
    }
    if (session.promptPending) throw new AcpUnavailableError("A prompt is already running for this session");
    // omp does NOT echo the user's prompt back as a user_message_chunk for
    // a live turn (verified against acp-event-mapper: chunks only replay
    // during session/load). Append it to the canonical transcript here —
    // same as the TUI, which paints the user message immediately on
    // submit. This guarantees ordering (user row precedes the streaming
    // assistant) and lets the webview clear its optimistic slot as soon as
    // this snapshot lands.
    this.updateSession(sessionId, {
      promptPending: true,
      error: undefined,
      stopReason: undefined,
      messages: [...session.messages, { id: crypto.randomUUID(), role: "user", content: prompt }],
    });
    try {
      const promptResponse = await ctx.agent.request(methods.agent.session.prompt, { sessionId, prompt }) as {
        stopReason?: string;
        // PromptResponse.usage exists but is CUMULATIVE session totals with
        // input/output token counts — NOT the context-window usage the
        // ring displays. That comes from the `usage_update` session-update
        // event only. Ignore this field to avoid two writers stomping the
        // same state.usage slot.
      };
      this.updateSession(sessionId, {
        promptPending: false,
        stopReason: promptResponse.stopReason,
      });
    } catch (error) {
      this.updateSession(sessionId, {
        promptPending: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    // omp's ACP surface has no session/delete handler; JSONL removal is authoritative and
    // performed by the host-side sessionDelete handler. We only need to clean up in-memory state here.
    this.cancelInteractionsForSession(sessionId);
    this.sessions.delete(sessionId);
    this.sessionListeners.delete(sessionId);
    this.publishRunning();
  }

  async cancelPrompt(sessionId: string): Promise<void> {
    const ctx = await this.ensureReady();
    this.cancelInteractionsForSession(sessionId);
    await ctx.agent.notify(methods.agent.session.cancel, { sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const ctx = await this.ensureReady();
    await ctx.agent.request(methods.agent.session.setMode, { sessionId, modeId });
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const ctx = await this.ensureReady();
    const request = typeof value === "boolean"
      ? { sessionId, configId, type: "boolean" as const, value }
      : { sessionId, configId, value };
    const response = await ctx.agent.request(methods.agent.session.setConfigOption, request as never) as { configOptions?: import("@agentclientprotocol/sdk").SessionConfigOption[] };
    this.updateSession(sessionId, { configOptions: response.configOptions ?? [] });
  }

  async extMethod<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const ctx = await this.ensureReady();
    // Ext methods live outside the typed `methods.agent.*` set — omp exposes `_omp/*` and
    // similar names. The SDK routes them via `agent.request(method, params)`; extMethod is
    // the legacy alias but still available. Use request so params typing is honored.
    const response = await ctx.agent.request(method as never, params as never);
    return response as unknown as T;
  }

  respondPermission(resolverId: string, optionId?: string): void {
    const pending = this.pendingPermissions.get(resolverId);
    if (!pending) throw new AcpUnavailableError(`Permission request ${resolverId} has expired`);
    this.pendingPermissions.delete(resolverId);
    pending.resolve({ outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } });
  }

  respondElicitation(resolverId: string, response: CreateElicitationResponse): void {
    const pending = this.pendingElicitations.get(resolverId);
    if (!pending) throw new AcpUnavailableError(`Elicitation request ${resolverId} has expired`);
    this.pendingElicitations.delete(resolverId);
    pending.resolve(response);
  }

  async shutdown(): Promise<void> {
    if (this.state === "idle") return;
    this.state = "shutting_down";
    this.publishConnection();
    this.cancelAllInteractions();
    const conn = this.connection;
    const child = this.child;
    if (conn) {
      await Promise.allSettled(
        [...this.sessions.keys()].map((sid) => conn.agent.request(methods.agent.session.close, { sessionId: sid })),
      ).catch(() => { /* ignore close errors during shutdown */ });
    }
    this.connection = null;
    this.clientApp = null;
    this.child = null;
    if (conn) conn.close();
    if (child) {
      child.stdin.end();
      await this.waitForExit(child, GRACEFUL_SHUTDOWN_MS);
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await this.waitForExit(child, GRACEFUL_SHUTDOWN_MS);
      }
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    this.sessions.clear();
    this.state = "idle";
    this.publishConnection();
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireConnection(): ClientConnection {
    if (this.state !== "ready" || !this.connection) {
      throw new AcpUnavailableError("OMP ACP is not connected");
    }
    return this.connection;
  }

  /** Await connection readiness instead of throwing. Session ops arriving
   *  during startup (webview restore races the `omp acp` spawn/handshake by
   *  design — extension.ts kicks `start()` off without awaiting) queue on
   *  the in-flight startup promise rather than failing with "not
   *  connected", which previously left the session unattached and made the
   *  NEXT op fail with "Session … not found". */
  private async ensureReady(): Promise<ClientConnection> {
    if (this.state !== "ready" || !this.connection) await this.start();
    return this.requireConnection();
  }

  private requireSession(sessionId: string): AcpSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AcpUnavailableError(`Session ${sessionId} not found`);
    return session;
  }

  private async openConnection(): Promise<void> {
    const bin = this.executable;
    this.log(`Starting ${bin} acp...`);
    const child = spawn(bin, ["acp"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.state = "starting";
    this.publishConnection();

    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;

    const onStderr = (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) this.options.output(`[omp stderr] ${line}`);
    };
    stderr?.on("data", onStderr);

    // Create streams from Node.js streams
    const readable = new ReadableStream({
      start: (controller) => {
        stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        stdout.on("end", () => controller.close());
        stdout.on("error", (err: Error) => controller.error(err));
      },
    });

    const writable = new WritableStream({
      write: (chunk: Uint8Array) => {
        stdin.write(Buffer.from(chunk));
      },
    });

    const stream = ndJsonStream(writable, readable);

    const app = client({ name: this.options.clientName });
    this.clientApp = app;

    // Register client-side handlers for permission and elicitation
    app.onRequest(methods.client.session.requestPermission, async ({ params }) => {
      if (!params) throw new Error("Permission request missing params");
      const resolverId = crypto.randomUUID();
      const pending: PendingPermission = {
        sessionId: params.sessionId,
        resolve: () => {}, // Will be called externally
      };
      this.pendingPermissions.set(resolverId, pending);
      const permissionRequest: AcpPermissionRequest = {
        resolverId,
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: params.toolCall?.toolCallId ?? "",
          title: params.toolCall?.title ?? undefined,
          kind: params.toolCall?.kind ?? undefined,
          status: params.toolCall?.status ?? undefined,
        },
        options: (params.options ?? []).map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind,
        })),
      };
      for (const l of this.permissionListeners) {
        try { l(permissionRequest); } catch { /* ignore */ }
      }
      return new Promise((resolve) => {
        pending.resolve = resolve;
      });
    });

    app.onRequest(methods.client.elicitation.create, async ({ params }) => {
      if (!params) throw new Error("Elicitation request missing params");
      const resolverId = crypto.randomUUID();
      const pending: PendingElicitation = {
        sessionId: (params as { sessionId?: string }).sessionId,
        resolve: () => {},
      };
      this.pendingElicitations.set(resolverId, pending);
      const elicitationRequest: AcpElicitationRequest = {
        resolverId,
        sessionId: (params as { sessionId?: string }).sessionId,
        request: params,
      };
      for (const l of this.elicitationListeners) {
        try { l(elicitationRequest); } catch { /* ignore */ }
      }
      return new Promise((resolve) => {
        pending.resolve = resolve;
      });
    });

    app.onNotification(methods.client.session.update, ({ params }) => {
      if (!params?.sessionId || !params.update) return;
      this.handleSessionUpdate(params.sessionId, params.update);
    });

    const conn = app.connect(stream);
    this.connection = conn;

    // Initialize and collect session info
    try {
      const initResult = await conn.agent.request(methods.agent.initialize, {}) as {
        serverInfo?: { version?: string };
        capabilities?: { attachments?: { read?: boolean }; context?: { embed?: boolean } };
        sessions?: Record<string, { cwd?: string; title?: string | null; updatedAt?: string | null }>;
      };
      this.cliVersion = initResult.serverInfo?.version;
      this.imageSupported = !!initResult.capabilities?.attachments?.read;
      this.embeddedContextSupported = !!initResult.capabilities?.context?.embed;

      // Process initial session list
      if (initResult.sessions) {
        for (const [sid, info] of Object.entries(initResult.sessions)) {
          if (info) {
            this.handleSessionInfoUpdate({
              sessionId: sid,
              cwd: info.cwd ?? this.options.cwd,
              title: info.title ?? undefined,
              updatedAt: info.updatedAt ?? undefined,
            });
          }
        }
      }

      // Allow bootstrap notifications to settle
      await new Promise<void>((r) => setTimeout(r, ACP_BOOTSTRAP_RACE_GUARD_MS));

      this.state = "ready";
      this.publishConnection();
      this.log("ACP ready");
    } catch (err) {
      throw err;
    }
  }

  private updateSession(sessionId: string, patch: Partial<AcpSessionState>): AcpSessionState {
    const existing = this.sessions.get(sessionId);
    if (!existing) return existing!;
    const next: AcpSessionState = {
      ...existing,
      ...patch,
      revision: existing.revision + 1,
    };
    this.sessions.set(sessionId, next);
    // Skip publishing during ACP replay. omp streams every historic message
    // as its own `session/update` event during `session/load`; publishing
    // each one triggers an O(N) webview re-render, so a 200-message session
    // burns 200×N =~ 40k re-renders before the transcript is even visible.
    // `registerSession` publishes ONCE with the merged state after replay.
    if (!next.replaying) this.publishSession(sessionId);
    return next;
  }

  private registerSession(
    sessionId: string,
    cwd: string,
    init: {
      modes?: SessionMode[];
      configOptions?: import("@agentclientprotocol/sdk").SessionConfigOption[];
      currentModeId?: string;
    },
  ): AcpSessionState {
    const existing = this.sessions.get(sessionId);
    const state: AcpSessionState = {
      sessionId,
      cwd,
      messages: existing?.messages ?? [],
      toolCalls: existing?.toolCalls ?? {},
      availableCommands: existing?.availableCommands ?? [],
      availableModes: init.modes?.map((m) => ({ id: m.id, name: m.name, description: m.description })) ?? existing?.availableModes ?? [],
      configOptions: init.configOptions ?? existing?.configOptions ?? [],
      plan: existing?.plan ?? [],
      revision: (existing?.revision ?? 0) + 1,
      usage: existing?.usage,
      turnUsage: existing?.turnUsage,
      stopReason: existing?.stopReason,
      loaded: true,
      replaying: false,
      promptPending: false,
      currentMode: init.currentModeId ?? existing?.currentMode,
    };
    this.sessions.set(sessionId, state);
    this.publishSession(sessionId);
    this.publishRunning();
    return state;
  }

  private handleSessionUpdate(sessionId: string, update: import("@agentclientprotocol/sdk").SessionUpdate): void {
    const patch: Partial<AcpSessionState> = {};

    if (isSessionNotice(update)) {
      const notice = readSessionNotice(update);
      if (notice) this.emitSessionNotice(sessionId, notice);
      this.updateSession(sessionId, patch);
      return;
    }

    // Handle different update types
    switch (update.sessionUpdate) {
      case "user_message_chunk":
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const content = update.content;
        const existing = this.sessions.get(sessionId);
        if (existing) {
          const newMessages = [...existing.messages];
          // Role each chunk into its own bucket: user text, assistant
          // visible answer, or assistant "thought" (chain-of-thought that
          // the UI wraps in a collapsible Thinking block). Coalesce chunks
          // sharing a messageId; when omp forgets to send messageId, fall
          // back to the last message of the SAME role so we don't push a
          // new row per chunk.
          const targetRole: "user" | "assistant" | "thought" =
            update.sessionUpdate === "user_message_chunk" ? "user"
            : update.sessionUpdate === "agent_thought_chunk" ? "thought"
            : "assistant";
          const msgIdx = update.messageId
            ? newMessages.findIndex((m) => m.id === update.messageId && m.role === targetRole)
            : newMessages.findLastIndex((m) => m.role === targetRole);
          if (msgIdx >= 0) {
            const prev = newMessages[msgIdx];
            if (prev.role !== "toolCall") {
              newMessages[msgIdx] = { ...prev, content: mergeContentBlocks(prev.content, content) };
            }
          } else {
            newMessages.push({ id: update.messageId ?? crypto.randomUUID(), role: targetRole, content: [content] });
          }
          patch.messages = newMessages;
        }
        break;
      }
      case "tool_call": {
        const tc = update as ToolCall & { sessionUpdate: "tool_call" };
        const existing = this.sessions.get(sessionId);
        const toolCalls = existing?.toolCalls ?? {};
        patch.toolCalls = { ...toolCalls, [tc.toolCallId]: toToolCallEntry(tc) };
        if (existing && !existing.messages.some((message) => message.role === "toolCall" && message.toolCallId === tc.toolCallId)) {
          patch.messages = [...existing.messages, { id: `tool-${tc.toolCallId}`, role: "toolCall", toolCallId: tc.toolCallId, content: [] }];
        }
        break;
      }
      case "tool_call_update": {
        const tcu = update as ToolCallUpdate & { sessionUpdate: "tool_call_update" };
        const toolCalls = this.sessions.get(sessionId)?.toolCalls ?? {};
        const existingTc = toolCalls[tcu.toolCallId];
        if (existingTc) {
          const merged = toToolCallEntry({ ...existingTc, title: tcu.title ?? existingTc.title, kind: tcu.kind ?? existingTc.kind, status: tcu.status ?? existingTc.status, name: tcu.name ?? existingTc.name, content: tcu.content ?? existingTc.content, locations: tcu.locations ?? undefined, rawInput: tcu.rawInput ?? existingTc.rawInput, rawOutput: tcu.rawOutput ?? existingTc.rawOutput });
          patch.toolCalls = { ...toolCalls, [tcu.toolCallId]: merged };
        }
        break;
      }
      case "plan": {
        const plan = update as import("@agentclientprotocol/sdk").Plan & { sessionUpdate: "plan" };
        patch.plan = plan.entries ?? [];
        break;
      }
      case "plan_update": {
        const pu = update as import("@agentclientprotocol/sdk").PlanUpdate & { sessionUpdate: "plan_update" };
        // PlanUpdateContent can be PlanItems, PlanFile, or PlanMarkdown
        if ("entries" in (pu.plan as object)) {
          patch.plan = ((pu.plan as { entries?: import("@agentclientprotocol/sdk").PlanEntry[] }).entries ?? []) as import("@agentclientprotocol/sdk").PlanEntry[];
        }
        break;
      }
      case "plan_removed": {
        patch.plan = [];
        break;
      }
      case "available_commands_update": {
        const acu = update as import("@agentclientprotocol/sdk").AvailableCommandsUpdate & { sessionUpdate: "available_commands_update" };
        patch.availableCommands = acu.availableCommands ?? [];
        break;
      }
      case "current_mode_update": {
        const cmu = update as import("@agentclientprotocol/sdk").CurrentModeUpdate & { sessionUpdate: "current_mode_update" };
        patch.currentMode = cmu.currentModeId;
        break;
      }
      case "config_option_update": {
        const cou = update as import("@agentclientprotocol/sdk").ConfigOptionUpdate & { sessionUpdate: "config_option_update" };
        patch.configOptions = cou.configOptions ?? [];
        break;
      }
      case "session_info_update": {
        const siu = update as import("@agentclientprotocol/sdk").SessionInfoUpdate & { sessionUpdate: "session_info_update" };
        if (siu.title) patch.title = siu.title;
        if (siu.updatedAt) patch.updatedAt = siu.updatedAt;
        break;
      }
      case "usage_update": {
        // Ground truth from SDK schema + omp emitter (acp-agent.ts
        // #emitEndOfTurnUpdates):
        //   used: number (tokens currently in context)
        //   size: number (model.contextWindow)
        // Both fields are guaranteed by the schema and by omp's use of
        // `getContextUsage()` — no need for optional/`?? 0` defaults here.
        const uu = update as import("@agentclientprotocol/sdk").UsageUpdate & { sessionUpdate: "usage_update" };
        patch.usage = { used: uu.used, contextWindow: uu.size };
        break;
      }
    }

    this.updateSession(sessionId, patch);
  }

  private handleSessionInfoUpdate(info: { sessionId: string; cwd: string; title?: string; updatedAt?: string }): void {
    const existing = this.sessions.get(info.sessionId);
    if (!existing) return;
    this.updateSession(info.sessionId, {
      cwd: info.cwd,
      title: info.title,
      updatedAt: info.updatedAt,
    });
  }

  private cancelInteractionsForSession(sessionId: string): void {
    for (const [rid, p] of this.pendingPermissions) {
      if (p.sessionId === sessionId) {
        this.pendingPermissions.delete(rid);
        p.resolve({ outcome: { outcome: "cancelled" } });
      }
    }
    for (const [rid, p] of this.pendingElicitations) {
      if (p.sessionId === sessionId) {
        this.pendingElicitations.delete(rid);
        p.resolve({ action: "cancel" } as CreateElicitationResponse);
      }
    }
  }

  private cancelAllInteractions(): void {
    for (const [rid, p] of this.pendingPermissions) {
      this.pendingPermissions.delete(rid);
      p.resolve({ outcome: { outcome: "cancelled" } });
    }
    for (const [rid, p] of this.pendingElicitations) {
      this.pendingElicitations.delete(rid);
      p.resolve({ action: "cancel" } as CreateElicitationResponse);
    }
  }

  private markUnavailable(message: string): void {
    this.unavailableError = new AcpUnavailableError(message);
    this.state = "unavailable";
    // Fix: create new objects, don't mutate in place.
    for (const [sid, session] of this.sessions) {
      this.sessions.set(sid, { ...session, promptPending: false });
    }
    this.publishConnection();
    for (const sid of this.sessions.keys()) {
      this.publishSession(sid);
    }
  }

  private publishConnection(): void {
    const snapshot = this.getSnapshot();
    for (const l of this.connectionListeners) {
      try { l(snapshot); } catch { /* ignore */ }
    }
  }

  private publishSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      for (const l of listeners) {
        try { l(state); } catch { /* ignore */ }
      }
    }
  }

  private runningSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  private publishRunning(): void {
    const ids = this.runningSessionIds();
    for (const l of this.runningListeners) {
      try { l(ids); } catch { /* ignore */ }
    }
  }

  private emitSessionNotice(sessionId: string, notice: { level: NoticeLevel; message: string }): void {
    for (const listener of this.noticeListeners) {
      try { listener(sessionId, notice.level, notice.message); } catch { /* ignore */ }
    }
  }

  private log(line: string): void {
    this.options.output(line);
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), ms);
      const onExit = () => { clearTimeout(timer); resolve(); };
      child.once("exit", onExit);
      child.once("error", onExit);
    });
  }
}
