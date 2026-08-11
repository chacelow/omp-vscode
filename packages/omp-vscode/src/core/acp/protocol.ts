import type {
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

export interface AcpMessage {
  id: string;
  role: "user" | "assistant" | "thought";
  content: ContentBlock[];
  local?: boolean; // true = optimistic user insert, not from ACP
}

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
  usage?: { totalTokens: number; inputTokens: number; outputTokens: number };
  turnUsage?: { totalTokens: number; inputTokens: number; outputTokens: number };
  stopReason?: string;
  loaded: boolean;
  replaying: boolean;
  promptPending: boolean;
  error?: string;
}

export interface AcpConnectionSnapshot {
  state: AcpConnectionState;
  executable: string;
  version?: string;
  error?: string;
  imageSupported: boolean;
  embeddedContextSupported: boolean;
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
  | { type: "openFile"; path: string }
  | { type: "openImage"; data: string; mimeType: string };
