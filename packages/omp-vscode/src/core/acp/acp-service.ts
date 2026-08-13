import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientConnection,
  type ContentBlock,
  type CreateElicitationResponse,
  type InitializeResponse,
  type SessionMode,
  type ToolCall,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { resolveOmpBinary } from "../omp-binary";
import type {
  AcpCapabilitySnapshot,
  AcpConnectionSnapshot,
  AcpConnectionState,
  AcpElicitationRequest,
  AcpPermissionRequest,
  AcpSessionInfo,
  AcpSessionState,
} from "./protocol";

const GRACEFUL_SHUTDOWN_MS = 2_000;

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
type NoticeListener = (
  sessionId: string,
  level: NoticeLevel,
  message: string
) => void;

function readSessionNotice(
  update: unknown
): { level: NoticeLevel; message: string } | null {
  if (typeof update !== "object" || update === null) return null;
  const message =
    "text" in update && typeof update.text === "string"
      ? update.text
      : "message" in update && typeof update.message === "string"
        ? update.message
        : null;
  if (!message) return null;
  const level = "level" in update ? update.level : undefined;
  return {
    level:
      level === "success" || level === "warning" || level === "error"
        ? level
        : "info",
    message,
  };
}

function isSessionNotice(update: unknown): boolean {
  return (
    typeof update === "object" &&
    update !== null &&
    "sessionUpdate" in update &&
    (update.sessionUpdate === "notification" ||
      update.sessionUpdate === "notice")
  );
}

interface PendingPermission {
  sessionId: string;
  resolve: (response: {
    outcome:
      { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  }) => void;
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
  messagesRevision: 0,
  toolCallsRevision: 0,
  commandsRevision: 0,
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
function mergeContentBlocks(
  prev: readonly ContentBlock[],
  next: ContentBlock
): ContentBlock[] {
  const tail = prev[prev.length - 1];
  if (next.type === "text" && tail?.type === "text") {
    const merged: ContentBlock = {
      ...tail,
      text: (tail.text ?? "") + (next.text ?? ""),
    };
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
  private readonly messageIndex = new Map<string, Map<string, number>>();
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
  private capabilities: AcpCapabilitySnapshot | null = null;

  constructor(private readonly options: AcpServiceOptions) {}

  getSnapshot(): AcpConnectionSnapshot {
    return {
      state: this.state,
      executable: this.executable,
      version: this.capabilities?.agentInfo?.version ?? this.cliVersion,
      error: this.unavailableError?.message,
      capabilities: this.capabilities,
    };
  }

  getCapabilities(): AcpCapabilitySnapshot | null {
    return this.capabilities;
  }

  subscribeConnection(listener: ConnectionListener): Unsubscribe {
    this.connectionListeners.add(listener);
    listener(this.getSnapshot());
    return () => this.connectionListeners.delete(listener);
  }

  subscribeSession(sessionId: string, listener: SessionListener): Unsubscribe {
    const set =
      this.sessionListeners.get(sessionId) ?? new Set<SessionListener>();
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
    if (this.state === "shutting_down")
      throw new AcpUnavailableError("OMP ACP is shutting down");
    if (this.unavailableError) throw this.unavailableError;

    this.state = "starting";
    this.publishConnection();
    this.startup = this.openConnection()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.markUnavailable(
          `OMP ACP unavailable (${this.executable}): ${message}`
        );
        throw this.unavailableError;
      })
      .finally(() => {
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
    this.requireCapability((c) => c.sessions.list, "session/list");
    const ctx = await this.ensureReady();
    const result = (await ctx.agent.request(methods.agent.session.list, {
      cwd,
    })) as {
      sessions: Array<{
        sessionId: string;
        cwd: string;
        title?: string | null;
        updatedAt?: string | null;
      }>;
    };
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
      configOptions?:
        import("@agentclientprotocol/sdk").SessionConfigOption[] | null;
    };
    return this.registerSession(response.sessionId, cwd, {
      modes: response.modes?.availableModes ?? [],
      configOptions: response.configOptions ?? [],
      currentModeId: response.modes?.currentModeId,
    });
  }

  async loadSession(sessionId: string, cwd: string): Promise<AcpSessionState> {
    this.requireCapability((c) => c.loadSession, "session/load");
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
      replaying: true,
      revision: (existing?.revision ?? 0) + 1,
      messagesRevision: existing?.messagesRevision ?? 0,
      toolCallsRevision: existing?.toolCallsRevision ?? 0,
      commandsRevision: existing?.commandsRevision ?? 0,
    });
    // Skip publishing this transient clearing snapshot. registerSession
    // publishes once at the end with the merged final state; replay-time
    // chunks are already suppressed in updateSession while replaying=true.
    const response = (await ctx.agent.request(methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: [],
    } as never)) as {
      modes?: { currentModeId: string; availableModes?: SessionMode[] } | null;
      configOptions?:
        import("@agentclientprotocol/sdk").SessionConfigOption[] | null;
    };
    return this.registerSession(sessionId, cwd, {
      modes: response.modes?.availableModes ?? [],
      configOptions: response.configOptions ?? [],
      currentModeId: response.modes?.currentModeId,
    });
  }

  async resumeSession(
    sessionId: string,
    cwd: string
  ): Promise<AcpSessionState> {
    this.requireCapability((c) => c.sessions.resume, "session/resume");
    const ctx = await this.ensureReady();
    const response = (await ctx.agent.request(methods.agent.session.resume, {
      sessionId,
      cwd,
      mcpServers: [],
    } as never)) as {
      modes?: { currentModeId: string; availableModes?: SessionMode[] } | null;
      configOptions?:
        import("@agentclientprotocol/sdk").SessionConfigOption[] | null;
    };
    return this.registerSession(sessionId, cwd, {
      modes: response.modes?.availableModes ?? [],
      configOptions: response.configOptions ?? [],
      currentModeId: response.modes?.currentModeId,
    });
  }

  async forkSession(sessionId: string, cwd: string): Promise<AcpSessionState> {
    this.requireCapability((c) => c.sessions.fork, "session/fork");
    const ctx = await this.ensureReady();
    const response = (await ctx.agent.request(methods.agent.session.fork, {
      sessionId,
      cwd,
    })) as {
      sessionId: string;
      modes?: { currentModeId: string; availableModes?: SessionMode[] } | null;
    };
    return this.loadSession(response.sessionId, cwd);
  }

  async closeSession(sessionId: string): Promise<void> {
    this.requireCapability((c) => c.sessions.close, "session/close");
    const ctx = await this.ensureReady();
    this.cancelInteractionsForSession(sessionId);
    await ctx.agent.request(methods.agent.session.close, { sessionId });
    this.sessions.delete(sessionId);
    this.sessionListeners.delete(sessionId);
    this.messageIndex.delete(sessionId);
    this.publishRunning();
  }

  async prompt(sessionId: string, prompt: ContentBlock[]): Promise<void> {
    const ctx = await this.ensureReady();
    if (prompt.some((block) => block.type === "image")) {
      this.requireCapability(
        (c) => c.prompts.image,
        "image prompts (promptCapabilities.image)"
      );
    }
    if (prompt.some((block) => block.type === "audio")) {
      this.requireCapability(
        (c) => c.prompts.audio,
        "audio prompts (promptCapabilities.audio)"
      );
    }
    if (
      prompt.some(
        (block) => block.type === "resource" || block.type === "resource_link"
      )
    ) {
      this.requireCapability(
        (c) => c.prompts.embeddedContext,
        "embedded context (promptCapabilities.embeddedContext)"
      );
    }
    // Self-heal: if this session isn't registered (the background attach
    // failed — e.g. it raced the connection startup — or the omp process
    // was restarted and lost its in-memory sessions), load it now instead
    // of failing the send with "Session … not found". session/load is
    // idempotent for an already-open session.
    let session = this.sessions.get(sessionId);
    if (!session) session = await this.loadSession(sessionId, this.options.cwd);
    const patch: Partial<AcpSessionState> = {
      promptPending: true,
      error: undefined,
      stopReason: undefined,
    };
    // OMP echoes queued user messages. Avoid a duplicate local row while
    // an existing prompt is still in flight.
    if (!session.promptPending) {
      patch.messages = [
        ...session.messages,
        { id: crypto.randomUUID(), role: "user", content: prompt },
      ];
    }
    this.updateSession(sessionId, patch);
    try {
      const promptResponse = (await ctx.agent.request(
        methods.agent.session.prompt,
        { sessionId, prompt }
      )) as { stopReason?: string };
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
    this.messageIndex.delete(sessionId);
  }

  async cancelPrompt(sessionId: string): Promise<void> {
    const ctx = await this.ensureReady();
    this.cancelInteractionsForSession(sessionId);
    await ctx.agent.notify(methods.agent.session.cancel, { sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const ctx = await this.ensureReady();
    await ctx.agent.request(methods.agent.session.setMode, {
      sessionId,
      modeId,
    });
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<void> {
    const ctx = await this.ensureReady();
    const request =
      typeof value === "boolean"
        ? { sessionId, configId, type: "boolean" as const, value }
        : { sessionId, configId, value };
    const response = (await ctx.agent.request(
      methods.agent.session.setConfigOption,
      request as never
    )) as {
      configOptions?: import("@agentclientprotocol/sdk").SessionConfigOption[];
    };
    this.updateSession(sessionId, {
      configOptions: response.configOptions ?? [],
    });
  }

  async extMethod<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const ctx = await this.ensureReady();
    // Ext methods live outside the typed `methods.agent.*` set — omp exposes `_omp/*` and
    // similar names. The SDK routes them via `agent.request(method, params)`; extMethod is
    // the legacy alias but still available. Use request so params typing is honored.
    const response = await ctx.agent.request(method as never, params as never);
    return response as unknown as T;
  }

  respondPermission(resolverId: string, optionId?: string): void {
    const pending = this.pendingPermissions.get(resolverId);
    if (!pending)
      throw new AcpUnavailableError(
        `Permission request ${resolverId} has expired`
      );
    this.pendingPermissions.delete(resolverId);
    pending.resolve({
      outcome: optionId
        ? { outcome: "selected", optionId }
        : { outcome: "cancelled" },
    });
  }

  respondElicitation(
    resolverId: string,
    response: CreateElicitationResponse
  ): void {
    const pending = this.pendingElicitations.get(resolverId);
    if (!pending)
      throw new AcpUnavailableError(
        `Elicitation request ${resolverId} has expired`
      );
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
        [...this.sessions.keys()].map((sid) =>
          conn.agent.request(methods.agent.session.close, { sessionId: sid })
        )
      ).catch(() => {
        /* ignore close errors during shutdown */
      });
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
    if (!session)
      throw new AcpUnavailableError(`Session ${sessionId} not found`);
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
        stdout.on("data", (chunk: Buffer) =>
          controller.enqueue(new Uint8Array(chunk))
        );
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
    app.onRequest(
      methods.client.session.requestPermission,
      async ({ params }) => {
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
          try {
            l(permissionRequest);
          } catch {
            /* ignore */
          }
        }
        return new Promise((resolve) => {
          pending.resolve = resolve;
        });
      }
    );

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
        try {
          l(elicitationRequest);
        } catch {
          /* ignore */
        }
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

    const initResponse = await conn.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: this.options.clientName,
        version: this.options.clientVersion,
      },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        elicitation: { form: {} },
      },
    });
    this.capabilities = this.buildCapabilitySnapshot(initResponse);
    this.cliVersion = this.capabilities.agentInfo?.version;
    this.state = "ready";
    this.publishConnection();
    this.log(
      `ACP ready (protocol v${this.capabilities.protocolVersion}, agent ${this.capabilities.agentInfo?.name ?? "unknown"}@${this.capabilities.agentInfo?.version ?? "?"})`
    );
  }

  private buildCapabilitySnapshot(
    res: InitializeResponse
  ): AcpCapabilitySnapshot {
    const agentCapabilities = res.agentCapabilities;
    const promptCapabilities = agentCapabilities?.promptCapabilities;
    const sessionCapabilities = agentCapabilities?.sessionCapabilities;
    const mcpCapabilities = agentCapabilities?.mcpCapabilities;
    if (!agentCapabilities)
      this.log(
        "ACP initialize response omitted agent capabilities; defaulting optional features to false"
      );
    return {
      protocolVersion: res.protocolVersion,
      agentInfo: res.agentInfo
        ? {
            name: res.agentInfo.name,
            title: res.agentInfo.title ?? undefined,
            version: res.agentInfo.version,
          }
        : null,
      authMethods: res.authMethods ?? [],
      loadSession: agentCapabilities?.loadSession === true,
      prompts: {
        image: promptCapabilities?.image === true,
        audio: promptCapabilities?.audio === true,
        embeddedContext: promptCapabilities?.embeddedContext === true,
      },
      sessions: {
        list: sessionCapabilities?.list != null,
        delete: sessionCapabilities?.delete != null,
        fork: sessionCapabilities?.fork != null,
        resume: sessionCapabilities?.resume != null,
        close: sessionCapabilities?.close != null,
        additionalDirectories:
          sessionCapabilities?.additionalDirectories != null,
      },
      mcp: {
        http: mcpCapabilities?.http === true,
        sse: mcpCapabilities?.sse === true,
      },
      elicitation: { form: true, url: false },
    };
  }

  private requireCapability(
    check: (c: AcpCapabilitySnapshot) => boolean,
    name: string
  ): AcpCapabilitySnapshot {
    const capabilities = this.capabilities;
    if (!capabilities) throw new AcpUnavailableError("ACP not initialized");
    if (!check(capabilities))
      throw new AcpUnavailableError(`Agent does not advertise ${name}`);
    return capabilities;
  }

  private updateSession(
    sessionId: string,
    patch: Partial<AcpSessionState>
  ): AcpSessionState {
    const existing = this.sessions.get(sessionId);
    if (!existing) return existing!;
    // Bump partition revisions only when the specific ref changed.
    // Webview compares these numbers (survive postMessage's structured
    // clone) to skip work on updates that don't touch that partition.
    const messagesChanged =
      patch.messages !== undefined && patch.messages !== existing.messages;
    const toolCallsChanged =
      patch.toolCalls !== undefined && patch.toolCalls !== existing.toolCalls;
    const commandsChanged =
      patch.availableCommands !== undefined &&
      patch.availableCommands !== existing.availableCommands;
    const next: AcpSessionState = {
      ...existing,
      ...patch,
      revision: existing.revision + 1,
      messagesRevision:
        existing.messagesRevision + (messagesChanged ? 1 : 0),
      toolCallsRevision:
        existing.toolCallsRevision + (toolCallsChanged ? 1 : 0),
      commandsRevision:
        existing.commandsRevision + (commandsChanged ? 1 : 0),
    };
    this.sessions.set(sessionId, next);
    if (existing.promptPending !== next.promptPending) this.publishRunning();
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
    }
  ): AcpSessionState {
    const existing = this.sessions.get(sessionId);
    const state: AcpSessionState = {
      sessionId,
      cwd,
      messages: existing?.messages ?? [],
      toolCalls: existing?.toolCalls ?? {},
      availableCommands: existing?.availableCommands ?? [],
      availableModes:
        init.modes?.map((mode) => ({
          id: mode.id,
          name: mode.name,
          description: mode.description,
        })) ??
        existing?.availableModes ??
        [],
      configOptions: init.configOptions ?? existing?.configOptions ?? [],
      plan: existing?.plan ?? [],
      revision: (existing?.revision ?? 0) + 1,
      messagesRevision: (existing?.messagesRevision ?? 0) + 1,
      toolCallsRevision: (existing?.toolCallsRevision ?? 0) + 1,
      commandsRevision: (existing?.commandsRevision ?? 0) + 1,
      usage: existing?.usage,
      stopReason: existing?.stopReason,
      loaded: true,
      replaying: false,
      promptPending: false,
      currentMode: init.currentModeId ?? existing?.currentMode,
    };
    this.sessions.set(sessionId, state);
    this.messageIndex.delete(sessionId);
    this.publishSession(sessionId);
    this.publishRunning();
    return state;
  }

  private handleSessionUpdate(
    sessionId: string,
    update: import("@agentclientprotocol/sdk").SessionUpdate
  ): void {
    const patch: Partial<AcpSessionState> = {};
    // Compact one-line trace of every ACP session/update. Includes the
    // update kind, session prefix, and any messageId/toolCallId when
    // present — enough to spot duplicates ("agent_message_chunk × 30
    // sharing messageId=abcd") and out-of-order events. Kept lightweight:
    // no JSON.stringify of payload.
    const meta: string[] = [];
    if ("messageId" in update && typeof update.messageId === "string") {
      meta.push(`mid=${update.messageId.slice(0, 8)}`);
    }
    if ("toolCallId" in update && typeof update.toolCallId === "string") {
      meta.push(`tid=${update.toolCallId.slice(0, 8)}`);
    }
    if ("status" in update && typeof update.status === "string") {
      meta.push(`st=${update.status}`);
    }
    const stamp = new Date().toISOString().slice(11, 23);
    this.options.output(
      `[${stamp}] [acp/upd] sid=${sessionId.slice(0, 8)} kind=${update.sessionUpdate}${meta.length ? ` ${meta.join(" ")}` : ""}`
    );
    if (isSessionNotice(update)) {
      const notice = readSessionNotice(update);
      if (notice) this.emitSessionNotice(sessionId, notice);
      return;
    }
    switch (update.sessionUpdate) {
      case "user_message_chunk":
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const existing = this.sessions.get(sessionId);
        if (!existing) break;
        const role =
          update.sessionUpdate === "user_message_chunk"
            ? "user"
            : update.sessionUpdate === "agent_thought_chunk"
              ? "thought"
              : "assistant";
        const indexByMessageId =
          this.messageIndex.get(sessionId) ?? new Map<string, number>();
        this.messageIndex.set(sessionId, indexByMessageId);
        const messages = existing.messages.slice();
        // omp reuses the same liveMessageId across an assistant turn's
        // thinking AND text chunks (see reference acp-agent.ts
        // #getLiveMessageId: reset only at message_start / message_end).
        // Key the index by messageId+role so a text chunk doesn't merge
        // into the same-turn thought AcpMessage — that would land the
        // reply text inside the thought row, where toAgentMessage() maps
        // every text block to a thinking block. The visible reply then
        // vanishes and only the "thinking" fold shows.
        const indexKey = update.messageId ? `${update.messageId}:${role}` : "";
        let index = indexKey ? (indexByMessageId.get(indexKey) ?? -1) : -1;
        if (index === -1 && !update.messageId) {
          for (let i = messages.length - 1; i >= 0; i--)
            if (messages[i].role === role) {
              index = i;
              break;
            }
        }
        if (index >= 0) {
          const previous = messages[index];
          // Defensive: never merge across roles even if the caller passed
          // an index we resolved earlier under a different role bucket.
          if (previous.role === role) {
            messages[index] = {
              ...previous,
              content: mergeContentBlocks(previous.content, update.content),
            };
          } else {
            index = -1;
          }
        }
        if (index === -1) {
          const id = update.messageId ?? crypto.randomUUID();
          messages.push({ id, role, content: [update.content] });
          if (indexKey) indexByMessageId.set(indexKey, messages.length - 1);
        }
        patch.messages = messages;
        break;
      }
      case "tool_call": {
        const toolCall = update as ToolCall & { sessionUpdate: "tool_call" };
        const existing = this.sessions.get(sessionId);
        const toolCalls = existing?.toolCalls ?? {};
        patch.toolCalls = {
          ...toolCalls,
          [toolCall.toolCallId]: toToolCallEntry(toolCall),
        };
        if (
          existing &&
          !existing.messages.some(
            (message) =>
              message.role === "toolCall" &&
              message.toolCallId === toolCall.toolCallId
          )
        )
          patch.messages = [
            ...existing.messages,
            {
              id: `tool-${toolCall.toolCallId}`,
              role: "toolCall",
              toolCallId: toolCall.toolCallId,
              content: [],
            },
          ];
        break;
      }
      case "tool_call_update": {
        const delta = update as ToolCallUpdate & {
          sessionUpdate: "tool_call_update";
        };
        const toolCalls = this.sessions.get(sessionId)?.toolCalls ?? {};
        const current = toolCalls[delta.toolCallId];
        if (current)
          patch.toolCalls = {
            ...toolCalls,
            [delta.toolCallId]: toToolCallEntry({
              ...current,
              title: delta.title ?? current.title,
              kind: delta.kind ?? current.kind,
              status: delta.status ?? current.status,
              name: delta.name ?? current.name,
              content: delta.content ?? current.content,
              locations: delta.locations ?? undefined,
              rawInput: delta.rawInput ?? current.rawInput,
              rawOutput: delta.rawOutput ?? current.rawOutput,
            }),
          };
        break;
      }
      case "plan":
        patch.plan =
          (update as import("@agentclientprotocol/sdk").Plan).entries ?? [];
        break;
      case "plan_update": {
        const plan = (update as import("@agentclientprotocol/sdk").PlanUpdate)
          .plan;
        if ("entries" in (plan as object))
          patch.plan =
            (
              plan as {
                entries?: import("@agentclientprotocol/sdk").PlanEntry[];
              }
            ).entries ?? [];
        break;
      }
      case "plan_removed":
        patch.plan = [];
        break;
      case "available_commands_update":
        patch.availableCommands =
          (update as import("@agentclientprotocol/sdk").AvailableCommandsUpdate)
            .availableCommands ?? [];
        break;
      case "current_mode_update":
        patch.currentMode = (
          update as import("@agentclientprotocol/sdk").CurrentModeUpdate
        ).currentModeId;
        break;
      case "config_option_update":
        patch.configOptions =
          (update as import("@agentclientprotocol/sdk").ConfigOptionUpdate)
            .configOptions ?? [];
        break;
      case "session_info_update": {
        const info =
          update as import("@agentclientprotocol/sdk").SessionInfoUpdate;
        if ("title" in info) patch.title = info.title ?? undefined;
        if ("updatedAt" in info) patch.updatedAt = info.updatedAt ?? undefined;
        // Do NOT touch promptPending here. omp emits session_info_update
        // at both bootstrap (#emitBootstrapUpdates) AND end-of-turn
        // (#emitEndOfTurnUpdates). An earlier optimisation flipped
        // promptPending=false on it to shave ~50ms off the "input
        // unblocks after RPC response" gap, but the bootstrap emission
        // (e.g. after session/load right before a fresh prompt) fires
        // AFTER prompt() already set promptPending=true, so it also
        // wrongly flipped mid-turn. The RPC response owns promptPending.
        break;
      }
      case "usage_update": {
        const usage = update as import("@agentclientprotocol/sdk").UsageUpdate;
        patch.usage = { used: usage.used, contextWindow: usage.size };
        break;
      }
    }
    if (
      patch.messages &&
      update.sessionUpdate !== "user_message_chunk" &&
      update.sessionUpdate !== "agent_message_chunk" &&
      update.sessionUpdate !== "agent_thought_chunk"
    )
      this.messageIndex.delete(sessionId);
    this.updateSession(sessionId, patch);
  }

  private handleSessionInfoUpdate(info: {
    sessionId: string;
    cwd: string;
    title?: string;
    updatedAt?: string;
  }): void {
    if (!this.sessions.has(info.sessionId)) return;
    this.updateSession(info.sessionId, {
      cwd: info.cwd,
      title: info.title,
      updatedAt: info.updatedAt,
    });
  }

  private cancelInteractionsForSession(sessionId: string): void {
    for (const [resolverId, pending] of this.pendingPermissions)
      if (pending.sessionId === sessionId) {
        this.pendingPermissions.delete(resolverId);
        pending.resolve({ outcome: { outcome: "cancelled" } });
      }
    for (const [resolverId, pending] of this.pendingElicitations)
      if (pending.sessionId === sessionId) {
        this.pendingElicitations.delete(resolverId);
        pending.resolve({ action: "cancel" } as CreateElicitationResponse);
      }
  }

  private cancelAllInteractions(): void {
    for (const [resolverId, pending] of this.pendingPermissions) {
      this.pendingPermissions.delete(resolverId);
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    for (const [resolverId, pending] of this.pendingElicitations) {
      this.pendingElicitations.delete(resolverId);
      pending.resolve({ action: "cancel" } as CreateElicitationResponse);
    }
  }

  private markUnavailable(message: string): void {
    this.unavailableError = new AcpUnavailableError(message);
    this.state = "unavailable";
    for (const [sessionId, session] of this.sessions) {
      this.sessions.set(sessionId, { ...session, promptPending: false });
      this.messageIndex.delete(sessionId);
    }
    this.publishConnection();
    for (const sessionId of this.sessions.keys())
      this.publishSession(sessionId);
    this.publishRunning();
  }

  private publishConnection(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.connectionListeners)
      try {
        listener(snapshot);
      } catch {
        /* ignore */
      }
  }

  private publishSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    for (const listener of this.sessionListeners.get(sessionId) ?? [])
      try {
        listener(state);
      } catch {
        /* ignore */
      }
  }

  private runningSessionIds(): string[] {
    const out: string[] = [];
    for (const [id, session] of this.sessions)
      if (session.promptPending) out.push(id);
    return out;
  }

  private publishRunning(): void {
    const ids = this.runningSessionIds();
    for (const listener of this.runningListeners)
      try {
        listener(ids);
      } catch {
        /* ignore */
      }
  }

  private emitSessionNotice(
    sessionId: string,
    notice: { level: NoticeLevel; message: string }
  ): void {
    for (const listener of this.noticeListeners) {
      try {
        listener(sessionId, notice.level, notice.message);
      } catch {
        /* ignore */
      }
    }
  }

  private log(line: string): void {
    this.options.output(line);
  }

  private waitForExit(
    child: ChildProcessWithoutNullStreams,
    ms: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), ms);
      const onExit = () => {
        clearTimeout(timer);
        resolve();
      };
      child.once("exit", onExit);
      child.once("error", onExit);
    });
  }
}
