// Webview entry: boot the omp-web React app inside VS Code.
//
// Order matters: boot (error capture) and bridge (fetch/EventSource proxy)
// must be installed before any component runs.

import "./boot";
import { ompPost } from "./boot";
import "./bridge";
import { TooltipProvider } from "./omp/components/ui/tooltip";

ompPost({
  type: "log",
  level: "info",
  message: "[webview] bridge installed, rendering…",
});

// ---------------------------------------------------------------------------
// React bootstrap with error boundary
// ---------------------------------------------------------------------------

import React, { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./omp/components/AppShell";
import { WorkbenchShell } from "./omp/components/WorkbenchShell";
import { I18nProvider } from "./omp/hooks/useI18n";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    ompPost({
      type: "log",
      level: "error",
      message: `[webview:component] ${error.message}`,
      stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontFamily: "monospace", fontSize: 12 }}>
          <h3 style={{ color: "#f48771" }}>OMP UI crashed</h3>
          <pre
            style={{
              color: "#d4d4d4",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 12, padding: "4px 12px" }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("app");
if (!container) throw new Error("missing #app root");

const panelKind =
  container.getAttribute("data-panel") === "workbench" ? "workbench" : "chat";
const RootView = panelKind === "workbench" ? WorkbenchShell : AppShell;

createRoot(container).render(
  <ErrorBoundary>
    <I18nProvider>
      <TooltipProvider>
        <RootView />
      </TooltipProvider>
    </I18nProvider>
  </ErrorBoundary>
);

ompPost({ type: "log", level: "info", message: "[webview] render() called" });
