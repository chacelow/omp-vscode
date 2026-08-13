// boot.ts — must be the FIRST module imported by main.tsx.
//
// Registers global error handlers and a postMessage helper as early as
// possible, so that any crash later in the bundle (bridge, React, components)
// is reported to the extension host ("OMP Chat" output channel) instead of
// silently producing a blank webview.

declare function acquireVsCodeApi(): { postMessage: (msg: unknown) => void };

// acquireVsCodeApi() may only be called ONCE per webview; expose the single
// instance globally so other modules (e.g. ChatWindow) can post without
// calling it again.
const vscode = acquireVsCodeApi();
(
  globalThis as { __ompVscode?: { postMessage: (msg: unknown) => void } }
).__ompVscode = vscode;

export function ompPost(msg: unknown): void {
  try {
    vscode.postMessage(msg);
  } catch {
    // host unreachable
  }
}

/** Compact structured trace to the OMP Chat output channel. Format
 *  `[hh:mm:ss.mmm] [webview/<tag>] k=v k=v ...` — cheap to scan for
 *  duplicate calls and slow spots. */
export function ompTrace(tag: string, fields: Record<string, unknown>): void {
  const stamp = new Date().toISOString().slice(11, 23);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${s.length > 80 ? `${s.slice(0, 80)}…` : s}`);
  }
  ompPost({
    type: "log",
    level: "info",
    message: `[${stamp}] [webview/${tag}] ${parts.join(" ")}`,
  });
}

// Marker so the host can confirm the bundle executed at all.
ompPost({ type: "log", level: "info", message: "[webview] boot ok" });

window.addEventListener("error", (e) => {
  const msg = e.message ?? String(e.error ?? "unknown error");
  ompPost({
    type: "log",
    level: "error",
    message: `[webview:error] ${msg}`,
    stack: e.error?.stack,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  const msg =
    e.reason instanceof Error
      ? e.reason.message
      : String(e.reason ?? "unhandled rejection");
  ompPost({
    type: "log",
    level: "error",
    message: `[webview:unhandledrejection] ${msg}`,
    stack: e.reason instanceof Error ? e.reason.stack : undefined,
  });
});

// Make `process` safe for any bundled code that references it on dead paths.
(globalThis as { process?: unknown }).process ??= {
  env: {} as Record<string, string>,
};
