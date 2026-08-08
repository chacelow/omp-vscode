import type {
  AgentEvent,
  AgentStateResponse,
  EnsureSessionResponse,
  GetStateResponse,
  SessionData,
  SessionsResponse,
  SlashCommandInfo,
} from "./types";
// All requests are made from the extension host (Node), because omp-web sets
// no CORS headers and webviews cannot reach it directly.

export interface ModelsResponse {
  models: Record<string, string>;
  modelList?: Array<{ provider: string; id: string; name?: string; contextWindow?: number }>;
  defaultModel?: { provider: string; modelId: string } | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
}

// Typed HTTP + SSE client for the omp-web local service.

export interface EnsureSessionOptions {
  toolNames?: string[];
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

export class OmpClient {
  constructor(private readonly baseUrl: string) {}

  // -------------------------------------------------------------------------
  // REST
  // -------------------------------------------------------------------------

  /** Raw proxy for webview fetch() calls — returns status + parsed body. */
  async rawRequest(
    url: string,
    method: string,
    body?: string,
  ): Promise<{ status: number; body: unknown }> {
    try {
      const res = await fetch(`${this.baseUrl}${url}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep raw text for non-JSON responses
      }
      return { status: res.status, body: parsed };
    } catch (err) {
      return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; [key: string]: unknown };
    if (!res.ok || body.error) {
      throw new Error(body.error ?? `HTTP ${res.status} ${path}`);
    }
    return body as T;
  }

  getSessions(): Promise<SessionsResponse> {
    return this.request<SessionsResponse>("/api/sessions");
  }

  getDefaultCwd(): Promise<{ cwd?: string }> {
    return this.request<{ cwd?: string }>("/api/default-cwd");
  }

  getModels(cwd?: string): Promise<ModelsResponse> {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    return this.request<ModelsResponse>(`/api/models${query}`);
  }

  /** Create a new session (type: ensure_session only spins up the runtime). */
  async ensureSession(cwd: string, options: EnsureSessionOptions = {}): Promise<EnsureSessionResponse> {
    return this.request<EnsureSessionResponse>("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({
        cwd,
        type: "ensure_session",
        ...(options.toolNames ? { toolNames: options.toolNames } : {}),
        ...(options.provider && options.modelId ? { provider: options.provider, modelId: options.modelId } : {}),
        ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      }),
    });
  }

  /** Send a command to an existing session (prompt, abort, bash, ...). */
  async sendCommand<T = unknown>(sessionId: string, command: Record<string, unknown>): Promise<T> {
    return this.request<{ success: boolean; data?: T }>(`/api/agent/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: JSON.stringify(command),
    }).then((body) => body.data as T);
  }

  getSessionState(sessionId: string): Promise<GetStateResponse> {
    return this.request<GetStateResponse>(`/api/agent/${encodeURIComponent(sessionId)}`);
  }

  /** Load a persisted session's messages. */
  loadSession(sessionId: string): Promise<SessionData> {
    return this.request<SessionData>(
      `/api/sessions/${encodeURIComponent(sessionId)}?deferThinking=1&deferMedia=1`,
    );
  }

  async getCommands(sessionId: string): Promise<SlashCommandInfo[]> {
    const data = await this.sendCommand<{ commands?: SlashCommandInfo[] }>(sessionId, { type: "get_commands" });
    return data?.commands ?? [];
  }

  // -------------------------------------------------------------------------
  // SSE event stream
  // -------------------------------------------------------------------------

  /**
   * Stream agent events for a session over SSE. Resolves when the stream ends
   * (clean close or abort). Reconnectable by the caller.
   */
  async streamEvents(
    sessionId: string,
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/agent/${encodeURIComponent(sessionId)}/events`, {
      signal,
      headers: { Accept: "text/event-stream" },
    });
    if (!res.ok || !res.body) {
      throw new Error(`Event stream HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE framing: events separated by blank lines; `data: <json>` payloads.
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          // Also handle \r\n framing
          const clean = frame.replace(/\r\n/g, "\n");
          const dataLines = clean
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6).trim());
          // Heartbeat comments (`: ...`) carry no data; skip empty payloads.
          for (const payload of dataLines) {
            if (!payload) continue;
            try {
              onEvent(JSON.parse(payload) as AgentEvent);
            } catch {
              // ignore malformed frames
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
