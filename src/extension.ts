import * as vscode from "vscode";
import { ApiHandler } from "./core/api";
import { ChatProvider } from "./providers/chat-provider";

// OMP Chat — VS Code extension (single project, zero ports).
//
// The entire omp-web UI (AppShell + components, copied into src/ui/omp/) runs
// inside one sidebar WebviewView. Every fetch/EventSource call from the React
// app is bridged to this host, which answers them from the embedded OMP RPC
// session manager (ApiHandler): it spawns `omp --mode rpc` subprocesses on
// demand and reads session files directly. No omp-web service, no HTTP
// server, no port — multiple VS Code windows never conflict.
//
//   webview (omp-web UI) ──postMessage──► host (ApiHandler) ──spawn stdio──► omp --mode rpc

let api: ApiHandler;
let chat: ChatProvider;
let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  api = new ApiHandler();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(hubot) OMP";
  statusBar.command = "omp.openChat";
  statusBar.tooltip = "OMP Chat — open";
  statusBar.show();

  chat = ChatProvider.get(api);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("omp.chat", chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("omp.openChat", () => {
      void chat.createOrShow();
    }),
  );
}

export async function deactivate(): Promise<void> {
  chat?.disposeAll();
}
