import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { OmpRpcProcess, type RpcEvent } from "./rpc-session";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";

// ============================================================================
// OMP RPC session manager
//
// Replaces the in-process Pi SDK AgentSession with a real Oh My Pi runtime
// spawned as `omp --mode rpc` (one subprocess per session). The public
// surface — AgentSessionWrapper + the registry functions used by the API
// routes — is unchanged, so the webview and HTTP layer need no edits.
//
// Command mapping (wrapper.send → RPC command):
//   prompt/steer/follow_up/abort/get_state/set_model/set_thinking_level/
//   compact/set_session_name/get_session_stats/get_last_assistant_text/
//   set_auto_compaction/set_auto_retry/bash/abort_bash/fork/
//   extension_ui_response  → same name on the RPC protocol
//   get_commands           → get_available_commands (OMP's name)
//   get_tools              → get_state.dumpTools
//   set_tools              → not in RPC; applied at spawn via --tools/--no-tools
//   reload/navigate_tree/clear_queue/abort_compaction/extension_ui_input
//                          → no RPC equivalent; graceful no-op
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  /** Explicit new-session request (sidebar "New Session"): issue the RPC
   * new_session command so omp does NOT resume the cwd's recent session. */
  forceNewSession?: boolean;
}

// Event types that flip the "running" state (used by the sidebar).
const RUNNING_STATE_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "auto_compaction_start",
  "auto_compaction_end",
  "compaction_start",
  "compaction_end",
]);

const IDLE_RESET_EVENT_TYPES = new Set([
  "agent_end",
  "agent_settled",
  "auto_compaction_end",
  "compaction_end",
]);

// ---------------------------------------------------------------------------
// AgentSessionWrapper — RPC-backed session with the same interface the app
// expects (send / onEvent / lifecycle).
// ---------------------------------------------------------------------------

export class AgentSessionWrapper {
  private readonly rpc: OmpRpcProcess;
  private listeners: EventListener[] = [];
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;
  private promptRunning = false;
  private bashRunning = false;
  private compacting = false;
  private autoRetryEnabled: boolean | null = null;
  private queuedMessages: { steering: string[]; followUp: string[] } = {
    steering: [],
    followUp: [],
  };
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<
    string,
    { key: string; lines: string[]; placement: string }
  >();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _sessionId: string;
  private _sessionFile: string;
  private readonly sessionCwd: string;
  private readonly tempKey: string;
  private readonly forceNewSession: boolean;
  private unsubscribeRpc: () => void;

  constructor(
    tempKey: string,
    sessionFile: string,
    cwd: string,
    options: RpcSessionStartOptions = {}
  ) {
    this.tempKey = tempKey;
    this.sessionCwd = cwd;
    this._sessionFile = sessionFile;
    this.forceNewSession = options.forceNewSession === true;

    this.rpc = new OmpRpcProcess({
      cwd,
      ...(sessionFile ? { resume: sessionFile } : {}),
      ...(options.initialModel ? { model: options.initialModel } : {}),
      ...(options.thinkingLevel
        ? { thinkingLevel: options.thinkingLevel }
        : {}),
      ...(options.toolNames ? { toolNames: options.toolNames } : {}),
    });
    this._sessionId = "";

    this.unsubscribeRpc = this.rpc.onEvent((event) => this.onRpcEvent(event));
    this.rpc.onExit(() => {
      this.promptRunning = false;
      this.bashRunning = false;
      notifyRunningChange();
    });
  }

  get sessionId(): string {
    return this._sessionId || this.tempKey;
  }

  get sessionFile(): string {
    return this._sessionFile;
  }

  get cwd(): string {
    return this.sessionCwd;
  }

  isAlive(): boolean {
    return this._alive && this.rpc.isAlive();
  }

  isRunning(): boolean {
    return (
      this._alive && (this.promptRunning || this.bashRunning || this.compacting)
    );
  }

  /** Wait for the RPC process to become ready, then snapshot its session id. */
  async start(): Promise<void> {
    await this.rpc.ready();
    try {
      if (this.forceNewSession) {
        // Without this, `omp --mode rpc --cwd <dir>` resumes the cwd's most
        // recent session. new_session switches to a fresh session (no response
        // frame; the following get_state reflects the new session id).
        try {
          await this.rpc.send("new_session", {}, 10_000);
        } catch {
          // best-effort — get_state below reveals the actual session
        }
      }
      const state = await this.rpc.send<Record<string, unknown>>(
        "get_state",
        {},
        30_000
      );
      if (typeof state?.sessionId === "string")
        this._sessionId = state.sessionId;
      if (typeof state?.sessionFile === "string") {
        this._sessionFile = state.sessionFile;
        // Let resolveSessionPath() find this session without a file scan.
        if (this._sessionId && this._sessionFile) {
          cacheSessionPath(this._sessionId, this._sessionFile);
        }
      }
      if (typeof state?.isCompacting === "boolean")
        this.compacting = state.isCompacting;
    } catch {
      // session id stays the temp key; commands will surface real errors
    }
    this.resetIdleTimer();
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(_force: boolean): void {
    // Handled at spawn via --no-tools; no runtime equivalent in RPC.
  }

  beginExtensionBinding(): void {
    // Extensions are bound by the omp runtime itself in RPC mode.
  }

  async waitUntilReady(): Promise<void> {
    await this.rpc.ready();
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  // -------------------------------------------------------------------------
  // Event ingestion + state aggregation
  // -------------------------------------------------------------------------

  private onRpcEvent(event: RpcEvent): void {
    switch (event.type) {
      case "agent_start":
        this.promptRunning = true;
        break;
      case "agent_end":
        // The session file is flushed by the time agent_end streams; let the
        // sidebar list pick up the new session/messages on its next fetch.
        invalidateSessionListCache();
        this.promptRunning = false;
        break;
      case "agent_settled":
        this.promptRunning = false;
        break;
      case "tool_execution_start":
        if (event.toolName === "bash") this.bashRunning = true;
        break;
      case "tool_execution_end":
        if (event.toolName === "bash") this.bashRunning = false;
        break;
      case "compaction_start":
        this.compacting = true;
        break;
      case "compaction_end":
        this.compacting = false;
        break;
      case "queue_update": {
        const steering = Array.isArray(event.steering)
          ? (event.steering as string[])
          : [];
        const followUp = Array.isArray(event.followUp)
          ? (event.followUp as string[])
          : [];
        this.queuedMessages = { steering, followUp };
        break;
      }
      case "extension_ui_request": {
        const method = event.method;
        if (method === "setStatus" && typeof event.statusKey === "string") {
          const text =
            typeof event.statusText === "string" ? event.statusText : undefined;
          if (text === undefined)
            this.extensionStatuses.delete(event.statusKey);
          else this.extensionStatuses.set(event.statusKey, text);
        } else if (
          method === "setWidget" &&
          typeof event.widgetKey === "string"
        ) {
          if (event.widgetLines === undefined || event.widgetLines === null) {
            this.extensionWidgets.delete(event.widgetKey);
          } else if (Array.isArray(event.widgetLines)) {
            this.extensionWidgets.set(event.widgetKey, {
              key: event.widgetKey,
              lines: event.widgetLines as string[],
              placement:
                event.widgetPlacement === "belowEditor"
                  ? "belowEditor"
                  : "aboveEditor",
            });
          }
        }
        break;
      }
    }
    if (IDLE_RESET_EVENT_TYPES.has(event.type)) this.resetIdleTimer();
    if (RUNNING_STATE_EVENT_TYPES.has(event.type)) notifyRunningChange();
    this.emit(event);
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => {
        if (this.isRunning()) {
          this.resetIdleTimer();
          return;
        }
        void this.shutdown().catch(() => {
          // best-effort idle cleanup
        });
      },
      10 * 60 * 1000
    );
  }

  // -------------------------------------------------------------------------
  // Commands (mapped to the OMP RPC protocol)
  // -------------------------------------------------------------------------

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;

    switch (type) {
      case "prompt": {
        if (this.bashRunning) {
          throw new Error(
            "Cannot send a prompt while a shell command is running"
          );
        }
        const images = command.images as
          Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as
          "steer" | "followUp" | undefined;
        // RPC responds once the prompt is accepted; events stream afterwards.
        await this.rpc.send("prompt", {
          message: command.message as string,
          ...(images?.length ? { images } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
        });
        return null;
      }

      case "steer": {
        const images = command.images as
          Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.rpc.send("steer", {
          message: command.message as string,
          ...(images?.length ? { images } : {}),
        });
        return null;
      }

      case "follow_up": {
        const images = command.images as
          Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.rpc.send("follow_up", {
          message: command.message as string,
          ...(images?.length ? { images } : {}),
        });
        return null;
      }

      case "abort":
        await this.rpc.send("abort");
        this.promptRunning = false;
        notifyRunningChange();
        return null;

      case "get_state": {
        const state =
          (await this.rpc.send<Record<string, unknown>>("get_state")) ?? {};
        return {
          ...state,
          sessionId: this.sessionId,
          isStreaming: this.promptRunning || state.isStreaming === true,
          isPromptRunning: this.promptRunning,
          isBashRunning: this.bashRunning,
          isCompacting: this.compacting,
          autoRetryEnabled:
            this.autoRetryEnabled ?? state.autoRetryEnabled ?? undefined,
          pendingMessageCount: state.queuedMessageCount ?? 0,
          queuedMessages: this.queuedMessages,
          extensionStatuses: Array.from(
            this.extensionStatuses,
            ([key, text]) => ({ key, text })
          ),
          extensionWidgets: Array.from(this.extensionWidgets.values()),
        };
      }

      case "set_model": {
        const provider = (command.provider as string) || "";
        const modelId = (command.modelId as string) || "";
        const data = await this.rpc.send<Record<string, unknown>>("set_model", {
          provider,
          modelId,
        });
        invalidateSessionListCache(); // model_change entry lands in the file
        const model = (data?.model ?? data) as
          { id?: string; provider?: string } | undefined;
        return model
          ? { id: model.id ?? modelId, provider: model.provider ?? provider }
          : null;
      }

      case "set_thinking_level": {
        await this.rpc.send("set_thinking_level", { level: command.level });
        return null;
      }

      case "set_session_name": {
        await this.rpc.send("set_session_name", { name: command.name });
        return null;
      }

      case "set_auto_compaction": {
        await this.rpc.send("set_auto_compaction", {
          enabled: command.enabled,
        });
        return null;
      }

      case "set_auto_retry": {
        await this.rpc.send("set_auto_retry", { enabled: command.enabled });
        this.autoRetryEnabled = Boolean(command.enabled);
        return null;
      }

      case "compact": {
        try {
          return await this.rpc.send("compact", {
            ...(typeof command.customInstructions === "string"
              ? { customInstructions: command.customInstructions }
              : {}),
          });
        } finally {
          this.compacting = false;
          notifyRunningChange();
        }
      }

      case "bash": {
        const result = await this.rpc.send<Record<string, unknown>>("bash", {
          command: command.command,
          ...(command.excludeFromContext !== undefined
            ? { excludeFromContext: command.excludeFromContext }
            : {}),
        });
        // A leading bash command persists its own session file (header-only
        // session). Register it for resolveSessionPath and refresh the list.
        if (this._sessionId && this._sessionFile) {
          cacheSessionPath(this._sessionId, this._sessionFile);
        }
        invalidateSessionListCache();
        return result;
      }

      case "abort_bash": {
        await this.rpc.send("abort_bash");
        this.bashRunning = false;
        notifyRunningChange();
        return null;
      }

      case "abort_compaction":
        // No RPC equivalent; compaction aborts are handled by the runtime.
        return null;

      case "clear_queue":
        // No RPC equivalent (steer/follow_up queues drain naturally).
        return null;

      case "extension_ui_response": {
        const payload: Record<string, unknown> = { id: command.id as string };
        if ("value" in command) payload.value = command.value;
        if ("confirmed" in command) payload.confirmed = command.confirmed;
        if ("cancelled" in command) payload.cancelled = command.cancelled;
        await this.rpc.send("extension_ui_response", payload);
        return null;
      }

      case "extension_ui_input":
        // custom() UI is not supported in RPC mode.
        return null;

      case "get_session_stats":
        return this.rpc.send("get_session_stats");

      case "get_last_assistant_text":
        return this.rpc.send("get_last_assistant_text");

      case "get_commands": {
        const data = await this.rpc.send<{
          commands?: Array<Record<string, unknown>>;
        }>("get_available_commands");
        // Map OMP command sources to the webview's slash palette groups:
        // builtin/skill pass through; OMP "file" (prompt templates) → "prompt";
        // "custom" and anything else → "extension".
        const commands = (data?.commands ?? []).map((c) => ({
          name: c.name,
          description: c.description,
          source:
            c.source === "builtin"
              ? "builtin"
              : c.source === "skill"
                ? "skill"
                : c.source === "file"
                  ? "prompt"
                  : "extension",
        }));
        return { commands };
      }

      case "get_tools": {
        const state = await this.rpc.send<Record<string, unknown>>("get_state");
        const dump = Array.isArray(state?.dumpTools)
          ? (state.dumpTools as Array<Record<string, unknown>>)
          : [];
        return dump.map((t) => ({
          name: t.name,
          description: t.description,
          active: t.active === true,
        }));
      }

      case "set_tools":
        // Applied at spawn via --tools; no runtime RPC command.
        return null;

      case "fork": {
        // OMP RPC fork: branch at the given entry (returns {text, cancelled}).
        const result = await this.rpc.send<Record<string, unknown>>("fork", {
          ...(command.entryId ? { entryId: command.entryId } : {}),
        });
        return result ?? { cancelled: false };
      }

      case "navigate_tree":
        // No RPC equivalent for tree navigation.
        return { cancelled: true };

      case "reload":
        // No RPC equivalent; runtime extension reload is automatic.
        return { success: true };

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribeRpc();
    this.rpc.kill();
    try {
      this.onDestroyCallback?.();
    } finally {
      notifyRunningChange();
    }
  }

  async shutdown(): Promise<void> {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribeRpc();
    try {
      await this.rpc.shutdown();
    } catch {
      // best-effort
    }
    try {
      this.onDestroyCallback?.();
    } finally {
      notifyRunningChange();
    }
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks:
    | Map<
        string,
        Promise<{ session: AgentSessionWrapper; realSessionId: string }>
      >
    | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<
  string,
  Promise<{ session: AgentSessionWrapper; realSessionId: string }>
> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

function normalizeRpcCwd(cwd: string): string {
  return cwd.replace(/\/+$/, "") || cwd;
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piStartingSessionCwds)
    globalThis.__piStartingSessionCwds = new Map();
  return globalThis.__piStartingSessionCwds;
}

function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = normalizeRpcCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(
  sessionId: string
): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) =>
      normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning()
  );
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__piRunningListeners)
    globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(
  listener: (ids: string[]) => void
): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let lastRunningSnapshot = "";

export function notifyRunningChange(): void {
  const listeners = getRunningListeners();
  if (listeners.size === 0) {
    lastRunningSnapshot = "";
    return;
  }
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of listeners) {
    try {
      listener(ids);
    } catch {
      /* ignore listener errors */
    }
  }
}

// ----------------------------------------------------------------------------
// Session creation
// ----------------------------------------------------------------------------

/**
 * Get or create an RPC-backed session for the given session.
 * - sessionFile !== ""  → resume that file via `omp --mode rpc --resume <file>`
 * - sessionFile === ""  → fresh session in `cwd`
 * Returns the wrapper plus the real session id (from the runtime's get_state).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {}
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive())
    return { session: existing, realSessionId: existing.sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const sessionCwd = sessionFile
    ? dirnameOf(sessionFile)
    : cwd || process.cwd();
  const finishStartingSession = trackStartingSession(sessionCwd);
  const starting = (async () => {
    const wrapper = new AgentSessionWrapper(
      sessionId,
      sessionFile,
      sessionCwd,
      options
    );
    try {
      await wrapper.start();
    } catch (err) {
      wrapper.destroy();
      throw err instanceof Error ? err : new Error(String(err));
    }
    const realSessionId = wrapper.sessionId;
    wrapper.onDestroy(() => {
      registry.delete(realSessionId);
      registry.delete(sessionId);
    });
    registry.set(realSessionId, wrapper);
    // Keep the requested key mapped too, so concurrent/other callers can find it.
    if (realSessionId !== sessionId) registry.set(sessionId, wrapper);
    notifyRunningChange();
    return { session: wrapper, realSessionId };
  })();

  locks.set(sessionId, starting);
  try {
    return await starting;
  } finally {
    locks.delete(sessionId);
    finishStartingSession();
  }
}

function dirnameOf(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  if (idx <= 0) return "/";
  return filePath.slice(0, idx);
}
