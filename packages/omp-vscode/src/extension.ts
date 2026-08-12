import * as vscode from "vscode";
import { AcpService } from "./core/acp/acp-service";
import { ChatProvider } from "./providers/chat-provider";
import { HostService } from "./core/host/host-service";

// OMP Chat — VS Code extension (ACP-only edition).
//
// Two typed channels flow through the webview bridge (src/ui/bridge.ts):
//   1. `acp/*` — agent conversation over a single `omp acp` stdio connection,
//      owned by AcpService.
//   2. `host/*` — non-agent extension host services (models config, git
//      branch, file index, session-file JSONL operations, …), dispatched by
//      HostService to handlers in core/host/handlers/*.
//
// No RPC subprocess, no HTTP server, no port.

let acp: AcpService;
let host: HostService;
let chat: ChatProvider;
let statusBar: vscode.StatusBarItem;
let acpLog: vscode.OutputChannel | null = null;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const cwd =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  acp = new AcpService({
    cwd,
    clientName: "omp-vscode",
    clientVersion: "0.1.0",
    output: (line) => {
      if (!acpLog) acpLog = vscode.window.createOutputChannel("OMP ACP");
      acpLog.appendLine(line);
    },
  });

  host = new HostService({
    log: (acpLog ??= vscode.window.createOutputChannel("OMP ACP")),
    cwd,
    extensionVersion: String(context.extension.packageJSON.version ?? ""),
  });

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.text = "$(hubot) OMP";
  statusBar.command = "omp.openChat";
  statusBar.tooltip = "OMP Chat — open";
  statusBar.show();

  chat = ChatProvider.get(acp, host);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("omp.chat", chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("omp.openChat", () => {
      void chat.createOrShow();
    }),
    vscode.commands.registerCommand("omp.openWorkbench", () => {
      chat.openWorkbench();
    }),
    statusBar
  );

  void acp.start().catch((err) => {
    console.error("[OMP] Failed to start ACP:", err);
  });
}

export async function deactivate(): Promise<void> {
  void acp?.shutdown().catch(() => {
    /* ignore */
  });
  chat?.disposeAll();
}
