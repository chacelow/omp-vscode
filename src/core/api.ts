import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveOmpBinary } from "./omp-rpc";
import {
  getRpcSession,
  getRunningRpcSessionIds,
  startRpcSession,
  subscribeRunningSessions,
} from "./rpc-manager";
import {
  getOmpAgentDir,
  listAllSessions,
  loadSessionContext,
  readSessionHeader,
  resolveSessionPath,
} from "./session-reader";

// ============================================================================
// In-memory API handler — replaces the omp-web HTTP service.
//
// The webview's fetch/EventSource bridge (src/ui/bridge.ts) posts /api/*
// requests to the extension host; this handler answers them directly from the
// embedded OMP RPC session manager + session-file reader. No HTTP server, no
// port, no omp-web dependency.
// ============================================================================

type HandlerResult = { status: number; body: unknown };

export class ApiHandler {
  /** Session-id → subscribed webview listeners (SSE simulation). */
  private sessionListeners = new Map<string, Set<(event: unknown) => void>>();

  constructor() {
    // Forward running-state changes to running-stream subscribers.
    subscribeRunningSessions((ids) => {
      for (const cb of this.runningListeners) {
        try {
          cb(ids);
        } catch {
          // ignore
        }
      }
    });
  }

  private runningListeners = new Set<(ids: string[]) => void>();

  /** Subscribe to a session's agent events (SSE /events). */
  subscribeSession(sid: string, cb: (event: unknown) => void): () => void {
    let set = this.sessionListeners.get(sid);
    if (!set) {
      set = new Set();
      this.sessionListeners.set(sid, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
      if (set?.size === 0) this.sessionListeners.delete(sid);
    };
  }

  /** Subscribe to running-session-id changes (SSE /running/events). */
  subscribeRunning(cb: (ids: string[]) => void): () => void {
    this.runningListeners.add(cb);
    return () => this.runningListeners.delete(cb);
  }

  private emitSessionEvent(sid: string, event: unknown): void {
    const set = this.sessionListeners.get(sid);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  /** Wire a session wrapper's events to subscribers once. */
  private wireSession(sid: string, wrapper: { onEvent: (cb: (e: unknown) => void) => () => void }): void {
    wrapper.onEvent((event) => this.emitSessionEvent(sid, event));
  }

  /** GET /api/version — omp CLI version (one `omp -v`, cached) + this extension's version. */
  private async version(): Promise<HandlerResult> {
    let omp = "";
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version?: string };
      omp = pkg.version ?? "";
    } catch {
      // package.json unavailable
    }
    return { status: 200, body: { pi: "", omp, cli: await getOmpCliVersion() } };
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  async handle(url: string, method: string, body?: string): Promise<HandlerResult> {
    const path = url.split("?")[0].replace(/^\/+/, "");
    const parts = path.split("/").filter(Boolean); // ["api", "agent", ...]

    try {
      if (parts[0] !== "api") return { status: 404, body: { error: "Not found" } };

      // /api/version
      if (parts[1] === "version" && method === "GET") return this.version();

      // /api/sessions
      if (parts[1] === "sessions") {
        if (parts.length === 2 && method === "GET") {
          const sessions = listAllSessions();
          return { status: 200, body: { sessions, runningSessionIds: getRunningRpcSessionIds() } };
        }
        if (parts.length === 2 && method === "DELETE") {
          // POST /api/sessions/[id]  handled below; DELETE removes the file
          return { status: 405, body: { error: "Method not allowed" } };
        }
        if (parts.length >= 3) {
          const sid = decodeURIComponent(parts[2]);
          if (parts[3] === "state" && method === "GET") return this.sessionState(sid);
          if (method === "GET") return this.sessionDetail(sid);
        }
      }

      // /api/agent/*
      if (parts[1] === "agent") {
        if (parts[2] === "new" && method === "POST") return this.agentNew(body);
        if (parts[2] === "running" && method === "GET") {
          return { status: 200, body: { runningSessionIds: getRunningRpcSessionIds() } };
        }
        if (parts.length >= 3 && parts[2] !== "new" && parts[2] !== "running") {
          const sid = decodeURIComponent(parts[2]);
          if (parts[3] === "bash-output") return { status: 404, body: { error: "Not found" } };
          if (method === "POST") return this.agentCommand(sid, body);
          if (method === "GET") return this.agentState(sid);
        }
      }

      // /api/models, /api/models-config, /api/skills, /api/plugins, /api/auth,
      // /api/files, /api/cwd — config surfaces are not embedded yet.
      if (["models", "models-config", "skills", "plugins", "auth", "files", "cwd", "home", "default-cwd", "project-trust"].includes(parts[1] as string)) {
        return this.configSurface(parts[1] as string, method, parts);
      }

      return { status: 404, body: { error: `Not found: ${path}` } };
    } catch (err) {
      return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
    }
  }

  // -------------------------------------------------------------------------
  // Agent session commands
  // -------------------------------------------------------------------------

  private async agentNew(body?: string): Promise<HandlerResult> {
    const parsed = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
    const cwd = parsed.cwd as string;
    if (!cwd) return { status: 400, body: { error: "cwd is required" } };

    const options: Record<string, unknown> = {};
    if (Array.isArray(parsed.toolNames)) options.toolNames = parsed.toolNames;
    if (parsed.provider && parsed.modelId) options.initialModel = { provider: parsed.provider, modelId: parsed.modelId };
    if (parsed.thinkingLevel) options.thinkingLevel = parsed.thinkingLevel;
    if (parsed.forceNewSession) options.forceNewSession = true;

    const tempKey = `__new__${randomUUID()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, options);
    this.wireSession(realSessionId, session as never);

    const state = (await session.send({ type: "get_state" })) as {
      model?: { id: string; provider: string };
      thinkingLevel?: string;
    };

    const bodyOut = {
      success: true,
      sessionId: realSessionId,
      data: null,
      model: state.model ? { provider: state.model.provider, modelId: state.model.id } : null,
      thinkingLevel: state.thinkingLevel,
    };
    return { status: 200, body: bodyOut };
  }

  private async agentCommand(sid: string, body?: string): Promise<HandlerResult> {
    const command = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
    let session = getRpcSession(sid);
    if (!session?.isAlive()) {
      const filePath = resolveSessionPath(sid);
      if (!filePath) return { status: 404, body: { error: "Session not found" } };
      ({ session } = await startRpcSession(sid, filePath, undefined));
    }
    this.wireSession(sid, session as never);
    const data = await session.send(command);
    return { status: 200, body: { success: true, data } };
  }

  private async agentState(sid: string): Promise<HandlerResult> {
    const session = getRpcSession(sid);
    if (!session?.isAlive()) return { status: 200, body: { running: false } };
    const state = await session.send({ type: "get_state" });
    return { status: 200, body: { running: true, state } };
  }

  private async sessionState(sid: string): Promise<HandlerResult> {
    const filePath = resolveSessionPath(sid);
    if (!filePath) return { status: 404, body: { error: "Session not found" } };
    const session = getRpcSession(sid);
    if (!session?.isAlive()) return { status: 200, body: { running: false } };
    const state = await session.send({ type: "get_state" });
    return { status: 200, body: { running: true, state } };
  }

  /** GET /api/sessions/[id] — session file → messages for the chat view. */
  private async sessionDetail(sid: string): Promise<HandlerResult> {
    const filePath = resolveSessionPath(sid);
    if (!filePath) return { status: 404, body: { error: "Session not found" } };
    const ctx = loadSessionContext(filePath);
    const header = readSessionHeader(filePath);
    // Minimal linear tree: one node per message (branch UI is not embedded).
    const tree = ctx.messages.map((m, i) => ({
      entry: {
        type: "message",
        id: ctx.entryIds[i] ?? `msg-${i}`,
        parentId: i === 0 ? null : ctx.entryIds[i - 1] ?? null,
        timestamp: new Date().toISOString(),
        message: m,
      },
      children: [],
    }));
    return {
      status: 200,
      body: {
        sessionId: sid,
        filePath,
        tree,
        leafId: ctx.leafId,
        context: {
          messages: ctx.messages,
          entryIds: ctx.entryIds,
          thinkingLevel: ctx.thinkingLevel ?? "off",
          model: ctx.model ?? null,
        },
        cwd: header?.cwd ?? "",
      },
    };
  }

  // -------------------------------------------------------------------------
  // Config surfaces (not embedded yet — degrade gracefully)
  // -------------------------------------------------------------------------

  private async configSurface(surface: string, _method: string, parts: string[]): Promise<HandlerResult> {
    switch (surface) {
      case "models":
        return { status: 200, body: { models: {}, modelList: [], defaultModel: null } };
      case "models-config":
        return { status: 200, body: { providers: {}, modelRoles: {}, setupVersion: 1 } };
      case "skills":
        return { status: 200, body: { skills: [], diagnostics: null } };
      case "plugins":
        return { status: 200, body: { packages: [] } };
      case "auth":
        return { status: 200, body: { providers: [] } };
      case "default-cwd":
        return { status: 200, body: { cwd: getOmpAgentDir() } };
      case "cwd":
        return { status: 200, body: { cwd: getOmpAgentDir() } };
      case "home":
        return { status: 200, body: { home: process.env.HOME ?? "" } };
      case "project-trust":
        return { status: 200, body: { trusted: true, cwd: undefined, projectRoot: undefined } };
      default:
        return { status: 404, body: { error: `Not implemented: ${parts.join("/")}` } };
    }
  }
}

// ---------------------------------------------------------------------------
// omp CLI version (one spawn, cached 1h)
// ---------------------------------------------------------------------------

let cliVersionCache: string | null = null;

async function getOmpCliVersion(): Promise<string> {
  if (cliVersionCache !== null) return cliVersionCache;
  try {
    const out = await new Promise<string>((resolve) => {
      const child = spawn(resolveOmpBinary(), ["-v"], { stdio: ["ignore", "pipe", "ignore"] });
      let o = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(o);
      }, 10_000);
      child.stdout?.on("data", (d) => (o += d.toString()));
      child.on("exit", () => {
        clearTimeout(timer);
        resolve(o);
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
    });
    cliVersionCache = out.match(/omp\/([\d.]+)/i)?.[1] ?? "";
  } catch {
    cliVersionCache = "";
  }
  return cliVersionCache;
}
