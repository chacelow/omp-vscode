import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { HostService } from "../core/host/host-service";
import { AcpService } from "../core/acp/acp-service";
import type {
  AcpConnectionSnapshot,
  AcpElicitationRequest,
  AcpHostEvent,
  AcpPermissionRequest,
  AcpRequest,
  AcpResponseEnvelope,
  AcpSessionState,
  AcpWebviewMessage,
} from "../core/acp/protocol";

export type PanelKind = "chat" | "workbench";

export class ChatProvider implements vscode.WebviewViewProvider {
  private static instance: ChatProvider | null = null;

  static get(acp: AcpService, host: HostService): ChatProvider {
    if (!ChatProvider.instance) {
      ChatProvider.instance = new ChatProvider(acp, host);
    }
    return ChatProvider.instance;
  }

  static dispose(): void {
    ChatProvider.instance?.disposeInternal();
    ChatProvider.instance = null;
  }

  private view: vscode.WebviewView | null = null;
  private workbenchPanel: vscode.WebviewPanel | null = null;
  private acp: AcpService;
  private host: HostService;
  private sessionSubs = new Map<string, () => void>();
  private connectionUnsub: (() => void) | null = null;
  private runningUnsub: (() => void) | null = null;
  private noticeUnsub: (() => void) | null = null;
  private permissionUnsub: (() => void) | null = null;
  private elicitationUnsub: (() => void) | null = null;
  private disposed = false;
  private readonly log = vscode.window.createOutputChannel("OMP Chat");

  private constructor(acp: AcpService, host: HostService) {
    this.acp = acp;
    this.host = host;
  }

  // -------------------------------------------------------------------------
  // WebviewViewProvider (sidebar chat)
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

    webviewView.webview.html = this.buildHtml(webviewView.webview, "chat");
    webviewView.webview.onDidReceiveMessage((msg) => {
      const bodyBrief = typeof msg.body === "string" ? msg.body.slice(0, 120) : "";
      this.log.appendLine(`[${new Date().toISOString().slice(11, 23)}] [webview:chat] ${msg.type}${msg.url ? ` ${msg.url}` : ""}${msg.method ? ` ${msg.method}` : ""} ${bodyBrief}`);
      void this.handleWebviewMessage(msg);
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = null;
      this.updateSubscriptions();
    });

    this.updateSubscriptions();
  }

  /** Focus the sidebar chat view. */
  async createOrShow(): Promise<void> {
    await vscode.commands.executeCommand("omp.chat.focus");
  }

  /** Open (or focus) the OMP Workbench as an editor tab. */
  openWorkbench(): void {
    if (this.workbenchPanel) {
      this.workbenchPanel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "omp.workbench",
      "OMP Workbench",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extUri(), "dist"),
          vscode.Uri.joinPath(this.extUri(), "media"),
        ],
      },
    );
    this.workbenchPanel = panel;
    panel.webview.html = this.buildHtml(panel.webview, "workbench");
    panel.webview.onDidReceiveMessage((msg) => {
      const bodyBrief = typeof msg.body === "string" ? msg.body.slice(0, 120) : "";
      this.log.appendLine(`[${new Date().toISOString().slice(11, 23)}] [webview:workbench] ${msg.type}${msg.method ? ` ${msg.method}` : ""} ${bodyBrief}`);
      void this.handleWebviewMessage(msg);
    });
    panel.onDidDispose(() => {
      if (this.workbenchPanel === panel) this.workbenchPanel = null;
      this.updateSubscriptions();
    });
    this.updateSubscriptions();
  }

  private extUri(): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.file(__dirname), "..");
  }

  private buildHtml(webview: vscode.Webview, kind: PanelKind): string {
    const cacheBust = (): string => {
      try {
        return String(
          fs.statSync(vscode.Uri.joinPath(this.extUri(), "dist", "webview.js").fsPath).mtimeMs,
        );
      } catch {
        return Date.now().toString();
      }
    };
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extUri(), "dist", "webview.js"))
      .with({ query: `v=${cacheBust()}` });
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extUri(), "dist", "webview.css"))
      .with({ query: `v=${cacheBust()}` });
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob: https: http:`,
      `font-src ${webview.cspSource} data:`,
      "connect-src 'none'",
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en" translate="no">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>${kind === "workbench" ? "OMP Workbench" : "OMP Chat"}</title>
</head>
<body class="notranslate">
  <div id="app" data-cwd="${cwd.replace(/"/g, "&quot;")}" data-panel="${kind}">
    <div style="padding:20px;font-family:monospace;font-size:12px;color:var(--vscode-descriptionForeground,#999)">Loading OMP…</div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  /** Post a message to every active webview surface (chat + workbench). */
  private updateSubscriptions(): void {
    const anyActive = this.view !== null || this.workbenchPanel !== null;
    if (!anyActive) {
      this.disposeSubscriptionsOnly();
      return;
    }
    if (this.connectionUnsub) return;
    this.connectionUnsub = this.acp.subscribeConnection((snapshot) => {
      this.post({ type: "acp/connection", snapshot });
    });
    this.runningUnsub = this.acp.subscribeRunning((ids) => {
      this.post({ type: "acp/runningSessions", sessionIds: ids });
    });
    this.permissionUnsub = this.acp.subscribePermission((request) => {
      this.post({ type: "acp/permissionRequest", request });
    });
    this.elicitationUnsub = this.acp.subscribeElicitation((request) => {
      this.post({ type: "acp/elicitationRequest", request });
    });
    this.noticeUnsub = this.acp.subscribeNotice((sessionId, level, message) => {
      this.post({ type: "acp/notice", sessionId, level, message });
    });
  }

  private disposeSubscriptionsOnly(): void {
    this.connectionUnsub?.();
    this.connectionUnsub = null;
    this.runningUnsub?.();
    this.runningUnsub = null;
    this.permissionUnsub?.();
    this.permissionUnsub = null;
    this.elicitationUnsub?.();
    this.elicitationUnsub = null;
    this.noticeUnsub?.();
    this.noticeUnsub = null;
    for (const unsub of this.sessionSubs.values()) unsub();
    this.sessionSubs.clear();
  }

  private disposeInternal(): void {
    this.disposed = true;
    this.disposeSubscriptionsOnly();
    this.view = null;
    this.workbenchPanel?.dispose();
    this.workbenchPanel = null;
  }

  /** Dispose resources owned by the singleton (called on extension deactivate). */
  disposeAll(): void {
    this.disposeInternal();
    this.log.dispose();
  }

  // -------------------------------------------------------------------------
  // Webview → Host message handler
  // -------------------------------------------------------------------------

  private async handleWebviewMessage(msg: AcpWebviewMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "log":
          this.log.appendLine(`[${msg.level}] ${msg.message}${msg.stack ? `\n${msg.stack}` : ""}`);
          break;

        case "openFile": {
          // Agents commonly append line ranges to paths (`file.ts:12`, `file.ts:12-24`,
          // `file.ts#L12`, `file.ts#L12-24`). Split them off before touching the FS
          // so the actual file is found; otherwise `stat` would falsely report the
          // path as missing and the "File not found" warning would fire on valid files.
          const raw = msg.path;
          const rangeMatch = raw.match(/^(?<file>.+?)(?:[:#]L?(?<start>\d+)(?:[-:]L?(?<end>\d+))?)?$/);
          const rawFile = rangeMatch?.groups?.file ?? raw;
          const startLine = rangeMatch?.groups?.start ? Math.max(0, Number.parseInt(rangeMatch.groups.start, 10) - 1) : null;
          const endLine = rangeMatch?.groups?.end ? Math.max(0, Number.parseInt(rangeMatch.groups.end, 10) - 1) : startLine;
          // Agents emit repo-relative paths (`apps/foo/bar.tsx`); resolve them
          // against the session cwd, then fall back to each workspace folder.
          // Absolute paths are used as-is.
          const filePath = await this.resolveOpenFilePath(rawFile, msg.cwd);
          if (!filePath) {
            void vscode.window.showWarningMessage(`File not found: ${rawFile}`);
            this.log.appendLine(`[openFile] missing: ${rawFile}`);
            this.replyToWebview(null, { type: "acp/response", requestId: 0, ok: true, data: null });
            break;
          }
          const uri = vscode.Uri.file(filePath);
          let stat: vscode.FileStat;
          try {
            stat = await vscode.workspace.fs.stat(uri);
          } catch {
            void vscode.window.showWarningMessage(`File not found: ${filePath}`);
            this.log.appendLine(`[openFile] missing: ${filePath}`);
            this.replyToWebview(null, { type: "acp/response", requestId: 0, ok: true, data: null });
            break;
          }
          // Directories can't be opened as text documents ("无法读取实际上
          // 是一个目录的文件"). Reveal them in the OS file manager instead.
          if (stat.type & vscode.FileType.Directory) {
            await vscode.commands.executeCommand("revealFileInOS", uri);
            this.replyToWebview(null, { type: "acp/response", requestId: 0, ok: true, data: null });
            break;
          }
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const options: vscode.TextDocumentShowOptions = { preview: false };
            if (startLine !== null) {
              const start = new vscode.Position(startLine, 0);
              const end = new vscode.Position(endLine ?? startLine, 0);
              options.selection = new vscode.Range(start, end);
            }
            await vscode.window.showTextDocument(doc, options);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`Failed to open ${filePath}: ${message}`);
          }
          this.replyToWebview(null, { type: "acp/response", requestId: 0, ok: true, data: null });
          break;
        }

        case "openImage": {
          const ext = msg.mimeType?.includes("png") ? "png" : msg.mimeType?.includes("webp") ? "webp" : msg.mimeType?.includes("gif") ? "gif" : "jpg";
          const tmp = path.join(os.tmpdir(), `omp-chat-image-${Date.now()}.${ext}`);
          fs.writeFileSync(tmp, Buffer.from(msg.data, "base64"));
          const uri = vscode.Uri.file(tmp);
          await vscode.commands.executeCommand("vscode.open", uri, { preview: true });
          this.replyToWebview(null, { type: "acp/response", requestId: 0, ok: true, data: null });
          break;
        }

        case "acp/request":
          await this.handleAcpRequest(msg.requestId, msg.request);
          break;

        case "host/call":
          await this.handleHostCall(msg.requestId, msg.method, msg.params);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (msg.type === "acp/request") {
        this.replyToWebview(msg.requestId, {
          type: "acp/response",
          requestId: msg.requestId,
          ok: false,
          error: { code: "internal", message },
        });
      } else if (msg.type === "host/call") {
        this.post({ type: "host/result", requestId: msg.requestId, ok: false, error: message });
      }
    }
  }

  private async handleAcpRequest(requestId: number, request: AcpRequest): Promise<void> {
    try {
      switch (request.type) {
        case "acp/start": {
          await this.acp.start();
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: this.acp.getSnapshot() });
          break;
        }

        case "acp/listSessions": {
          const sessions = await this.acp.listSessions(request.cwd);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: sessions });
          break;
        }

        case "acp/newSession": {
          const state = await this.acp.newSession(request.cwd);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: state });
          break;
        }

        case "acp/loadSession": {
          const state = await this.acp.loadSession(request.sessionId, request.cwd);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: state });
          break;
        }

        case "acp/resumeSession": {
          const state = await this.acp.resumeSession(request.sessionId, request.cwd);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: state });
          break;
        }

        case "acp/forkSession": {
          const state = await this.acp.forkSession(request.sessionId, request.cwd);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: state });
          break;
        }

        case "acp/closeSession": {
          await this.acp.closeSession(request.sessionId);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/prompt": {
          await this.acp.prompt(request.sessionId, request.prompt);
          const state = this.acp.getSessionSnapshot(request.sessionId);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: state });
          break;
        }

        case "acp/cancel": {
          await this.acp.cancelPrompt(request.sessionId);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/setMode": {
          await this.acp.setMode(request.sessionId, request.modeId);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/setConfigOption": {
          await this.acp.setConfigOption(request.sessionId, request.configId, request.value);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/respondPermission": {
          this.acp.respondPermission(request.resolverId, request.optionId);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/respondElicitation": {
          const response: import("@agentclientprotocol/sdk").CreateElicitationResponse =
            request.action === "accept"
              ? { action: "accept", content: request.content ?? {} }
              : { action: request.action };
          this.acp.respondElicitation(request.resolverId, response);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/extMethod": {
          const data = await this.acp.extMethod<unknown>(request.method, request.params);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data });
          break;
        }

        case "acp/subscribeSession": {
          const unsub = this.acp.subscribeSession(request.sessionId, (state) => {
            this.post({ type: "acp/sessionSnapshot", sessionId: request.sessionId, state });
          });
          this.sessionSubs.set(request.sessionId, unsub);
          // Send current snapshot
          const current = this.acp.getSessionSnapshot(request.sessionId);
          if (current) {
            this.post({ type: "acp/sessionSnapshot", sessionId: request.sessionId, state: current });
          }
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/unsubscribeSession": {
          const unsub = this.sessionSubs.get(request.sessionId);
          if (unsub) {
            unsub();
            this.sessionSubs.delete(request.sessionId);
          }
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }

        case "acp/deleteSession": {
          await this.acp.deleteSession(request.sessionId);
          this.replyToWebview(requestId, { type: "acp/response", requestId, ok: true, data: null });
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.replyToWebview(requestId, {
        type: "acp/response",
        requestId,
        ok: false,
        error: { code: "internal", message },
      });
    }
  }

  private async handleHostCall(requestId: number, method: string, params: unknown): Promise<void> {
    try {
      const data = await this.host.dispatch(method as never, params);
      this.post({ type: "host/result", requestId, ok: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "host/result", requestId, ok: false, error: message });
    }
  }

  private replyToWebview(requestId: number | null, envelope: AcpResponseEnvelope): void {
    this.post(envelope);
  }

  private post(message: unknown): void {
    if (this.view) void this.view.webview.postMessage(message);
    if (this.workbenchPanel) void this.workbenchPanel.webview.postMessage(message);
  }

  /**
   * Resolve a webview-supplied file path (possibly relative, possibly
   * repo-relative from the agent) to an existing absolute path.
   * Search order:
   *  1. Absolute path — used as-is if it exists.
   *  2. `${cwd}/${rawFile}` — session cwd from the webview (most common).
   *  3. Each `vscode.workspace.workspaceFolders[i].uri.fsPath / rawFile` —
   *     covers relative paths when the user has the repo open as a workspace
   *     folder but the session cwd wasn't threaded through.
   * Returns null if none of the candidates exist.
   */
  private async resolveOpenFilePath(rawFile: string, cwd: string | undefined): Promise<string | null> {
    const exists = async (candidate: string): Promise<boolean> => {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
        return true;
      } catch {
        return false;
      }
    };
    if (path.isAbsolute(rawFile)) {
      return (await exists(rawFile)) ? rawFile : null;
    }
    const candidates: string[] = [];
    if (cwd) candidates.push(path.resolve(cwd, rawFile));
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      candidates.push(path.resolve(folder.uri.fsPath, rawFile));
    }
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
    return null;
  }
}
