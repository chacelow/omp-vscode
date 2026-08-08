import * as vscode from "vscode";
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

// Lifecycle management for the local omp-web service.
//
// Strategy:
//   1. Probe the configured port (default 30141) — if a healthy omp-web is
//      already running (e.g. started by the user), just connect to it.
//   2. Otherwise spawn the configured launch command (default:
//      `npx -y omp-web@latest --no-open`), which requires Node >= 22.19 on
//      PATH.
//   3. Track whether *we* started the process so we only kill it on exit
//      when `omp.server.stopOnExit` is enabled.

export class OmpServerManager {
  private child: ChildProcess | null = null;
  private startedByUs = false;
  private stopping = false;
  readonly onStatusChange = new EventEmitter();

  get baseUrl(): string {
    const port = vscode.workspace.getConfiguration("omp").get<number>("server.port", 30141);
    return `http://127.0.0.1:${port}`;
  }

  isOurs(): boolean {
    return this.startedByUs;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ensure an omp-web service is reachable. Returns true when ready, throws
   * when it cannot be started.
   */
  async ensureRunning(): Promise<boolean> {
    if (await this.isHealthy()) return true;

    const autoStart = vscode.workspace.getConfiguration("omp").get<boolean>("server.autoStart", true);
    if (!autoStart) {
      throw new Error(
        `OMP server is not running at ${this.baseUrl}. Start it manually or enable "omp.server.autoStart".`,
      );
    }
    return this.start();
  }

  private async start(): Promise<boolean> {
    const command = vscode.workspace
      .getConfiguration("omp")
      .get<string>("server.command", "npx -y omp-web@latest --no-open");

    const [cmd, ...args] = command.split(/\s+/).filter(Boolean);
    if (!cmd) throw new Error("omp.server.command is empty");

    vscode.window.showInformationMessage(`Starting omp-web: ${command}`);

    this.child = spawn(cmd, args, {
      shell: false,
      env: { ...process.env, OMP_WEB_NO_OPEN: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.startedByUs = true;

    this.child.stdout?.on("data", (chunk) => {
      console.log(`[omp-server] ${chunk.toString().trimEnd()}`);
    });
    this.child.stderr?.on("data", (chunk) => {
      console.error(`[omp-server] ${chunk.toString().trimEnd()}`);
    });
    this.child.on("exit", (code) => {
      console.log(`[omp-server] exited with code ${code}`);
      this.child = null;
      if (!this.stopping) {
        vscode.window.showWarningMessage(`omp-web server stopped (exit code ${code}).`);
      }
      this.onStatusChange.emit("change");
    });

    // Poll for readiness (up to ~30s; npx may need to download first).
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
        throw new Error(
          `Failed to start omp-web (exit code ${this.child.exitCode}). ` +
            "Check that Node.js >= 22.19 is on PATH or set omp.server.command.",
        );
      }
      if (await this.isHealthy()) {
        this.onStatusChange.emit("change");
        return true;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Timed out waiting for omp-web to become ready.");
  }

  /** Stop the service only if this extension started it. */
  async stop(): Promise<void> {
    if (!this.child || !this.startedByUs) return;
    this.stopping = true;
    const child = this.child;
    this.child = null;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(resolve, 3000);
    });
    if (child.exitCode === null) child.kill("SIGKILL");
    this.stopping = false;
    this.onStatusChange.emit("change");
  }
}
