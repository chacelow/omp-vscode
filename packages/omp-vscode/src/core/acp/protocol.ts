import type {
  AuthMethod,
  AvailableCommand,
  ContentBlock,
  CreateElicitationRequest,
  ElicitationContentValue,
  PlanEntry,
  SessionConfigOption,
  SessionMode,
  ToolCall,
} from "@agentclientprotocol/sdk";

export type AcpConnectionState = "idle" | "starting" | "ready" | "unavailable" | "shutting_down";

export interface AcpSessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  messageCount?: number;
}

export type AcpMessage =
  | { id: string; role: "user" | "assistant" | "thought"; content: ContentBlock[]; local?: boolean }
  | { id: string; role: "toolCall"; toolCallId: string; content: [] };

export interface AcpSessionState extends AcpSessionInfo {
  messages: AcpMessage[];
  toolCalls: Record<string, ToolCall>;
  availableCommands: AvailableCommand[];
  currentMode?: string;
  availableModes: SessionMode[];
  configOptions: SessionConfigOption[];
  plan: PlanEntry[];
  // Internal snapshot revision — never exposed to UI.
  revision: number;
  // ACP `usage_update` payload: `used` (tokens in context) + `size` (context
  // window). Both are REQUIRED numbers per the SDK schema. omp emits this
  // only at end-of-turn — never at bootstrap — so absence of `usage` means
  // "no live turn has completed since we attached to this session", not "0
  // tokens".
  usage?: { used: number; contextWindow: number };
  stopReason?: string;
  loaded: boolean;
  replaying: boolean;
  promptPending: boolean;
  error?: string;
}

export interface AcpCapabilitySnapshot {
  protocolVersion: number;
  agentInfo: { name: string; title?: string; version: string } | null;
  authMethods: AuthMethod[];
  loadSession: boolean;
  prompts: { image: boolean; audio: boolean; embeddedContext: boolean };
  sessions: {
    list: boolean;
    delete: boolean;
    fork: boolean;
    resume: boolean;
    close: boolean;
    additionalDirectories: boolean;
  };
  mcp: { http: boolean; sse: boolean };
  elicitation: { form: boolean; url: boolean };
}

export interface AcpConnectionSnapshot {
  state: AcpConnectionState;
  executable: string;
  version?: string;
  error?: string;
  capabilities: AcpCapabilitySnapshot | null;
}

export interface AcpPermissionRequest {
  resolverId: string;
  sessionId: string;
  toolCall: { toolCallId: string; title?: string; kind?: string; status?: string };
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export interface AcpElicitationRequest {
  resolverId: string;
  sessionId?: string;
  request: CreateElicitationRequest;
}

// ---- Typed request union ----
export type AcpRequest =
  | { type: "acp/start" }
  | { type: "acp/listSessions"; cwd?: string }
  | { type: "acp/newSession"; cwd: string }
  | { type: "acp/loadSession"; sessionId: string; cwd: string }
  | { type: "acp/resumeSession"; sessionId: string; cwd: string }
  | { type: "acp/forkSession"; sessionId: string; cwd: string }
  | { type: "acp/closeSession"; sessionId: string }
  | { type: "acp/prompt"; sessionId: string; prompt: ContentBlock[] }
  | { type: "acp/cancel"; sessionId: string }
  | { type: "acp/setMode"; sessionId: string; modeId: string }
  | { type: "acp/setConfigOption"; sessionId: string; configId: string; value: string | boolean }
  | { type: "acp/respondPermission"; resolverId: string; optionId?: string }
  | { type: "acp/respondElicitation"; resolverId: string; action: "accept" | "decline" | "cancel"; content?: Record<string, ElicitationContentValue> }
  | { type: "acp/subscribeSession"; sessionId: string }
  | { type: "acp/unsubscribeSession"; sessionId: string }
  | { type: "acp/deleteSession"; sessionId: string }
  | { type: "acp/extMethod"; method: string; params: Record<string, unknown> };

// ---- Typed response envelope ----
export interface AcpRequestError {
  code: "unavailable" | "invalid-request" | "not-found" | "conflict" | "internal";
  message: string;
}

export type AcpResponseEnvelope =
  | { type: "acp/response"; requestId: number; ok: true; data: unknown }
  | { type: "acp/response"; requestId: number; ok: false; error: AcpRequestError };

// ---- Typed event union (Host → Webview) ----
export type AcpHostEvent =
  | { type: "acp/connection"; snapshot: AcpConnectionSnapshot }
  | { type: "acp/sessionSnapshot"; sessionId: string; state: AcpSessionState }
  | { type: "acp/runningSessions"; sessionIds: string[] }
  | { type: "acp/permissionRequest"; request: AcpPermissionRequest }
  | { type: "acp/elicitationRequest"; request: AcpElicitationRequest }
  | { type: "acp/notice"; sessionId?: string; level: "info" | "success" | "warning" | "error"; message: string }
  | { type: "acp/error"; message: string };

// ---- Webview → Host message union ----
export type AcpWebviewMessage =
  | { type: "acp/request"; requestId: number; request: AcpRequest }
  | { type: "host/call"; requestId: number; method: string; params: unknown }
  | { type: "log"; level: "info" | "error"; message: string; stack?: string }
  | { type: "openFile"; path: string; cwd?: string }
  | { type: "openImage"; data: string; mimeType: string };
