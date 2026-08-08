import * as vscode from "vscode";
import { ApiHandler } from "../core/api";

// Sidebar chat view hosting the omp-web React app (AppShell) inside a
// WebviewView. The React app is bundled as dist/webview.js and talks to the
// extension host through the fetch/EventSource bridge in src/ui/bridge.ts.
// This provider only:
//   - resolves the webview (HTML/CSP)
//   - answers /api/* fetch calls from the in-memory ApiHandler (embedded OMP
//     RPC session manager — no HTTP server, no port)
//   - forwards session/running events to the webview
//   - spawns `omp --mode rpc` subprocesses on demand (via the ApiHandler)

export class ChatProvider implements vscode.WebviewViewProvider {
  private static instance: ChatProvider | null = null;

  static get(api: ApiHandler): ChatProvider {
    if (!ChatProvider.instance) ChatProvider.instance = new ChatProvider(api);
    return ChatProvider.instance;
  }

  static dispose(): void {
    ChatProvider.instance?.disposeInternal();
    ChatProvider.instance = null;
  }

  private view: vscode.WebviewView | null = null;
  private api: ApiHandler;
  private eventStreams = new Map<string, { closed: boolean }>();
  private runningUnsub: (() => void) | null = null;
  private disposed = false;
  private readonly log = vscode.window.createOutputChannel("OMP Chat");

  private constructor(api: ApiHandler) {
    this.api = api;
  }

  // -------------------------------------------------------------------------
  // WebviewViewProvider
  // -------------------------------------------------------------------------

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.disposed = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extUri(), "dist"),
        vscode.Uri.joinPath(this.extUri(), "media"),
      ],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => {
      void this.handleWebviewMessage(msg);
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.disposeInternal();
    });
  }

  /** Focus the sidebar chat view. No server to start — sessions spawn on demand. */
  async createOrShow(): Promise<void> {
    await vscode.commands.executeCommand("omp.chat.focus");
  }

  private extUri(): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.file(__dirname), "..");
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extUri(), "dist", "webview.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extUri(), "dist", "webview.css"));
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
    this.runningUnsub?.();
    this.runningUnsub = null;
    this.eventStreams.clear();
    this.view = null;
  }

  /** Dispose resources owned by the singleton (called on extension deactivate). */
  disposeAll(): void {
    this.disposeInternal();
    this.log.dispose();
  }

  // -------------------------------------------------------------------------
  // Bridge
  // -------------------------------------------------------------------------

  private async handleWebviewMessage(msg: {
    type: string;
    requestId?: number;
    url?: string;
    method?: string;
    body?: string;
    level?: string;
    message?: string;
    stack?: string;
  }): Promise<void> {
    try {
      switch (msg.type) {
        case "log":
          this.log.appendLine(`[${msg.level}] ${msg.message}${msg.stack ? `\n${msg.stack}` : ""}`);
          break;

        case "api": {
          const resp = await this.api.handle(msg.url ?? "", msg.method ?? "GET", msg.body);
          this.post({ type: "apiResponse", requestId: msg.requestId, status: resp.status, body: resp.body });
          break;
        }

        case "events":
          this.startEventStream(msg.url ?? "");
          break;

        case "eventsClose":
          this.closeEventStream(msg.url ?? "");
          break;

        case "getVersions": {
          const resp = await this.api.handle("/api/version", "GET");
          const body = (resp.body ?? {}) as { pi?: string; omp?: string; cli?: string };
          this.post({ type: "versions", cli: body.cli ?? "", pi: body.pi ?? "", omp: body.omp ?? "" });
          break;
        }
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
  // Event streams (SSE simulation over postMessage)
  // -------------------------------------------------------------------------

  private sessionIdFromUrl(url: string): string | null {
    const m = url.match(/\/api\/agent\/([^/]+)\/events/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  private isRunningStreamUrl(url: string): boolean {
    return url.includes("/api/agent/running/events");
  }

  private startEventStream(url: string): void {
    if (this.eventStreams.has(url)) return;
    const entry = { closed: false };
    this.eventStreams.set(url, entry);

    if (this.isRunningStreamUrl(url)) {
      this.runningUnsub?.();
      this.runningUnsub = this.api.subscribeRunning((ids) => {
        if (entry.closed || this.disposed) return;
        this.post({ type: "event", url, event: { type: "running", runningSessionIds: ids } });
      });
      // Initial snapshot
      void this.api.handle("/api/agent/running", "GET").then((resp) => {
        if (entry.closed || this.disposed) return;
        const body = resp.body as { runningSessionIds?: string[] };
        this.post({ type: "event", url, event: { type: "running", runningSessionIds: body.runningSessionIds ?? [] } });
      });
      return;
    }

    const sid = this.sessionIdFromUrl(url);
    if (!sid) return;

    const unsub = this.api.subscribeSession(sid, (event) => {
      if (entry.closed || this.disposed) return;
      this.post({ type: "event", url, event });
    });
    entry.closed = false;
    (entry as { unsub?: () => void }).unsub = unsub;
  }

  private closeEventStream(url: string): void {
    const entry = this.eventStreams.get(url);
    if (!entry) return;
    entry.closed = true;
    (entry as { unsub?: () => void }).unsub?.();
    this.eventStreams.delete(url);
    if (this.isRunningStreamUrl(url)) {
      this.runningUnsub?.();
      this.runningUnsub = null;
    }
  }

  private post(message: unknown): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }
}
