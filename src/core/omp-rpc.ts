import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ============================================================================
// OMP RPC subprocess client
//
// Spawns `omp --mode rpc` (the real Oh My Pi runtime, Bun-compiled binary —
// no Node/bun-import compatibility issues) and speaks its JSONL protocol over
// stdin/stdout:
//
//   -> {"id":"req-1","type":"get_state"}
//   <- {"id":"req-1","type":"response","command":"get_state","success":true,"data":{...}}
//   <- {"type":"message_update", ...}          (events streamed, no id)
//   <- {"type":"extension_ui_request", ...}     (extension UI sub-protocol)
//
// Protocol facts (verified against omp 17.2.11):
//   - Startup emits {"type":"ready","protocolVersion":1,...} once.
//   - Responses carry the request id; events do not.
//   - Newline-delimited JSON (LF only; strip trailing \r).
//   - Closing stdin makes the process exit on its own (no zombie/leak).
// ============================================================================

export interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

let logFn: ((line: string) => void) | null = null;
const ts = () => new Date().toISOString().slice(11, 23);

/** Route RPC wire traffic to a logger (e.g. an output channel). */
export function setRpcLogFn(fn: (line: string) => void | null): void {
  logFn = fn;
}

export interface RpcSessionOptions {
  cwd: string;
  /** Session file to resume (else omp picks the cwd's active session). */
  resume?: string;
  noSession?: boolean;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  /** Tool allow-list; [] disables all tools, undefined keeps defaults. */
  toolNames?: string[];
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const READY_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** Locate the omp binary: explicit install dirs first, then PATH. */
export function resolveOmpBinary(): string {
  const candidates = [
    process.env.OMP_CLI_PATH,
    join(homedir(), ".bun", "bin", "omp"),
    join(homedir(), ".local", "bin", "omp"),
    "/opt/homebrew/bin/omp",
    "/usr/local/bin/omp",
    "omp",
  ].filter((c): c is string => Boolean(c));
  const found = candidates.find((c) => c === "omp" || existsSync(c));
  return found ?? "omp";
}

export class OmpRpcProcess {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private seq = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(e: RpcEvent) => void>();
  private readonly exitListeners = new Set<(code: number | null) => void>();
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private _alive = false;
  private _exited = false;
  private _sessionId = "";
  private _sessionFile = "";
  private readonly options: RpcSessionOptions;
  readonly binaryPath: string;

  constructor(options: RpcSessionOptions) {
    this.options = options;
    this.binaryPath = resolveOmpBinary();
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.spawn();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private spawn(): void {
    const args = ["--mode", "rpc", "--offline", "--cwd", this.options.cwd];
    if (this.options.resume) args.push("--resume", this.options.resume);
    if (this.options.noSession) args.push("--no-session");
    if (this.options.model) {
      args.push("--model", `${this.options.model.provider}/${this.options.model.modelId}`);
    }
    if (this.options.thinkingLevel && this.options.thinkingLevel !== "auto") {
      args.push("--thinking", this.options.thinkingLevel);
    }
    if (this.options.toolNames) {
      if (this.options.toolNames.length === 0) {
        args.push("--no-tools");
      } else {
        args.push("--tools", this.options.toolNames.join(","));
      }
    }

    const proc = spawn(this.binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    this.proc = proc;
    this._exited = false;
    this._alive = true;

    proc.stdout?.on("data", (chunk) => this.onData(chunk.toString()));
    proc.stderr?.on("data", (chunk) => {
      // Startup diagnostics only; not part of the protocol.
      process.stderr.write(`[omp-rpc] ${chunk.toString()}`);
    });
    proc.on("error", (err) => {
      if (!this._exited) {
        this._exited = true;
        this._alive = false;
        this.rejectReady(new Error(`Failed to start omp: ${err.message}`));
        this.failPending(new Error(`omp process error: ${err.message}`));
        for (const cb of this.exitListeners) cb(null);
      }
    });
    proc.on("exit", (code) => {
      this._alive = false;
      this._exited = true;
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.rejectReady(new Error(`omp exited before ready (code ${code})`));
      this.failPending(new Error(`omp process exited (code ${code})`));
      for (const cb of this.exitListeners) cb(code);
      this.exitListeners.clear();
    });

    this.readyTimer = setTimeout(() => {
      this.rejectReady(new Error("Timed out waiting for omp RPC ready"));
      this.kill();
    }, READY_TIMEOUT_MS);
  }

  isAlive(): boolean {
    return this._alive && this.proc !== null && this.proc.exitCode === null;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get sessionFile(): string {
    return this._sessionFile;
  }

  /** Resolve once the RPC process has emitted its ready frame. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Kill the process tree immediately (SIGKILL fallback). */
  kill(): void {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    try {
      proc.kill("SIGTERM");
    } catch {
      // already gone
    }
    setTimeout(() => {
      if (this.proc && this.proc.exitCode === null) {
        try {
          this.proc.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    }, 3000);
  }

  /** Graceful stop: close stdin — omp exits on stdin EOF (verified). */
  async shutdown(): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    try {
      proc.stdin?.end();
    } catch {
      // already closed
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.kill();
        resolve();
      }, 5000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Protocol
  // -------------------------------------------------------------------------

  private onData(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Non-JSON output (should not happen in rpc mode) — ignore.
      return;
    }

    if (frame.type === "ready") {
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.readyTimer = null;
      this.resolveReady();
      return;
    }

    const id = typeof frame.id === "string" ? frame.id : undefined;
    if (id && this.pending.has(id)) {
      const req = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(req.timer);
      if (frame.type === "response") {
        if (frame.success === false) {
          const msg = typeof frame.error === "string"
            ? frame.error
            : `Command ${String(frame.command)} failed`;
          req.reject(new Error(msg));
        } else {
          req.resolve(frame.data);
        }
      } else {
        req.reject(new Error(`Unexpected response frame type: ${String(frame.type)}`));
      }
      return;
    }

    // Everything else is an event (or a frame for an already-timed-out request).
    this.dispatchEvent(frame as RpcEvent);
  }

  /** Send a command and resolve with the response `data` (reject on failure). */
  send<T = unknown>(type: string, payload: Record<string, unknown> = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (!this.isAlive()) {
      return Promise.reject(new Error("omp session process is not running"));
    }
    const id = `req-${++this.seq}`;
    const brief = JSON.stringify(payload).slice(0, 120);
    logFn?.(`[${ts()}] [rpc] → ${type} ${brief}`);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command ${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (data: unknown) => {
          logFn?.(`[${ts()}] [rpc] ← ${type} ok ${JSON.stringify(data).slice(0, 160)}`);
          resolve(data as T);
        },
        reject: (err: Error) => {
          logFn?.(`[${ts()}] [rpc] ← ${type} error: ${err.message}`);
          reject(err);
        },
        timer,
      });
      try {
        this.proc?.stdin?.write(JSON.stringify({ id, type, ...payload }) + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private failPending(err: Error): void {
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(err);
    }
    this.pending.clear();
  }

  private dispatchEvent(event: RpcEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        // listener errors must not kill the stream
      }
    }
  }

  onEvent(cb: (e: RpcEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onExit(cb: (code: number | null) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
}
