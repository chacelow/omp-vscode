// Typed host bridge protocol — webview <-> extension host, no HTTP/SSE.
//
// Every non-agent, non-omp interaction (models config, git branch, file
// index, cwd validation, worktrees, home, session-file operations, …) goes
// through this typed channel. The webview calls `hostCall(method, params)`;
// the extension host dispatches to a handler in `core/host/handlers/*` and
// posts a `host/result` envelope back.
//
// Agent interaction is separate — see `core/acp/protocol.ts` (`acpRequest`).

import type { SessionInfo, SessionTreeNode, AgentMessage } from "../types";

export interface HostMethods {
  version: {
    params: Record<string, never>;
    result: { pi: string; omp: string; cli: string };
  };
  modelsGet: { params: { cwd?: string }; result: ModelsResult };

  cwdValidate: {
    params: { cwd: string };
    result: { cwd?: string; error?: string };
  };
  cwdBrowse: { params: { path?: string }; result: BrowseResult };
  cwdGitBranch: { params: { cwd: string }; result: { branch: string | null } };
  fileIndex: { params: { cwd: string; q?: string }; result: FileIndexResult };
  urlComplete: {
    params: { scheme: string; query: string; cwd?: string | null };
    result: { items: Array<{ value: string; label?: string }> };
  };
  fsDirectoriesList: { params: { path?: string }; result: unknown };
  fsDirectoriesCreate: {
    params: { parentPath: string; folderName: string };
    result: unknown;
  };
  home: { params: Record<string, never>; result: { home: string } };
  defaultCwd: {
    params: Record<string, never>;
    result: { cwd?: string; error?: string };
  };
  projectTrustGet: {
    params: { cwd: string };
    result: { trusted: boolean; cwd?: string; projectRoot?: string };
  };
  projectTrustSet: { params: { cwd: string }; result: { trusted: boolean } };
  worktreesList: { params: { cwd: string }; result: unknown };
  worktreesCreate: { params: { cwd: string; branch: string }; result: unknown };
  worktreesDelete: {
    params: { cwd: string; path: string; force?: boolean };
    result: unknown;
  };
  openWorkbench: { params: Record<string, never>; result: { ok: true } };

  // stubs — mirror the shape webview components already tolerate.
  skillsSearch: { params: { query: string }; result: { results: unknown[] } };
  skillsInstall: {
    params: unknown;
    result: { success: boolean; error?: string };
  };
  skillsCheck: { params: unknown; result: { updates: unknown[] } };
  skillsUpdate: {
    params: unknown;
    result: { success: boolean; error?: string };
  };
  skillsPatch: {
    params: unknown;
    result: { success: boolean; error?: string };
  };
  pluginsAction: {
    params: unknown;
    result: { success: boolean; error?: string };
  };
  authProvidersList: {
    params: Record<string, never>;
    result: { providers: unknown[] };
  };
  authAllProvidersList: {
    params: Record<string, never>;
    result: { providers: unknown[] };
  };
  authLogin: { params: unknown; result: { success: boolean; error?: string } };
  authLogout: { params: { provider: string }; result: { success: boolean } };
  authApiKeySet: {
    params: unknown;
    result: { success: boolean; error?: string };
  };
  authApiKeyDelete: {
    params: unknown;
    result: { success: boolean; error?: string };
  };
  modelsConfigGet: {
    params: Record<string, never>;
    result: ModelsConfigResult;
  };
  modelsConfigSet: {
    params: unknown;
    result: { success: boolean; error?: string };
  };
  modelsConfigDiscover: { params: unknown; result: ModelsConfigDiscoverResult };
  modelsConfigMetadata: { params: unknown; result: ModelsConfigMetadataResult };
  modelsConfigTest: { params: unknown; result: ModelsConfigTestResult };
  modelsConfigCatalog: {
    params: { query: string; provider: string; baseUrl?: string };
    result: { recommendation?: unknown; error?: string };
  };
  settingsGet: {
    params: { category: string };
    result: Record<string, unknown>;
  };
  settingsList: {
    params: Record<string, never>;
    result: { values: Record<string, unknown> };
  };
  settingsSet: {
    params: { category: string; key: string; value: unknown };
    result: { success: true };
  };
  mcpAdd: {
    params: {
      name: string;
      scope: "user" | "project";
      transport: "stdio" | "http" | "sse";
      command?: string;
      args?: string[];
      url?: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    };
    result: { ok: boolean; output?: string; error?: string };
  };
  mcpTest: {
    params: { name: string; scope?: "user" | "project" };
    result: { ok: boolean; output?: string; error?: string };
  };
  mcpRemove: {
    params: { name: string; scope?: "user" | "project" };
    result: { ok: boolean; output?: string; error?: string };
  };
  authResetCredit: {
    params: { account: string };
    result: { ok: boolean; reason?: string };
  };

  // session-file ops (extension host reads/writes JSONL directly, no omp).
  sessionsList: {
    params: Record<string, never>;
    result: { sessions: SessionInfo[]; runningSessionIds?: string[] };
  };
  sessionDetail: {
    params: { sessionId: string };
    result: SessionDetailResult | null;
  };
  sessionRewind: {
    params: { sessionId: string; entryId: string };
    result: { success: true };
  };
  sessionNavigateLeaf: {
    params: { sessionId: string; entryId: string };
    result: { success: true };
  };
  sessionRename: {
    params: { sessionId: string; name: string };
    result: { success: true };
  };
  sessionDelete: { params: { sessionId: string }; result: { success: true } };
  sessionRenameEntry: {
    params: { sessionId: string; entryId: string; label: string };
    result: { success: true; path: string };
  };
  sessionAppendSummary: {
    params: { sessionId: string; entryId: string; summary: string };
    result: { success: true; path: string };
  };
  sessionsListAll: {
    params: Record<string, never>;
    result: { sessions: SessionInfo[]; runningSessionIds?: string[] };
  };
  sessionEntryThinking: {
    params: { sessionId: string; entryId: string; blockIndex: number };
    result: { thinking: string | null };
  };
  sessionBashOutput: {
    params: { sessionId: string; path: string };
    result: { success: boolean; data?: { output: string }; error?: string };
  };
  sessionTail: {
    params: { sessionId: string; sinceRevision: number | null };
    result: SessionTailResult | null;
  };
  agentsList: {
    params: Record<string, never>;
    result: { agents: AgentDefinitionSummary[] };
  };
  agentSave: {
    params: { name: string; definition: AgentDefinition };
    result: { success: true; path: string };
  };
}

export interface ModelsConfigResult {
  providers: Record<string, unknown>;
  modelRoles?: Record<string, unknown>;
  setupVersion?: number;
  [key: string]: unknown;
}

export interface ModelsConfigDiscoverResult {
  models?: Array<{ id: string; name?: string }>;
  endpoint?: string;
  error?: string;
}

export interface ModelsConfigMetadataResult {
  ok: boolean;
  contextWindow?: number;
  maxTokens?: number;
  source?: string;
  error?: string;
}

export interface ModelsConfigTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  status?: number;
  responseText?: string;
}

export interface ModelsResult {
  models: Record<string, string>;
  modelList: Array<{
    id: string;
    name: string;
    provider: string;
    contextWindow?: number;
  }>;
  defaultModel: { provider: string; modelId: string } | null;
  currentModel: { provider: string; modelId: string } | null;
  fastModeEnabled: boolean;
  fastModeActive: boolean;
  modelRoles: Record<
    string,
    { provider: string; modelId: string; thinkingLevel?: string }
  >;
  thinkingLevels: Record<string, string>;
  thinkingLevelMaps: Record<string, unknown>;
  thinkingLevelPins: Record<string, unknown>;
  modelError: string | null;
  modelScopeWarnings: unknown[];
}

export interface BrowseResult {
  path?: string;
  entries?: Array<{ name: string; path: string; isDir: boolean }>;
  parent?: string | null;
  error?: string;
}

export interface FileIndexResult {
  files?: string[];
  matches?: Array<{ path: string; isDir: boolean }>;
  truncated?: boolean;
}

export interface SessionDetailResult {
  sessionId: string;
  filePath: string;
  tree: unknown[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
  cwd: string;
}
export interface SessionTailEntry {
  id: string;
  message: AgentMessage;
}

export interface SessionTailResult {
  revision: number;
  entries: SessionTailEntry[];
}

export interface AgentDefinition {
  model?: string;
  tools?: string[];
  instructions?: string;
  [key: string]: unknown;
}

export interface AgentDefinitionSummary {
  name: string;
  definition: AgentDefinition;
  path: string;
}

export type HostMethod = keyof HostMethods;
export type HostParams<M extends HostMethod> = HostMethods[M]["params"];
export type HostResult<M extends HostMethod> = HostMethods[M]["result"];

// Wire envelopes (webview <-> extension host):
export interface HostCallMessage {
  type: "host/call";
  requestId: number;
  method: HostMethod;
  params: unknown;
}

export type HostResultMessage =
  | { type: "host/result"; requestId: number; ok: true; data: unknown }
  | { type: "host/result"; requestId: number; ok: false; error: string };

// SessionTreeNode is re-exported for callers that need it alongside HostMethods.
export type { SessionTreeNode };
