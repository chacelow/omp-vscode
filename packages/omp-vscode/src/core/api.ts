import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync, readFileSync, readdirSync, type Dirent } from "fs";
import { join, relative } from "path";
import { resolveOmpBinary, setRpcLogFn } from "./omp-rpc";
import {
  getRpcSession,
  getRpcSessionList,
  getRunningRpcSessionIds,
  startRpcSession,
  subscribeRunningSessions,
} from "./rpc-manager";
import { getOmpAgentDir, listAllSessions, loadSessionContext, loadSessionTree, readSessionHeader, reorderSessionAt, resolveSessionPath } from "./session-reader";
import { parseModelRef, readOmpConfig, readOmpModelsFromConfig, readOmpModelsFromDb } from "./omp-models";

// ============================================================================
// In-memory API handler — replaces the omp-web HTTP service.
//
// The webview's fetch/EventSource bridge (src/ui/bridge.ts) posts /api/*
// requests to the extension host; this handler answers them directly from the
// embedded OMP RPC session manager + session-file reader. No HTTP server, no
// port, no omp-web dependency.
// ============================================================================

type HandlerResult = { status: number; body: unknown };

/** Race a promise against a timeout (the hung omp process keeps its own
 *  pending entry; this just stops the caller waiting). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export class ApiHandler {
  /** Session-id → subscribed webview listeners (SSE simulation). */
  private sessionListeners = new Map<string, Set<(event: unknown) => void>>();

  private readonly log = vscode.window.createOutputChannel("OMP RPC");
  private ts(): string { return new Date().toISOString().slice(11, 23); }

  constructor() {
    // Route RPC wire traffic to the output channel so request/response flow
    // is visible (View → Output → OMP RPC).
    setRpcLogFn((line) => this.log.appendLine(line));
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

  private wiredSessions = new Set<string>();
  private modelsCache = new Map<string, { at: number; list: Array<{ id: string; name: string; provider: string; contextWindow?: number }> }>();

  /** Wire a session wrapper's events to subscribers once (duplicates would
   *  forward every event N times → duplicated messages in the UI). */
  private wireSession(sid: string, wrapper: { onEvent: (cb: (e: unknown) => void) => () => void }): void {
    if (this.wiredSessions.has(sid)) return;
    this.wiredSessions.add(sid);
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
    const bodyBrief = body ? body.slice(0, 140) : "";
    this.log.appendLine(`[${this.ts()}] [api] ${method} /${path} ${bodyBrief}`);

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
          if (parts[3] === "rewind" && method === "POST") return this.sessionRewind(sid, body);
          if (parts[3] === "navigate-leaf" && method === "POST") return this.sessionNavigateLeaf(sid, body);
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
      if (["models-config", "skills", "plugins", "auth", "files", "cwd", "home", "default-cwd", "project-trust"].includes(parts[1] as string)) {
        return this.configSurface(parts[1] as string, method, parts, body);
      }
      if (parts[1] === "models" && method === "GET") return this.models();

      // /api/file-index?cwd=...&q=... — @ file autocomplete index
      if (parts[1] === "file-index" && method === "GET") {
        const params = new URL(url, "http://local").searchParams;
        return this.fileIndex(params.get("cwd") ?? "", params.get("q") ?? "");
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

  /**
   * POST /api/sessions/[id]/rewind { entryId, text, images? }
   * In-place rewind (plugin-built-in, no omp changes): truncate the session
   * file at the given user message, restart the RPC session on the SAME file
   * (same session id), then prompt with the edited text. The branch is
   * rewritten in the same file — no new session, no fork, nothing visible in
   * the sidebar. Verified end-to-end against omp 17.2.11.
   */
  private async sessionRewind(sid: string, body?: string): Promise<HandlerResult> {
    let req: { entryId?: string; text?: string; images?: Array<{ type: "image"; data: string; mimeType: string }> };
    try {
      req = body ? (JSON.parse(body) as typeof req) : {};
    } catch {
      return { status: 400, body: { error: "Invalid request body" } };
    }
    const entryId = req.entryId;
    const text = req.text;
    if (!entryId || !text || !text.trim()) {
      return { status: 400, body: { error: "entryId and text are required" } };
    }
    const filePath = resolveSessionPath(sid);
    if (!filePath) return { status: 404, body: { error: "Session not found" } };

    // 1. Stop the RPC process so the file can be rewritten safely (flush done).
    const existing = getRpcSession(sid);
    if (existing?.isAlive()) {
      try {
        await existing.shutdown();
      } catch {
        // continue anyway
      }
    }

    // 2. Reorder the file: the edit point's ancestor chain becomes the last
    //    lines, so omp's resumed leaf = the edit point's parent (SessionEntry
    //    Index.insert sets leaf = last entry). Old branches stay in the file.
    const ok = reorderSessionAt(filePath, entryId);
    if (!ok) {
      return { status: 400, body: { error: "Entry not found or not a user message" } };
    }

    // 3. Restart on the SAME file → same session id, context rebuilt from the
    //    truncated transcript.
    try {
      const { session } = await startRpcSession(sid, filePath, undefined);
      this.wireSession(sid, session as never);

      // 4. Replay: send the edited text as a fresh prompt (events stream to
      //    the webview via the existing SSE subscription on sid).
      const images = req.images;
      await session.send({
        type: "prompt",
        message: text,
        ...(images?.length ? { images } : {}),
      });
    } catch (e) {
      return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } };
    }

    return { status: 200, body: { success: true, sessionId: sid } };
  }

  /**
   * POST /api/sessions/[id]/navigate-leaf { entryId }
   * Switch the active branch to the given message's branch (Session Tree
   * click): reorder the file so that message's ancestor chain is last (leaf),
   * restart the RPC session on the SAME file. Old branches stay in the file.
   */
  private async sessionNavigateLeaf(sid: string, body?: string): Promise<HandlerResult> {
    let req: { entryId?: string };
    try {
      req = body ? (JSON.parse(body) as typeof req) : {};
    } catch {
      return { status: 400, body: { error: "Invalid request body" } };
    }
    const entryId = req.entryId;
    if (!entryId) {
      return { status: 400, body: { error: "entryId is required" } };
    }
    const filePath = resolveSessionPath(sid);
    if (!filePath) return { status: 404, body: { error: "Session not found" } };

    const existing = getRpcSession(sid);
    if (existing?.isAlive()) {
      try {
        await existing.shutdown();
      } catch {
        // continue anyway
      }
    }
    if (!reorderSessionAt(filePath, entryId)) {
      return { status: 400, body: { error: "Entry not found or not a user message" } };
    }
    try {
      const { session } = await startRpcSession(sid, filePath, undefined);
      this.wireSession(sid, session as never);
    } catch (e) {
      return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } };
    }
    return { status: 200, body: { success: true, sessionId: sid } };
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
    // Real message tree (entry parentId links) for the lightweight
    // session-tree view; children populate branch/fork points.
    const treeInfo = loadSessionTree(filePath);
    const tree = treeInfo.roots.map((node) => ({
      entry: {
        type: "message",
        id: node.id,
        parentId: node.parentId,
        timestamp: node.timestamp ?? new Date().toISOString(),
        message: { role: node.role, content: node.summary ? [{ type: "text", text: node.summary }] : [] },
      },
      children: node.children.map((c) => ({
        entry: {
          type: "message",
          id: c.id,
          parentId: c.parentId,
          timestamp: c.timestamp ?? new Date().toISOString(),
          message: { role: c.role, content: c.summary ? [{ type: "text", text: c.summary }] : [] },
        },
        children: [],
      })),
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

  /**
   * GET /api/models — the user's configured model list, read locally:
   *   1. ~/.omp/agent/models.yml providers (the OMP config surface — the
   *      exact list the user configured; no network)
   *   2. models.db entries for providers referenced by modelRoles (e.g.
   *      deepseek) that aren't in models.yml
   * get_available_models is NOT used as the primary source — it can stall on
   * a remote custom provider (OAuth refresh / model discovery), which is
   * pointless when the config already defines the models.
   */
  private async models(): Promise<HandlerResult> {
    const config = readOmpConfig();
    const roles = config.modelRoles ?? {};
    const modelRoles: Record<string, { provider: string; modelId: string; thinkingLevel?: string }> = {};
    for (const [role, ref] of Object.entries(roles)) {
      if (!ref) continue;
      const parsed = parseModelRef(ref);
      if (!parsed) continue;
      const thinkingIdx = ref.lastIndexOf(":");
      const thinking = thinkingIdx > 0 ? ref.slice(thinkingIdx + 1) : undefined;
      if (thinking && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) {
        modelRoles[role] = { ...parsed, thinkingLevel: thinking };
      } else {
        modelRoles[role] = parsed;
      }
    }
    const defaultModel = parseModelRef(roles.default) ?? null;

    // 1. Configured providers from models.yml (authoritative for the user's list).
    const configItems = readOmpModelsFromConfig();
    // 2. models.db entries for role-referenced providers not in models.yml
    //    (deepseek, anyrouter, ...).
    const roleProviders = new Set(Object.values(modelRoles).map((r) => r.provider));
    const configProviders = new Set(configItems.map((m) => m.provider));
    const dbItems = readOmpModelsFromDb().filter((m) => roleProviders.has(m.provider) && !configProviders.has(m.provider));

    const items = [...configItems, ...dbItems];
    const modelList = items.map((m) => ({ id: m.id, name: m.name, provider: m.provider }));
    const models: Record<string, string> = {};
    for (const m of items) if (!models[m.id]) models[m.id] = m.name;

    // Current model from the live session (fast local get_state).
    let currentModel: { provider: string; modelId: string } | null = null;
    let fastModeEnabled = false;
    let fastModeActive = false;
    for (const live of getRpcSessionList()) {
      if (!live.isAlive()) continue;
      try {
        const state = (await withTimeout(live.send({ type: "get_state" }), 2000)) as {
          model?: { id: string; provider: string };
          fastModeEnabled?: boolean;
          fastModeActive?: boolean;
        };
        if (state?.model) currentModel = { provider: state.model.provider, modelId: state.model.id };
        fastModeEnabled = state?.fastModeEnabled ?? fastModeEnabled;
        fastModeActive = state?.fastModeActive ?? fastModeActive;
        if (currentModel) break;
      } catch {
        continue;
      }
    }

    return {
      status: 200,
      body: {
        models,
        modelList,
        defaultModel,
        currentModel,
        fastModeEnabled,
        fastModeActive,
        modelRoles,
        thinkingLevels: {},
        thinkingLevelMaps: {},
        thinkingLevelPins: {},
        modelError: null,
        modelScopeWarnings: [],
      },
    };
  }

  // -------------------------------------------------------------------------
  // Config surfaces (not embedded yet — degrade gracefully)
  // -------------------------------------------------------------------------

  /** @ file autocomplete index: walk cwd (bounded), return relative paths. */
  private async fileIndex(cwd: string, query: string): Promise<HandlerResult> {
    if (!cwd || !existsSync(cwd)) return { status: 200, body: { files: [], truncated: false } };
    const MAX_FILES = 20_000;
    const MAX_DEPTH = 8;
    const IGNORED: Record<string, true> = {
      node_modules: true, ".git": true, ".hg": true, ".svn": true,
      dist: true, build: true, ".next": true, ".cache": true,
      ".vscode-test": true, ".DS_Store": true,
    };
    const files: string[] = [];
    let truncated = false;

    const walk = (dir: string, depth: number): void => {
      if (truncated || depth > MAX_DEPTH) return;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (IGNORED[e.name]) continue;
        const abs = join(dir, e.name);
        const rel = relative(cwd, abs).split("\\").join("/");
        if (e.isDirectory()) {
          walk(abs, depth + 1);
        } else if (e.isFile()) {
          files.push(rel);
          if (files.length >= MAX_FILES) {
            truncated = true;
            return;
          }
        }
      }
    };
    walk(cwd, 0);

    if (!query) {
      return { status: 200, body: { files, truncated } };
    }
    // Query mode: filter paths (substring on the basename or full path) and
    // return entries with derived directories (matches the webview format).
    const q = query.toLowerCase();
    const matched = files.filter((f) => f.toLowerCase().includes(q));
    const dirs = new Set<string>();
    for (const f of matched) {
      let idx = f.indexOf("/");
      while (idx !== -1) {
        dirs.add(f.slice(0, idx));
        idx = f.indexOf("/", idx + 1);
      }
    }
    const matches: { path: string; isDir: boolean }[] = [];
    for (const d of dirs) matches.push({ path: d, isDir: true });
    for (const f of matched) matches.push({ path: f, isDir: false });
    matches.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    return { status: 200, body: { matches } };
  }

  private async configSurface(surface: string, _method: string, parts: string[], body?: string): Promise<HandlerResult> {
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
      case "cwd": {
        // POST /api/cwd/validate {cwd} → echo the requested directory back
        // (existence-checked) so the shell adopts the workspace folder.
        if (parts[2] === "validate" && body) {
          try {
            const req = JSON.parse(body) as { cwd?: string };
            if (typeof req.cwd === "string" && existsSync(req.cwd)) {
              return { status: 200, body: { cwd: req.cwd } };
            }
            return { status: 400, body: { error: "Directory does not exist" } };
          } catch {
            return { status: 400, body: { error: "Invalid request" } };
          }
        }
        return { status: 200, body: { cwd: getOmpAgentDir() } };
      }
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
