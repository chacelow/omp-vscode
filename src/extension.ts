import * as vscode from "vscode";
import { OmpServerManager } from "./core/server-manager";
import { ChatProvider } from "./providers/chat-provider";

// OMP Chat — VS Code extension.
//
// The entire omp-web UI (AppShell + components, copied into src/ui/omp/) runs
// inside one sidebar WebviewView. Every fetch/EventSource call from the React
// app is bridged to this host, which proxies them to the local omp-web
// service (HTTP + SSE). The service itself is untouched.
//
//   webview (omp-web UI) ──postMessage──► host (fetch/SSE proxy) ──► omp-web

let server: OmpServerManager;
let chat: ChatProvider;
let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  server = new OmpServerManager();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(hubot) OMP";
  statusBar.command = "omp.openChat";
  statusBar.tooltip = "OMP Chat — open";
  statusBar.show();

  chat = ChatProvider.get({ server });

  // Startup: ensure the server is reachable.
  await ensureServerWithFeedback();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("omp.chat", chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("omp.openChat", () => {
      void chat.createOrShow();
    }),
    vscode.commands.registerCommand("omp.startServer", async () => {
      await server.ensureRunning();
    }),
    vscode.commands.registerCommand("omp.stopServer", async () => {
      await server.stop();
    }),
  );
}

async function ensureServerWithFeedback(): Promise<void> {
  try {
    await server.ensureRunning();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const choice = await vscode.window.showErrorMessage(
      `OMP: ${message}`,
      "Start Server",
    );
    if (choice === "Start Server") {
      try {
        await server.ensureRunning();
      } catch (err2) {
        void vscode.window.showErrorMessage(`OMP: ${err2 instanceof Error ? err2.message : String(err2)}`);
      }
    }
  }
}

export async function deactivate(): Promise<void> {
  const stopOnExit = vscode.workspace.getConfiguration("omp").get<boolean>("server.stopOnExit", true);
  if (stopOnExit && server) {
    await server.stop();
  }
  chat?.disposeAll();
}
