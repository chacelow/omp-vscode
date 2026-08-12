// ============================================================================
// OMP RPC protocol types + capability map
//
// The single entry point for understanding what the OMP RPC backend can do.
// Derived from can1357/oh-my-pi `packages/coding-agent/src/modes/rpc/rpc-types.ts`
// and verified against `omp` 17.2.11 (spawned as `omp --mode rpc`).
//
// Consumers: the agent backend (lib/rpc-manager.ts) and future UI work —
// read RPC_CAPABILITIES to see every command, its payload, and whether the
// webview already wires it up.
// ============================================================================

// ---------------------------------------------------------------------------
// Wire frame basics
// ---------------------------------------------------------------------------

export interface RpcReadyFrame {
  type: "ready";
  protocolVersion: number;
  supportedProtocolVersions: number[];
  maxFrameBytes: number;
  maxReassembledFrameBytes: number;
}

// ---------------------------------------------------------------------------
// Commands (stdin JSONL) — the full OMP RPC command surface
// ---------------------------------------------------------------------------

export type RpcCommand =
  // Protocol
  | { id?: string; type: "negotiate_protocol"; protocolVersion: number }

  // Prompting
  | {
      id?: string;
      type: "prompt";
      message: string;
      images?: unknown[];
      streamingBehavior?: "steer" | "followUp";
    }
  | { id?: string; type: "steer"; message: string; images?: unknown[] }
  | { id?: string; type: "follow_up"; message: string; images?: unknown[] }
  | { id?: string; type: "abort" }
  | {
      id?: string;
      type: "abort_and_prompt";
      message: string;
      images?: unknown[];
    }
  | { id?: string; type: "new_session"; parentSession?: string }

  // State
  | { id?: string; type: "get_state" }
  | { id?: string; type: "set_fast_mode"; enabled: boolean }
  | { id?: string; type: "get_available_commands" }
  | { id?: string; type: "set_todos"; phases: unknown[] }
  | { id?: string; type: "set_host_tools"; tools: unknown[] }
  | { id?: string; type: "set_host_uri_schemes"; schemes: unknown[] }
  | {
      id?: string;
      type: "set_subagent_subscription";
      level: "off" | "progress" | "events";
    }
  | { id?: string; type: "get_subagents" }
  | {
      id?: string;
      type: "get_subagent_messages";
      subagentId?: string;
      sessionFile?: string;
      fromByte?: number;
    }

  // Model
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "cycle_model" }
  | { id?: string; type: "get_available_models" }

  // Thinking
  | { id?: string; type: "set_thinking_level"; level: string }
  | { id?: string; type: "cycle_thinking_level" }

  // Queue modes
  | { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string; type: "set_interrupt_mode"; mode: "immediate" | "wait" }

  // Compaction
  | { id?: string; type: "compact"; customInstructions?: string }
  | { id?: string; type: "set_auto_compaction"; enabled: boolean }

  // Retry
  | { id?: string; type: "set_auto_retry"; enabled: boolean }
  | { id?: string; type: "abort_retry" }

  // Bash
  | { id?: string; type: "bash"; command: string }
  | { id?: string; type: "abort_bash" }

  // Session
  | { id?: string; type: "get_session_stats" }
  | { id?: string; type: "export_html"; outputPath?: string }
  | { id?: string; type: "switch_session"; sessionPath: string }
  | { id?: string; type: "branch"; entryId: string }
  | { id?: string; type: "get_branch_messages" }
  | { id?: string; type: "get_last_assistant_text" }
  | { id?: string; type: "set_session_name"; name: string }
  | { id?: string; type: "handoff"; customInstructions?: string }

  // Messages
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "get_messages_page"; cursor?: string; limit?: number }

  // Login
  | { id?: string; type: "get_login_providers" }
  | { id?: string; type: "login"; providerId: string };

export type RpcCommandType = RpcCommand["type"] | "extension_ui_response";

// ---------------------------------------------------------------------------
// State (get_state data)
// ---------------------------------------------------------------------------

export interface RpcSessionState {
  model?: {
    id: string;
    name?: string;
    provider: string;
    contextWindow?: number;
  } | null;
  thinkingLevel?: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  interruptMode: "immediate" | "wait";
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  fastModeEnabled: boolean;
  fastModeActive: boolean;
  tokensPerSecond: number | null;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases: unknown[];
  systemPrompt?: string[];
  dumpTools?: Array<{ name: string; description: string; parameters: unknown }>;
  contextUsage?: {
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  };
}

// ---------------------------------------------------------------------------
// Slash commands (get_available_commands)
// ---------------------------------------------------------------------------

export type RpcCommandSource =
  "builtin" | "extension" | "skill" | "custom" | "file";

export interface RpcAvailableSlashCommand {
  name: string;
  aliases?: string[];
  description?: string;
  input?: { hint?: string };
  subcommands?: Array<{ name: string; description?: string; usage?: string }>;
  source: RpcCommandSource;
}

// ---------------------------------------------------------------------------
// Responses (stdout, matched by id)
// ---------------------------------------------------------------------------

export type RpcResponse =
  | {
      id?: string;
      type: "response";
      command: "prompt";
      success: true;
      data?: { agentInvoked: boolean };
    }
  | {
      id?: string;
      type: "response";
      command: "get_state";
      success: true;
      data: RpcSessionState;
    }
  | {
      id?: string;
      type: "response";
      command: "get_available_commands";
      success: true;
      data: { commands: RpcAvailableSlashCommand[] };
    }
  | {
      id?: string;
      type: "response";
      command: "get_messages";
      success: true;
      data: { messages: unknown[] };
    }
  | {
      id?: string;
      type: "response";
      command: "get_messages_page";
      success: true;
      data: { messages: unknown[]; nextCursor?: string; totalMessages: number };
    }
  | {
      id?: string;
      type: "response";
      command: "set_model";
      success: true;
      data: Record<string, unknown>;
    }
  | {
      id?: string;
      type: "response";
      command: "cycle_model";
      success: true;
      data: { model?: unknown; thinkingLevel?: string };
    }
  | {
      id?: string;
      type: "response";
      command: "get_available_models";
      success: true;
      data: { models: unknown[] };
    }
  | {
      id?: string;
      type: "response";
      command: "cycle_thinking_level";
      success: true;
      data: { level: string };
    }
  | {
      id?: string;
      type: "response";
      command: "compact";
      success: true;
      data: Record<string, unknown>;
    }
  | {
      id?: string;
      type: "response";
      command: "bash";
      success: true;
      data: {
        output: string;
        exitCode: number;
        cancelled: boolean;
        truncated: boolean;
        fullOutputPath?: string;
      };
    }
  | {
      id?: string;
      type: "response";
      command: "get_session_stats";
      success: true;
      data: Record<string, unknown>;
    }
  | {
      id?: string;
      type: "response";
      command: "export_html";
      success: true;
      data: { path: string };
    }
  | {
      id?: string;
      type: "response";
      command: "switch_session";
      success: true;
      data: { cancelled: boolean };
    }
  | {
      id?: string;
      type: "response";
      command: "branch";
      success: true;
      data: { text: string; cancelled: boolean };
    }
  | {
      id?: string;
      type: "response";
      command: "get_branch_messages";
      success: true;
      data: { messages: Array<{ entryId: string; text: string }> };
    }
  | {
      id?: string;
      type: "response";
      command: "get_last_assistant_text";
      success: true;
      data: { text: string | null };
    }
  | {
      id?: string;
      type: "response";
      command: "get_subagents";
      success: true;
      data: { subagents: unknown[] };
    }
  | {
      id?: string;
      type: "response";
      command: "get_login_providers";
      success: true;
      data: { providers: unknown[] };
    }
  | {
      id?: string;
      type: "response";
      command: "login";
      success: true;
      data: { providerId: string };
    }
  | {
      id?: string;
      type: "response";
      command: "set_todos";
      success: true;
      data: { todoPhases: unknown[] };
    }
  | {
      id?: string;
      type: "response";
      command: string;
      success: false;
      error: string;
      code?: string;
    };

// ---------------------------------------------------------------------------
// Events (stdout, no id) — agent, message, tool, extension UI, subagent
// ---------------------------------------------------------------------------

export type RpcSessionEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages?: unknown[]; willRetry?: boolean }
  | { type: "agent_settled" }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: unknown; toolResults?: unknown[] }
  | { type: "message_start"; message?: unknown }
  | {
      type: "message_update";
      message?: unknown;
      assistantMessageEvent?: Record<string, unknown>;
    }
  | { type: "message_end"; message?: unknown }
  | { type: "bash_execution_update"; id?: string; delta?: string }
  | {
      type: "tool_execution_start";
      toolCallId?: string;
      toolName?: string;
      args?: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId?: string;
      toolName?: string;
      partialResult?: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
      isError?: boolean;
    }
  | { type: "queue_update"; steering?: string[]; followUp?: string[] }
  | { type: "compaction_start"; reason?: string }
  | {
      type: "compaction_end";
      reason?: string;
      result?: unknown;
      aborted?: boolean;
    }
  | {
      type: "auto_retry_start";
      attempt?: number;
      maxAttempts?: number;
      delayMs?: number;
    }
  | { type: "auto_retry_end"; success?: boolean; attempt?: number }
  | { type: "available_commands_update"; commands?: RpcAvailableSlashCommand[] }
  | {
      type: "extension_error";
      extensionPath?: string;
      event?: string;
      error?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: string;
      [key: string]: unknown;
    }
  | {
      type: "subagent_lifecycle" | "subagent_progress" | "subagent_event";
      [key: string]: unknown;
    };

// ---------------------------------------------------------------------------
// Extension UI sub-protocol (bidirectional)
// ---------------------------------------------------------------------------

export type RpcExtensionUiRequest =
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
      timeout?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      statusKey: string;
      statusText?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines?: string[];
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setTitle";
      title: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "set_editor_text";
      text: string;
    };

export type RpcExtensionUiResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | {
      type: "extension_ui_response";
      id: string;
      cancelled: true;
      timedOut?: boolean;
    };

// ---------------------------------------------------------------------------
// Capability map — what the webview already wires up vs what is available
// ---------------------------------------------------------------------------

export type CapabilityStatus = "wired" | "degraded" | "available";

export interface RpcCapabilityCommand {
  command: RpcCommandType;
  params: string;
  description: string;
  status: CapabilityStatus;
}

export interface RpcCapability {
  category: string;
  commands: RpcCapabilityCommand[];
}

const C = (
  command: RpcCommandType,
  params: string,
  description: string,
  status: CapabilityStatus
): RpcCapabilityCommand => ({ command, params, description, status });

/** Full OMP RPC capability map. `status` reflects the current webview wiring. */
export const RPC_CAPABILITIES: RpcCapability[] = [
  {
    category: "Prompting",
    commands: [
      C(
        "prompt",
        "message, images?, streamingBehavior?",
        "Send a user message; events stream after acceptance",
        "wired"
      ),
      C(
        "steer",
        "message, images?",
        "Queue a steering message during a running turn",
        "wired"
      ),
      C(
        "follow_up",
        "message, images?",
        "Queue a follow-up after the turn settles",
        "wired"
      ),
      C("abort", "", "Abort the current operation", "wired"),
      C(
        "abort_and_prompt",
        "message, images?",
        "Abort and immediately send a new prompt",
        "available"
      ),
      C(
        "new_session",
        "parentSession?",
        "Start a fresh session (RPC processes are per-session; unused)",
        "available"
      ),
    ],
  },
  {
    category: "State & Commands",
    commands: [
      C(
        "get_state",
        "",
        "Full session state (model, thinking, queues, todos, tools, usage)",
        "wired"
      ),
      C(
        "set_fast_mode",
        "enabled",
        "Toggle OMP fast mode (cheap/fast model)",
        "available"
      ),
      C(
        "get_available_commands",
        "",
        "All slash commands (builtin/skill/prompt/extension/custom)",
        "wired"
      ),
      C("set_todos", "phases", "Replace the todo phase list", "available"),
      C(
        "set_subagent_subscription",
        "level: off|progress|events",
        "Subscribe to subagent lifecycle/progress events",
        "available"
      ),
      C(
        "get_subagents",
        "",
        "List subagents in the current session",
        "available"
      ),
      C(
        "get_subagent_messages",
        "subagentId?, sessionFile?, fromByte?",
        "Page subagent transcript messages",
        "available"
      ),
    ],
  },
  {
    category: "Model & Thinking",
    commands: [
      C("set_model", "provider, modelId", "Switch model", "wired"),
      C("cycle_model", "", "Cycle to the next available model", "available"),
      C("get_available_models", "", "List configured models", "available"),
      C(
        "set_thinking_level",
        "level: off..max",
        "Set reasoning level",
        "wired"
      ),
      C("cycle_thinking_level", "", "Cycle thinking levels", "available"),
    ],
  },
  {
    category: "Queue Modes",
    commands: [
      C(
        "set_steering_mode",
        "all|one-at-a-time",
        "Steering delivery policy",
        "available"
      ),
      C(
        "set_follow_up_mode",
        "all|one-at-a-time",
        "Follow-up delivery policy",
        "available"
      ),
      C(
        "set_interrupt_mode",
        "immediate|wait",
        "Interrupt policy",
        "available"
      ),
    ],
  },
  {
    category: "Compaction & Retry",
    commands: [
      C("compact", "customInstructions?", "Manually compact context", "wired"),
      C("set_auto_compaction", "enabled", "Auto-compaction toggle", "wired"),
      C("set_auto_retry", "enabled", "Auto-retry toggle", "wired"),
      C("abort_retry", "", "Cancel an in-progress retry", "available"),
    ],
  },
  {
    category: "Bash",
    commands: [
      C("bash", "command", "Run a shell command into session context", "wired"),
      C("abort_bash", "", "Abort a running shell command", "wired"),
    ],
  },
  {
    category: "Session",
    commands: [
      C("get_session_stats", "", "Token/cost/context stats", "wired"),
      C("export_html", "outputPath?", "Export session to HTML", "available"),
      C(
        "switch_session",
        "sessionPath",
        "Load a different session file",
        "available"
      ),
      C(
        "branch",
        "entryId",
        "Branch at a session entry (in-session fork)",
        "available"
      ),
      C(
        "get_branch_messages",
        "",
        "List user messages on the active branch (entryId source for branch)",
        "available"
      ),
      C("get_last_assistant_text", "", "Last assistant text", "wired"),
      C("set_session_name", "name", "Rename session", "wired"),
      C(
        "handoff",
        "customInstructions?",
        "Hand off to a new agent run",
        "available"
      ),
    ],
  },
  {
    category: "Messages",
    commands: [
      C("get_messages", "", "All messages (full history)", "available"),
      C(
        "get_messages_page",
        "cursor?, limit?",
        "Cursor-paginated messages",
        "available"
      ),
    ],
  },
  {
    category: "Extension UI",
    commands: [
      C(
        "extension_ui_response",
        "id + value/confirmed/cancelled",
        "Reply to extension UI dialogs (select/confirm/input/editor)",
        "wired"
      ),
    ],
  },
  {
    category: "Login",
    commands: [
      C("get_login_providers", "", "List auth providers", "available"),
      C("login", "providerId", "Start provider login", "available"),
    ],
  },
  {
    category: "Protocol",
    commands: [
      C(
        "negotiate_protocol",
        "protocolVersion",
        "Negotiate protocol version (1/2)",
        "available"
      ),
      C(
        "set_host_tools",
        "tools",
        "Register host-provided tools (editor integration)",
        "available"
      ),
      C(
        "set_host_uri_schemes",
        "schemes",
        "Register host URI schemes (custom:// reads/writes)",
        "available"
      ),
    ],
  },
];

/** Runtime capability query — future /api/capabilities endpoint source. */
export function getRpcCapabilities(): RpcCapability[] {
  return RPC_CAPABILITIES;
}
