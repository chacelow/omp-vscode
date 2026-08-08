import { ompPost } from "./boot";

// Bridge between the omp-web React app (running inside the webview) and the
// VS Code extension host.
//
// omp-web's UI calls fetch("/api/...") and new EventSource("/api/.../events").
// The webview is cross-origin (vscode-webview:// vs http://127.0.0.1:30141)
// and omp-web sets no CORS headers, so we monkey-patch both primitives:
//   - fetch("/api/*")        → postMessage to the host, which proxies to omp-web
//   - EventSource("/api/*")  → host streams SSE events and forwards them here
//
// The React components themselves are untouched.


// ---------------------------------------------------------------------------
// Host → webview messages (api responses + forwarded SSE events)
// ---------------------------------------------------------------------------

interface HostMessage {
  type?: string;
  requestId?: number;
  status?: number;
  body?: unknown;
  error?: string;
  url?: string;
  event?: unknown;
  cli?: string;
  pi?: string;
  omp?: string;
}

type PendingRequest = {
  resolve: (resp: { status: number; body: unknown }) => void;
  reject: (err: Error) => void;
};

const pending = new Map<number, PendingRequest>();
let seq = 0;

/** Webview-side log routed to the host's "OMP Chat" output channel. */
function bridgeLog(message: string): void {
  ompPost({ type: "log", level: "info", message: `[bridge] ${message}` });
}

interface BridgeEventSourceLike {
  url: string;
  readyState: number;
  CONNECTING: number;
  OPEN: number;
  CLOSED: number;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onopen: ((ev: Event) => void) | null;
  addEventListener: (type: string, cb: (ev: Event) => void) => void;
  removeEventListener: (type: string, cb: (ev: Event) => void) => void;
  close: () => void;
  _listeners: Record<string, Array<(ev: Event) => void>>;
}

const eventSources: BridgeEventSourceLike[] = [];

window.addEventListener("message", (ev: MessageEvent<HostMessage>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "apiResponse") {
    const p = pending.get(msg.requestId ?? -1);
    if (!p) return;
    pending.delete(msg.requestId ?? -1);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve({ status: msg.status ?? 200, body: msg.body });
    return;
  }

  if (msg.type === "event" && typeof msg.url === "string" && msg.event) {
    for (const es of eventSources) {
      if (es.url === msg.url && es.onmessage) {
        const evt = { data: JSON.stringify(msg.event) } as MessageEvent;
        es.onmessage(evt);
        for (const cb of es._listeners["message"] ?? []) cb(evt);
      }
    }
    return;
  }

  if (msg.type === "eventsClosed" && typeof msg.url === "string") {
    for (const es of eventSources) {
      if (es.url === msg.url) {
        es.readyState = es.CLOSED;
        const err = new Event("error");
        es.onerror?.(err);
        for (const cb of es._listeners["error"] ?? []) cb(err);
      }
    }
    return;
  }

  if (msg.type === "versions") {
    // /api/version can respond before React mounts ChatWindow and registers its
    // event listener. Cache the latest value so the component can initialize
    // from it instead of losing this one-shot host message.
    const versions = {
      cli: typeof msg.cli === "string" ? msg.cli : "",
      pi: typeof msg.pi === "string" ? msg.pi : "",
      omp: typeof msg.omp === "string" ? msg.omp : "",
    };
    (globalThis as { __OMP_VERSIONS?: typeof versions }).__OMP_VERSIONS = versions;
    window.dispatchEvent(new CustomEvent("omp-versions", { detail: versions }));
    return;
  }
});

// ---------------------------------------------------------------------------
// fetch bridge
// ---------------------------------------------------------------------------

const originalFetch = window.fetch.bind(window);

function isApiUrl(url: string): boolean {
  return url.startsWith("/api/") || (url.includes("/api/") && url.startsWith("http://127.0.0.1"));
}

async function bridgedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? "GET").toUpperCase();

  if (!isApiUrl(url)) {
    return originalFetch(input, init);
  }

  bridgeLog(`fetch ${method} ${url}`);

  const requestId = ++seq;
  const promise = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
  });

  const body = init?.body;
  ompPost({
    type: "api",
    requestId,
    url,
    method,
    headers: init?.headers,
    body: typeof body === "string" ? body : undefined,
  });

  const resp = await promise;
  bridgeLog(`← ${method} ${url} ${resp.status}`);
  const text = typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body ?? null);
  return new Response(text, {
    status: resp.status,
    headers: { "Content-Type": "application/json" },
  });
}

window.fetch = bridgedFetch as typeof fetch;

// ---------------------------------------------------------------------------
// EventSource bridge
// ---------------------------------------------------------------------------

class BridgeEventSource implements BridgeEventSourceLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readyState = BridgeEventSource.CONNECTING;

  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  _listeners: Record<string, Array<(ev: Event) => void>> = {};

  constructor(url: string) {
    this.url = url;
    eventSources.push(this);
    bridgeLog(`EventSource open ${url}`);
    ompPost({ type: "events", url });
  }

  close(): void {
    this.readyState = BridgeEventSource.CLOSED;
    const i = eventSources.indexOf(this);
    if (i !== -1) eventSources.splice(i, 1);
    ompPost({ type: "eventsClose", url: this.url });
  }

  addEventListener(type: string, cb: (ev: Event) => void): void {
    (this._listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: (ev: Event) => void): void {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i !== -1) arr.splice(i, 1);
  }
}

window.EventSource = BridgeEventSource as unknown as typeof EventSource;

// React requests versions after ChatWindow has mounted its listener. Keeping
// the request behind an event removes the module-load race for fast responses.
window.addEventListener("omp-request-versions", () => {
  ompPost({ type: "getVersions" });
});
