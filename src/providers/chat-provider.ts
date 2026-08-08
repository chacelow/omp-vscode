import * as vscode from "vscode";
import { OmpClient } from "../core/omp-client";
import { OmpServerManager } from "../core/server-manager";
import type { AgentEvent } from "../core/types";

// Sidebar chat view hosting the omp-web React app (AppShell) inside a
// WebviewView. The React app is bundled as dist/webview.js and talks to the
// extension host through the fetch/EventSource bridge in src/ui/bridge.ts.
// This provider only:
//   - resolves the webview (HTML/CSP)
//   - proxies /api/* fetch calls to the local omp-web service
//   - streams SSE events from omp-web into the webview (with auto-reconnect)
//   - manages the server lifecycle on demand

export interface ChatProviderDeps {
  server: OmpServerManager;
}

type WebviewMsg =
  | { type: "api"; requestId: number; url: string; method: string; headers?: unknown; body?: string }
  | { type: "events"; url: string }
  | { type: "eventsClose"; url: string }
  | { type: "startServer" }
  | { type: "log"; level: string; message: string; stack?: string };

export class ChatProvider implements vscode.WebviewViewProvider {
  private static instance: ChatProvider | null = null;

  static get(deps: ChatProviderDeps): ChatProvider {
    if (!ChatProvider.instance) ChatProvider.instance = new ChatProvider(deps);
    return ChatProvider.instance;
  }

  static dispose(): void {
    ChatProvider.instance?.disposeInternal();
    ChatProvider.instance = null;
  }

  private view: vscode.WebviewView | null = null;
  private client: OmpClient;
  private deps: ChatProviderDeps;
  private eventStreams = new Map<string, { abort: AbortController; closed: boolean }>();
  private disposed = false;
  private readonly log = vscode.window.createOutputChannel("OMP Chat");

  private constructor(deps: ChatProviderDeps) {
    this.deps = deps;
    this.client = new OmpClient(deps.server.baseUrl);
  }

  // -------------------------------------------------------------------------
  // WebviewViewProvider
  // -------------------------------------------------------------------------

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.disposed = false;
    this.client = new OmpClient(this.deps.server.baseUrl);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extUri(), "dist"),
        vscode.Uri.joinPath(this.extUri(), "media"),
      ],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMsg) => {
      void this.handleWebviewMessage(msg);
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.disposeInternal();
    });
  }

  /** Focus the sidebar chat view. Creates it if not resolved yet. */
  async createOrShow(): Promise<void> {
    await this.deps.server.ensureRunning();
    await vscode.commands.executeCommand("omp.chat.focus");
  }

  private extUri(): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.file(__dirname), "..");
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extUri(), "dist", "webview.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extUri(), "dist", "webview.css"));
    // Pass the active workspace folder as the initial cwd so sessions follow
    // the currently opened directory (omp-web's AppShell reads ?cwd= via
    // useSearchParams, which our shim feeds from this data attribute).
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      "img-src ${webview.cspSource} data: https: http:",
      "font-src ${webview.cspSource} data:",
      "connect-src 'none'",
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en" translate="no">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>OMP Chat</title>
</head>
<body class="notranslate">
  <div id="app" data-cwd="${cwd.replace(/"/g, "&quot;")}">
    <div style="padding:20px;font-family:monospace;font-size:12px;color:var(--vscode-descriptionForeground,#999)">Loading OMP…</div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private disposeInternal(): void {
    this.disposed = true;
    for (const [, entry] of this.eventStreams) entry.abort.abort();
    this.eventStreams.clear();
    this.view = null;
  }

  /** Dispose resources owned by the singleton (called on extension deactivate). */
  disposeAll(): void {
    this.disposeInternal();
    this.log.dispose();
  }

  // -------------------------------------------------------------------------
  // Bridge: API proxy
  // -------------------------------------------------------------------------

  private async handleWebviewMessage(msg: WebviewMsg): Promise<void> {
    try {
      switch (msg.type) {
        case "log":
          this.log.appendLine(`[${msg.level}] ${msg.message}${msg.stack ? `\n${msg.stack}` : ""}`);
          break;

        case "api": {
          const resp = await this.client.rawRequest(msg.url, msg.method, msg.body);
          this.post({
            type: "apiResponse",
            requestId: msg.requestId,
            status: resp.status,
            body: resp.body,
          });
          break;
        }

        case "events":
          this.startEventStream(msg.url);
          break;

        case "eventsClose":
          this.closeEventStream(msg.url);
          break;

        case "startServer":
          try {
            await this.deps.server.ensureRunning();
            this.client = new OmpClient(this.deps.server.baseUrl);
            this.post({ type: "serverReady" });
          } catch (err) {
            this.post({
              type: "apiResponse",
              requestId: -1,
              status: 500,
              body: { error: err instanceof Error ? err.message : String(err) },
            });
          }
          break;
      }
    } catch (err) {
      if (msg.type === "api") {
        this.post({
          type: "apiResponse",
          requestId: msg.requestId,
          status: 500,
          body: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Bridge: SSE
  // -------------------------------------------------------------------------

  private sessionIdFromUrl(url: string): string | null {
    const m = url.match(/\/api\/agent\/([^/]+)\/events/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  private startEventStream(url: string): void {
    const existing = this.eventStreams.get(url);
    if (existing && !existing.abort.signal.aborted) return;

    const sid = this.sessionIdFromUrl(url);
    if (!sid) return;

    const abort = new AbortController();
    this.eventStreams.set(url, { abort, closed: false });
    const entry = this.eventStreams.get(url)!;

    const stream = async (): Promise<void> => {
      try {
        await this.client.streamEvents(
          sid,
          (event: AgentEvent) => this.post({ type: "event", url, event }),
          abort.signal,
        );
      } catch {
        // connection error — retry below if not closed
      }
      // Retry forever until the webview asks us to stop (covers server
      // restarts and transient failures; the React side sees a stable stream).
      if (!abort.signal.aborted && !entry.closed && !this.disposed) {
        setTimeout(() => void stream(), 1000);
      }
    };

    void stream();
  }

  private closeEventStream(url: string): void {
    const entry = this.eventStreams.get(url);
    if (entry) {
      entry.closed = true;
      entry.abort.abort();
      this.eventStreams.delete(url);
    }
  }

  private post(message: unknown): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }
}
