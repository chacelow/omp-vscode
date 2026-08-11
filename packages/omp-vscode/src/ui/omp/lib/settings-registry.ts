// Hand-curated Workbench projection of omp's settings schema
// (`reference/oh-my-pi/packages/coding-agent/src/config/settings-schema.ts`).
//
// Every entry is copied VERBATIM — `label`, `description`, `options`,
// `values`, `default`. omp exposes no schema over ACP, so this port is the
// only source of truth for the Settings panel.
//
// NOTE ON TABS:
//   - `appearance` — TUI theme/status-line/images. The webview does NOT
//     render the terminal status line or Nerd-Font glyphs, so these settings
//     only take effect when running `omp` in the terminal. They are still
//     persisted to ~/.omp/agent/config.yml and shared with the CLI.
//   - `shell` / `tools` / `tasks` / `providers` — orthogonal to the UI;
//     they configure the agent's execution behaviour and apply everywhere.
//   - `model` / `interaction` / `context` / `memory` / `files` — apply to
//     both the webview and the CLI.

export type SettingsTabId =
  | "appearance"
  | "model"
  | "interaction"
  | "context"
  | "memory"
  | "files"
  | "shell"
  | "tools"
  | "tasks"
  | "providers";

export interface SubmenuOption {
  value: string;
  label: string;
  description?: string;
}

export type SettingDef =
  | {
      path: string;
      tab: SettingsTabId;
      group: string;
      label: string;
      description: string;
      condition?: string;
      type: "boolean";
      default: boolean;
    }
  | {
      path: string;
      tab: SettingsTabId;
      group: string;
      label: string;
      description: string;
      condition?: string;
      type: "enum";
      values: readonly string[];
      options: readonly SubmenuOption[];
      default: string;
    }
  | {
      path: string;
      tab: SettingsTabId;
      group: string;
      label: string;
      description: string;
      condition?: string;
      type: "submenu";
      options: readonly SubmenuOption[];
      default: string;
    }
  | {
      path: string;
      tab: SettingsTabId;
      group: string;
      label: string;
      description: string;
      condition?: string;
      type: "number-choice";
      options: readonly SubmenuOption[];
      default: number;
    }
  | {
      path: string;
      tab: SettingsTabId;
      group: string;
      label: string;
      description: string;
      condition?: string;
      type: "multiselect";
      options: readonly SubmenuOption[];
      default: readonly string[];
      ordered: boolean;
    }
  | {
      path: string;
      tab: SettingsTabId;
      group: string;
      label: string;
      description: string;
      condition?: string;
      type: "text";
      secret?: boolean;
      default: string;
    }
  | {
      path: string;
      tab: SettingsTabId;
      group: string;
      label: string;
      description: string;
      condition?: string;
      type: "modelRoles";
    };

export const SETTINGS_TABS: readonly { id: SettingsTabId; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "model", label: "Model" },
  { id: "interaction", label: "Interaction" },
  { id: "context", label: "Context" },
  { id: "memory", label: "Memory" },
  { id: "files", label: "Files" },
  { id: "shell", label: "Shell" },
  { id: "tools", label: "Tools" },
  { id: "tasks", label: "Tasks" },
  { id: "providers", label: "Providers" },
];

export const TAB_GROUPS: Record<SettingsTabId, readonly string[]> = {
  appearance: ["Theme", "Status Line", "Display", "Images"],
  model: [
    "Thinking",
    "Sampling",
    "Prompt",
    "Retry & Fallback",
    "Advisor",
    "Prewalk",
    "Vision",
  ],
  interaction: [
    "Input",
    "Approvals",
    "Notifications",
    "Speech",
    "Collab",
    "Magic Keywords",
    "Startup & Updates",
    "Power (macOS)",
    "Agent",
    "Git",
  ],
  context: ["General", "Compaction", "Rules (TTSR)", "Experimental"],
  memory: ["General", "Auto-Learn", "Mnemopi", "Hindsight"],
  files: ["Editing", "Reading", "Read Summaries", "LSP"],
  shell: ["Bash", "Eval & Runtimes"],
  tools: [
    "Available Tools",
    "Todos",
    "Grep & Browser",
    "Computer",
    "GitHub",
    "Output Limits",
    "Execution",
    "Discovery & MCP",
    "Developer",
  ],
  tasks: ["Modes", "Subagents", "Isolation", "Commands & Skills"],
  providers: [
    "Services",
    "Fireworks",
    "Tiny Model",
    "Protocol",
    "Timeouts",
    "Privacy",
  ],
};

/** Hand-curated Workbench projection of OMP's settings schema. */
export const SETTINGS: readonly SettingDef[] = [
  {
    path: "autoResume",
    tab: "interaction",
    group: "Startup & Updates",
    label: "Auto Resume",
    description:
      "Automatically resume the most recent session in the current directory",
    type: "boolean",
    default: false,
  },
  {
    path: "power.sleepPrevention",
    tab: "interaction",
    group: "Power (macOS)",
    label: "Sleep Prevention",
    description:
      "Prevent macOS sleep during active sessions. Each level is cumulative — it adds the flags of all lower levels.",
    type: "enum",
    values: ["off", "idle", "display", "system"],
    options: [
      { value: "off", label: "Off", description: "Do not prevent any sleep" },
      {
        value: "idle",
        label: "Prevent Idle Sleep",
        description:
          "Keep the system awake while a session is open (caffeinate -i)",
      },
      {
        value: "display",
        label: "Prevent Display Sleep",
        description:
          "Also keep the display from idle-sleeping (caffeinate -i -d)",
      },
      {
        value: "system",
        label: "Prevent System Sleep",
        description:
          "Also block all system sleep on AC and declare the user active (caffeinate -i -d -s -u)",
      },
    ],
    default: "idle",
  },
  {
    path: "advisor.enabled",
    tab: "model",
    group: "Advisor",
    label: "Enable Advisor",
    description:
      "Pair a second model (assigned to the 'advisor' role) that passively reviews each turn and injects notes.",
    type: "boolean",
    default: false,
  },
  {
    path: "advisor.subagents",
    tab: "model",
    group: "Advisor",
    label: "Advisor for Subagents",
    description: "Also enable the advisor on spawned task/eval subagents.",
    condition: "advisorEnabled",
    type: "boolean",
    default: false,
  },
  {
    path: "advisor.syncBacklog",
    tab: "model",
    group: "Advisor",
    label: "Advisor Sync Backlog",
    description:
      "Pause the main agent for up to 30 seconds if the advisor falls behind by this many turns. Off disables catch-up delays.",
    condition: "advisorEnabled",
    type: "enum",
    values: ["off", "1", "3", "5"],
    options: [
      { value: "off", label: "off" },
      { value: "1", label: "1" },
      { value: "3", label: "3" },
      { value: "5", label: "5" },
    ],
    default: "off",
  },
  {
    path: "advisor.immuneTurns",
    tab: "model",
    group: "Advisor",
    label: "Advisor Immune Turns",
    description:
      "After an advisor concern or blocker interrupts, route further concerns/blockers non-interruptingly for this many primary turns.",
    condition: "advisorEnabled",
    type: "number-choice",
    options: [
      {
        value: "0",
        label: "0 turns",
        description: "Allow every concern/blocker to interrupt.",
      },
      { value: "1", label: "1 turn" },
      { value: "2", label: "2 turns" },
      { value: "3", label: "3 turns", description: "Default." },
      { value: "4", label: "4 turns" },
      { value: "5", label: "5 turns" },
    ],
    default: 3,
  },
  {
    path: "prewalk.enabled",
    tab: "model",
    group: "Prewalk",
    label: "Enable Prewalk",
    description:
      "Start on the active model, then switch to a fast/cheap model (default the 'smol' role) at the first edit/write after the plan nudge's todo list exists — the strong model plans, commits the todos, and starts the implementation before handing off. Overridable per session with --prewalk / --no-prewalk.",
    type: "boolean",
    default: false,
  },
  {
    path: "modelRoleStorage",
    tab: "model",
    group: "Prompt",
    label: "Model Role Storage",
    description: "Where model selector role assignments are saved",
    type: "enum",
    values: ["global", "project"],
    options: [
      {
        value: "global",
        label: "Global",
        description:
          "Save role models in the active profile config (current behavior)",
      },
      {
        value: "project",
        label: "Per-project",
        description:
          "Save project role models in .omp/config.yml; missing project roles use global defaults",
      },
    ],
    default: "global",
  },
  {
    path: "modelRoles",
    tab: "model",
    group: "Prompt",
    label: "Model Roles",
    description: "Assign models and thinking levels to model roles",
    type: "modelRoles",
  },
  {
    path: "theme.dark",
    tab: "appearance",
    group: "Theme",
    label: "Dark Theme",
    description: "Theme used when the terminal has a dark background",
    type: "submenu",
    options: [],
    default: "titanium",
  },
  {
    path: "theme.light",
    tab: "appearance",
    group: "Theme",
    label: "Light Theme",
    description: "Theme used when the terminal has a light background",
    type: "submenu",
    options: [],
    default: "light",
  },
  {
    path: "symbolPreset",
    tab: "appearance",
    group: "Theme",
    label: "Symbol Preset",
    description:
      "Glyph set for icons and symbols (Unicode, Nerd Font, or ASCII)",
    type: "enum",
    values: ["unicode", "nerd", "ascii"],
    options: [
      {
        value: "unicode",
        label: "Unicode",
        description: "Standard symbols (default)",
      },
      { value: "nerd", label: "Nerd Font", description: "Requires Nerd Font" },
      { value: "ascii", label: "ASCII", description: "Maximum compatibility" },
    ],
    default: "unicode",
  },
  {
    path: "colorBlindMode",
    tab: "appearance",
    group: "Theme",
    label: "Color-Blind Mode",
    description: "Use blue instead of green for diff additions",
    type: "boolean",
    default: false,
  },
  {
    path: "statusLine.preset",
    tab: "appearance",
    group: "Status Line",
    label: "Status Line Preset",
    description: "Pre-built status line configurations",
    type: "enum",
    values: [
      "default",
      "minimal",
      "compact",
      "full",
      "nerd",
      "ascii",
      "custom",
    ],
    options: [
      {
        value: "default",
        label: "Default",
        description: "Model, path, git, context, tokens, cost",
      },
      { value: "minimal", label: "Minimal", description: "Path and git only" },
      {
        value: "compact",
        label: "Compact",
        description: "Model, git, cost, context",
      },
      {
        value: "full",
        label: "Full",
        description: "All segments including time",
      },
      {
        value: "nerd",
        label: "Nerd",
        description: "Maximum info with Nerd Font icons",
      },
      { value: "ascii", label: "ASCII", description: "No special characters" },
      {
        value: "custom",
        label: "Custom",
        description: "User-defined segments",
      },
    ],
    default: "default",
  },
  {
    path: "statusLine.separator",
    tab: "appearance",
    group: "Status Line",
    label: "Status Line Separator",
    description: "Style of separators between segments",
    type: "enum",
    values: [
      "powerline",
      "powerline-thin",
      "slash",
      "pipe",
      "block",
      "none",
      "ascii",
    ],
    options: [
      {
        value: "powerline",
        label: "Powerline",
        description: "Solid arrows (Nerd Font)",
      },
      {
        value: "powerline-thin",
        label: "Thin chevron",
        description: "Thin arrows (Nerd Font)",
      },
      { value: "slash", label: "Slash", description: "Forward slashes" },
      { value: "pipe", label: "Pipe", description: "Vertical pipes" },
      { value: "block", label: "Block", description: "Solid blocks" },
      { value: "none", label: "None", description: "Space only" },
      { value: "ascii", label: "ASCII", description: "Greater-than signs" },
    ],
    default: "powerline-thin",
  },
  {
    path: "statusLine.sessionAccent",
    tab: "appearance",
    group: "Status Line",
    label: "Session Accent",
    description:
      "Use the session name color for the editor border and status line gap",
    type: "boolean",
    default: true,
  },
  {
    path: "statusLine.transparent",
    tab: "appearance",
    group: "Status Line",
    label: "Transparent Status Line",
    description:
      "Use the terminal's default background for the status line instead of the theme's `statusLineBg`. Powerline end caps are dropped because they need a contrasting fill to bridge into the surrounding terminal.",
    type: "boolean",
    default: false,
  },
  {
    path: "statusLine.compactThinkingLevel",
    tab: "appearance",
    group: "Status Line",
    label: "Compact Thinking Level",
    description:
      "Show the thinking level as a single icon on the model name instead of a separate ` · <level>` suffix.",
    type: "boolean",
    default: false,
  },
  {
    path: "terminal.showImages",
    tab: "appearance",
    group: "Images",
    label: "Show Inline Images",
    description: "Render images inline in the terminal",
    condition: "hasImageProtocol",
    type: "boolean",
    default: true,
  },
  {
    path: "images.autoResize",
    tab: "appearance",
    group: "Images",
    label: "Auto-Resize Images",
    description:
      "Resize large images to 2000x2000 max for better model compatibility",
    type: "boolean",
    default: true,
  },
  {
    path: "images.blockImages",
    tab: "appearance",
    group: "Images",
    label: "Block Images",
    description: "Prevent images from being sent to LLM providers",
    type: "boolean",
    default: false,
  },
  {
    path: "defaultThinkingLevel",
    tab: "model",
    group: "Thinking",
    label: "Thinking Level",
    description: "Reasoning depth for thinking-capable models",
    type: "enum",
    values: ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"],
    options: [
      {
        value: "auto",
        label: "auto",
        description: "Automatically select thinking effort for each turn",
      },
      { value: "off", label: "off", description: "No reasoning" },
      {
        value: "minimal",
        label: "min",
        description: "Very brief reasoning (~1k tokens)",
      },
      {
        value: "low",
        label: "low",
        description: "Light reasoning (~2k tokens)",
      },
      {
        value: "medium",
        label: "medium",
        description: "Moderate reasoning (~8k tokens)",
      },
      {
        value: "high",
        label: "high",
        description: "Deep reasoning (~16k tokens)",
      },
      {
        value: "xhigh",
        label: "xhigh",
        description: "Extended reasoning (~32k tokens)",
      },
      {
        value: "max",
        label: "max",
        description: "Maximum reasoning the model supports",
      },
    ],
    default: "high",
  },
  {
    path: "hideThinkingBlock",
    tab: "model",
    group: "Thinking",
    label: "Hide Thinking Blocks",
    description: "Hide thinking blocks in assistant responses",
    type: "boolean",
    default: false,
  },
  {
    path: "proseOnlyThinking",
    tab: "model",
    group: "Thinking",
    label: "Prose Only Thinking",
    description:
      "Omit code blocks from thinking summaries and replace them with an ellipsis",
    type: "boolean",
    default: true,
  },
  {
    path: "omitThinking",
    tab: "model",
    group: "Thinking",
    label: "Omit Thinking summaries",
    description:
      "Instruct upstream providers to completely omit thinking summaries from responses (where supported)",
    type: "boolean",
    default: false,
  },
  {
    path: "personality",
    tab: "model",
    group: "Prompt",
    label: "Personality",
    description:
      "Communication style rendered into the system prompt's personality block",
    type: "enum",
    values: ["default", "friendly", "pragmatic", "none"],
    options: [
      {
        value: "default",
        label: "Default",
        description:
          "Terse, evidence-first engineer; dense, action-oriented replies",
      },
      {
        value: "friendly",
        label: "Friendly",
        description:
          "Warm, encouraging collaborator focused on momentum and morale",
      },
      {
        value: "pragmatic",
        label: "Pragmatic",
        description: "Direct, efficient engineer focused on clarity and rigor",
      },
      {
        value: "none",
        label: "None",
        description: "Omit the personality block entirely",
      },
    ],
    default: "default",
  },
  {
    path: "textVerbosity",
    tab: "model",
    group: "Sampling",
    label: "Text Verbosity",
    description:
      "OpenAI Responses and Codex response verbosity (low, medium, or high)",
    type: "enum",
    values: ["low", "medium", "high"],
    options: [
      { value: "low", label: "Low", description: "Prefer concise responses" },
      {
        value: "medium",
        label: "Medium",
        description: "Balance brevity and detail (default)",
      },
      {
        value: "high",
        label: "High",
        description: "Prefer detailed responses",
      },
    ],
    default: "medium",
  },
  {
    path: "steeringMode",
    tab: "interaction",
    group: "Input",
    label: "Steering Mode",
    description: "How to process queued messages while agent is working",
    type: "enum",
    values: ["all", "one-at-a-time"],
    options: [
      { value: "all", label: "all" },
      { value: "one-at-a-time", label: "one-at-a-time" },
    ],
    default: "one-at-a-time",
  },
  {
    path: "followUpMode",
    tab: "interaction",
    group: "Input",
    label: "Follow-Up Mode",
    description: "How to drain follow-up messages after a turn completes",
    type: "enum",
    values: ["all", "one-at-a-time"],
    options: [
      { value: "all", label: "all" },
      { value: "one-at-a-time", label: "one-at-a-time" },
    ],
    default: "one-at-a-time",
  },
  {
    path: "interruptMode",
    tab: "interaction",
    group: "Input",
    label: "Interrupt Mode",
    description: "When steering messages interrupt tool execution",
    type: "enum",
    values: ["immediate", "wait"],
    options: [
      { value: "immediate", label: "immediate" },
      { value: "wait", label: "wait" },
    ],
    default: "immediate",
  },
  {
    path: "doubleEscapeAction",
    tab: "interaction",
    group: "Input",
    label: "Double-Escape Action",
    description: "Action when pressing Escape twice with empty editor",
    type: "enum",
    values: ["branch", "tree", "none"],
    options: [
      { value: "branch", label: "branch" },
      { value: "tree", label: "tree" },
      { value: "none", label: "none" },
    ],
    default: "tree",
  },
  {
    path: "treeFilterMode",
    tab: "interaction",
    group: "Input",
    label: "Session Tree Filter",
    description: "Default filter mode when opening the session tree",
    type: "enum",
    values: ["default", "no-tools", "user-only", "labeled-only", "all"],
    options: [
      { value: "default", label: "default" },
      { value: "no-tools", label: "no-tools" },
      { value: "user-only", label: "user-only" },
      { value: "labeled-only", label: "labeled-only" },
      { value: "all", label: "all" },
    ],
    default: "default",
  },
  {
    path: "emojiAutocomplete",
    tab: "interaction",
    group: "Input",
    label: "Emoji Autocomplete",
    description:
      "Suggest emojis from `:name:` shortcodes and expand text emoticons like `:D` or `:-)`",
    type: "boolean",
    default: true,
  },
  {
    path: "startup.quiet",
    tab: "interaction",
    group: "Startup & Updates",
    label: "Quiet Startup",
    description: "Skip welcome screen and startup status messages",
    type: "boolean",
    default: false,
  },
  {
    path: "startup.setupWizard",
    tab: "interaction",
    group: "Startup & Updates",
    label: "Setup Wizard",
    description: "Show newly added onboarding steps once per setup version",
    type: "boolean",
    default: true,
  },
  {
    path: "startup.checkUpdate",
    tab: "interaction",
    group: "Startup & Updates",
    label: "Check for Updates",
    description: "Check for omp updates on startup",
    type: "boolean",
    default: true,
  },
  {
    path: "startup.changelogMode",
    tab: "interaction",
    group: "Startup & Updates",
    label: "Startup Changelog",
    description:
      "Choose whether update notes start as a summary, full details, or stay hidden",
    type: "enum",
    values: ["summary", "expanded", "hidden"],
    options: [
      {
        value: "summary",
        label: "Summary",
        description: "Show release and change counts with a /changelog hint",
      },
      {
        value: "expanded",
        label: "Expanded",
        description: "Show the recent release notes in full",
      },
      {
        value: "hidden",
        label: "Hidden",
        description: "Do not show release notes on startup",
      },
    ],
    default: "summary",
  },
  {
    path: "marketplace.autoUpdate",
    tab: "interaction",
    group: "Startup & Updates",
    label: "Marketplace Auto-Update",
    description: "Check for plugin updates on startup",
    type: "enum",
    values: ["off", "notify", "auto"],
    options: [
      {
        value: "off",
        label: "Off",
        description: "Don't check for plugin updates",
      },
      {
        value: "notify",
        label: "Notify",
        description: "Check on startup and notify when updates are available",
      },
      {
        value: "auto",
        label: "Auto",
        description: "Check on startup and auto-install updates",
      },
    ],
    default: "notify",
  },
  {
    path: "magicKeywords.enabled",
    tab: "interaction",
    group: "Magic Keywords",
    label: "Magic Keywords",
    description:
      "Enable hidden notices for standalone ultrathink, orchestrate, and workflowz keywords",
    type: "boolean",
    default: true,
  },
  {
    path: "magicKeywords.ultrathink",
    tab: "interaction",
    group: "Magic Keywords",
    label: "Ultrathink Keyword",
    description:
      "Let standalone ultrathink request maximum automatic thinking and append its hidden notice",
    type: "boolean",
    default: true,
  },
  {
    path: "magicKeywords.orchestrate",
    tab: "interaction",
    group: "Magic Keywords",
    label: "Orchestrate Keyword",
    description:
      "Let standalone orchestrate append its hidden multi-agent orchestration notice",
    type: "boolean",
    default: true,
  },
  {
    path: "magicKeywords.workflow",
    tab: "interaction",
    group: "Magic Keywords",
    label: "Workflow Keyword",
    description:
      "Let standalone workflowz append its hidden eval workflow notice",
    type: "boolean",
    default: true,
  },
  {
    path: "completion.notify",
    tab: "interaction",
    group: "Notifications",
    label: "Completion Notification",
    description: "Notify when the agent finishes a turn",
    type: "enum",
    values: ["on", "off"],
    options: [
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ],
    default: "on",
  },
  {
    path: "error.notify",
    tab: "interaction",
    group: "Notifications",
    label: "Error Notification",
    description: "Notify when the agent stops with an error",
    type: "enum",
    values: ["on", "off"],
    options: [
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ],
    default: "off",
  },
  {
    path: "ask.notify",
    tab: "interaction",
    group: "Notifications",
    label: "Ask Notification",
    description: "Notify when the ask tool is waiting for input",
    type: "enum",
    values: ["on", "off"],
    options: [
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ],
    default: "on",
  },
  {
    path: "recap.enabled",
    tab: "interaction",
    group: "Notifications",
    label: "Idle Recap",
    description:
      "Generate a brief LLM recap of where things stand after the terminal has been idle",
    type: "boolean",
    default: true,
  },
  {
    path: "share.store",
    tab: "interaction",
    group: "Collab",
    label: "Share Store",
    description: "Where /share uploads the encrypted session blob",
    type: "enum",
    values: ["blob", "gist"],
    options: [
      {
        value: "blob",
        label: "Encrypted Blob",
        description:
          "Upload to the share server (no GitHub account needed; avoids gist API rate limits)",
      },
      {
        value: "gist",
        label: "GitHub Gist",
        description:
          "Push to a secret gist (needs authenticated gh), falling back to the share server",
      },
    ],
    default: "blob",
  },
  {
    path: "share.redactSecrets",
    tab: "interaction",
    group: "Collab",
    label: "Share Secret Redaction",
    description:
      "Run the secret obfuscator over /share snapshots before upload (uses the secrets.* config)",
    type: "boolean",
    default: true,
  },
  {
    path: "stt.enabled",
    tab: "interaction",
    group: "Speech",
    label: "Speech-to-Text",
    description: "Enable speech-to-text input via microphone",
    type: "boolean",
    default: false,
  },
  {
    path: "stt.modelName",
    tab: "interaction",
    group: "Speech",
    label: "Speech Model",
    description:
      "Local on-device speech model. Parakeet TDT v3 (sherpa-onnx) is the SoTA default; Whisper base/small/large-v3-turbo tiers (transformers.js) trade size for multilingual coverage. Downloaded on first use.",
    type: "enum",
    values: [],
    options: [],
    default: "parakeet-tdt-0.6b-v3",
  },
  {
    path: "stt.submitTrigger",
    tab: "interaction",
    group: "Speech",
    label: "Speech-to-Text Submit Trigger",
    description:
      "Choose when speech dictation automatically submits: Never, Release (2+ words), Release with complete sentence, or When I Say Submit.",
    type: "enum",
    values: ["never", "release", "release-complete", "say-submit"],
    options: [
      {
        value: "never",
        label: "Never",
        description:
          "Never automatically submit; insert dictation and remain in editor.",
      },
      {
        value: "release",
        label: "Release",
        description:
          "Submit on release if the utterance has 2+ words to avoid accidental sends.",
      },
      {
        value: "release-complete",
        label: "Release with complete sentence",
        description:
          "Submit on release if the utterance ends with sentence-terminal punctuation (. ? ! etc.).",
      },
      {
        value: "say-submit",
        label: "When I Say Submit",
        description:
          "Submit if the utterance ends with a word containing 'submit' (strips that word before submitting).",
      },
    ],
    default: "never",
  },
  {
    path: "contextPromotion.enabled",
    tab: "context",
    group: "General",
    label: "Auto-Promote Context",
    description:
      "Promote to a larger-context model on context overflow instead of compacting",
    type: "boolean",
    default: false,
  },
  {
    path: "compaction.enabled",
    tab: "context",
    group: "Compaction",
    label: "Auto-Compact",
    description: "Automatically compact context when it gets too large",
    type: "boolean",
    default: true,
  },
  {
    path: "compaction.midTurnEnabled",
    tab: "context",
    group: "Compaction",
    label: "Mid-Turn Compaction",
    description:
      "Check thresholds at safe mid-turn tool-loop boundaries before the next provider request",
    type: "boolean",
    default: true,
  },
  {
    path: "compaction.strategy",
    tab: "context",
    group: "Compaction",
    label: "Compaction Strategy",
    description:
      "Choose in-place context-full maintenance, auto-handoff, surgical shake (drop heavy content), snapcompact (archive history as dense images), or disable auto maintenance (off)",
    type: "enum",
    values: ["context-full", "handoff", "shake", "snapcompact", "off"],
    options: [
      {
        value: "context-full",
        label: "Context-full",
        description: "Summarize in-place and keep the current session",
      },
      {
        value: "handoff",
        label: "Handoff",
        description: "Generate handoff and continue in a new session",
      },
      {
        value: "shake",
        label: "Shake",
        description:
          "Drop heavy content (tool results + large blocks) in place; recover via artifact",
      },
      {
        value: "snapcompact",
        label: "Snapcompact",
        description:
          "Archive history onto dense bitmap images the model reads back; no LLM call",
      },
      {
        value: "off",
        label: "Off",
        description:
          "Disable automatic context maintenance (same behavior as Auto-compact off)",
      },
    ],
    default: "snapcompact",
  },
  {
    path: "compaction.autoContinue",
    tab: "context",
    group: "Compaction",
    label: "Auto Continue",
    description: "Automatically continue after compaction",
    type: "boolean",
    default: true,
  },
  {
    path: "compaction.idleEnabled",
    tab: "context",
    group: "Compaction",
    label: "Idle Compaction",
    description:
      "Compact context while idle when token count exceeds threshold",
    type: "boolean",
    default: false,
  },
  {
    path: "snapcompact.systemPrompt",
    tab: "context",
    group: "Experimental",
    label: "Snapcompact System Prompt",
    description:
      "Experimental: render selected system prompt text as dense PNG image(s) and attach to the first user message (vision models only). Saves tokens; loses prompt caching for imaged text.",
    type: "enum",
    values: ["none", "agents-md", "all"],
    options: [
      {
        value: "none",
        label: "None",
        description: "Keep the system prompt as text.",
      },
      {
        value: "agents-md",
        label: "AGENTS.md",
        description:
          "Only move loaded context-file instructions to images, when that saves tokens.",
      },
      {
        value: "all",
        label: "All",
        description:
          "Move the full system prompt to images, when that saves tokens.",
      },
    ],
    default: "none",
  },
  {
    path: "snapcompact.toolResults",
    tab: "context",
    group: "Experimental",
    label: "Snapcompact Tool Results",
    description:
      "Experimental: render large historical tool results as dense PNG image(s) instead of text (vision models only). Saves tokens on accumulated read/search output.",
    type: "boolean",
    default: false,
  },
  {
    path: "snapcompact.shape",
    tab: "context",
    group: "Experimental",
    label: "Snapcompact Shape",
    description:
      "Frame shape snapcompact prints text with (compaction archive and inline imaging). Auto picks a shape tuned for the current model.",
    type: "enum",
    values: [
      "auto",
      "8x8r-bw",
      "8x8r-sent",
      "8x8u-bw",
      "8x8u-sent",
      "6x6u-bw",
      "6x6u-sent",
      "6x8u-bw",
      "6x8u-sent",
      "6x10u-bw",
      "6x10u-sent",
      "6x12u-bw",
      "6x12u-sent",
      "6x14u-bw",
      "6x14u-sent",
      "6x16u-bw",
      "6x16u-sent",
    ],
    options: [
      {
        value: "auto",
        label: "Auto",
        description:
          "Picks a shape tuned for the current model, falling back to its provider family.",
      },
      {
        value: "8x8r-bw",
        label: "8x8 repeated, black",
        description:
          "unscii square cell, black ink, every line printed twice with the copy on a pale highlight band.",
      },
      {
        value: "8x8r-sent",
        label: "8x8 repeated, sentence hues",
        description:
          "Repeated grid with ink cycling six hues at sentence boundaries.",
      },
      {
        value: "8x8u-bw",
        label: "8x8, black",
        description:
          "Plain unscii square cell, single-printed lines, black ink.",
      },
      {
        value: "8x8u-sent",
        label: "8x8, sentence hues",
        description: "Plain unscii square cell with sentence-hue ink.",
      },
      {
        value: "6x6u-bw",
        label: "6x6 dense, black",
        description:
          "unscii squeezed to 6x6 — densest readable cell, fewest frames — in black ink.",
      },
      {
        value: "6x6u-sent",
        label: "6x6 dense, sentence hues",
        description: "Densest cell with sentence-hue ink.",
      },
      {
        value: "5x8-bw",
        label: "5x8 legacy, black",
        description:
          "Original X.org 5x8 glyphs on the 2576px frame, black ink.",
      },
      {
        value: "5x8-sent",
        label: "5x8 legacy, sentence hues",
        description:
          "The original snapcompact shape (pre-shape-table sessions rendered this).",
      },
      {
        value: "6x12-dim",
        label: "6x12, dimmed stopwords",
        description:
          "X.org 6x12 glyphs, black ink, function words dimmed gray.",
      },
      {
        value: "8x13-bw",
        label: "8x13, black",
        description: "X.org 8x13 glyphs, black ink.",
      },
      {
        value: "8on16-bw",
        label: "8x13 on 16px pitch, black",
        description: "8x13 glyphs on an 8x16 cell (extra leading), black ink.",
      },
      {
        value: "8on22-bw",
        label: "8x13 on 22px pitch (leading), black",
        description:
          "8x13 glyphs on an 8x22 cell — extra line spacing so rows don't crowd. Default for OpenAI/Google.",
      },
      {
        value: "11on16-bw",
        label: "8x13 on 11px advance (tracking), black",
        description:
          "8x13 glyphs on an 11x16 cell — extra letter spacing so characters don't merge. Default for Anthropic.",
      },
      {
        value: "silver16-bw",
        label: "Silver 16, CJK",
        description:
          "Embedded Silver TrueType font on a 16px grid for CJK and other non-Latin text.",
      },
      {
        value: "doc-8on16-bw",
        label: "Doc 8on16, black",
        description:
          "Two word-wrapped newspaper columns of 8x13 glyphs on a 16px pitch, black ink.",
      },
      {
        value: "doc-8on16-sent",
        label: "Doc 8on16, sentence hues",
        description: "Two-column doc layout with sentence-hue ink.",
      },
      {
        value: "doc-8on16-sent-dim",
        label: "Doc 8on16, sentence hues + dimmed stopwords",
        description:
          "Two-column doc layout, sentence-hue ink, function words dimmed gray.",
      },
    ],
    default: "auto",
  },
  {
    path: "branchSummary.enabled",
    tab: "context",
    group: "General",
    label: "Branch Summaries",
    description: "Prompt to summarize when leaving a branch",
    type: "boolean",
    default: false,
  },
  {
    path: "memory.backend",
    tab: "memory",
    group: "General",
    label: "Memory Backend",
    description:
      "Off, local summary pipeline, Mnemopi SQLite, or Hindsight remote memory",
    type: "enum",
    values: ["off", "local", "hindsight", "mnemopi"],
    options: [
      { value: "off", label: "Off", description: "No memory subsystem runs" },
      {
        value: "local",
        label: "Local",
        description: "Local rollout summarisation pipeline (memory_summary.md)",
      },
      {
        value: "hindsight",
        label: "Hindsight",
        description: "Vectorize Hindsight remote memory service",
      },
      {
        value: "mnemopi",
        label: "Mnemopi",
        description:
          "Local SQLite recall/retain backend with optional embeddings",
      },
    ],
    default: "off",
  },
  {
    path: "autolearn.enabled",
    tab: "memory",
    group: "Auto-Learn",
    label: "Auto-Learn (experimental)",
    description:
      "After the agent stops, nudge it to capture lessons to memory and create/enhance isolated managed skills",
    type: "boolean",
    default: false,
  },
  {
    path: "mnemopi.scoping",
    tab: "memory",
    group: "Mnemopi",
    label: "Mnemopi Scoping",
    description:
      "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = project-local writes plus global recall visibility",
    condition: "mnemopiActive",
    type: "enum",
    values: ["global", "per-project", "per-project-tagged"],
    options: [
      {
        value: "global",
        label: "Global",
        description: "One shared Mnemopi bank for every project",
      },
      {
        value: "per-project",
        label: "Per project",
        description: "Project-local Mnemopi bank per cwd basename",
      },
      {
        value: "per-project-tagged",
        label: "Per project (tagged)",
        description:
          "Write to a project-local bank but merge project + shared recall results",
      },
    ],
    default: "per-project",
  },
  {
    path: "mnemopi.embeddingVariant",
    tab: "memory",
    group: "Mnemopi",
    label: "Embedding variant",
    description:
      "Local embedding model family. en = stronger English model; multilingual = cross-language model. Changing this rebuilds existing memory embeddings on next start.",
    condition: "mnemopiActive",
    type: "enum",
    values: ["en", "multilingual"],
    options: [
      {
        value: "en",
        label: "English (bge-base-en-v1.5)",
        description: "BAAI/bge-base-en-v1.5 (768d), English-only",
      },
      {
        value: "multilingual",
        label: "Multilingual (multilingual-e5-large)",
        description:
          "intfloat/multilingual-e5-large (1024d), cross-language recall",
      },
    ],
    default: "en",
  },
  {
    path: "mnemopi.autoRecall",
    tab: "memory",
    group: "Mnemopi",
    label: "Mnemopi Auto Recall",
    description: "Recall local memories into the first turn of each session",
    condition: "mnemopiActive",
    type: "boolean",
    default: true,
  },
  {
    path: "mnemopi.autoRetain",
    tab: "memory",
    group: "Mnemopi",
    label: "Mnemopi Auto Retain",
    description:
      "Retain completed conversation turns into local Mnemopi memory",
    condition: "mnemopiActive",
    type: "boolean",
    default: true,
  },
  {
    path: "hindsight.autoRecall",
    tab: "memory",
    group: "Hindsight",
    label: "Hindsight Auto Recall",
    description: "Recall memories on the first turn of each session",
    condition: "hindsightActive",
    type: "boolean",
    default: true,
  },
  {
    path: "hindsight.autoRetain",
    tab: "memory",
    group: "Hindsight",
    label: "Hindsight Auto Retain",
    description: "Retain transcript every N turns and at session boundaries",
    condition: "hindsightActive",
    type: "boolean",
    default: true,
  },
  {
    path: "hindsight.retainMode",
    tab: "memory",
    group: "Hindsight",
    label: "Hindsight Retain Mode",
    description:
      "full-session = upsert one document per session, last-turn = chunked",
    condition: "hindsightActive",
    type: "enum",
    values: ["full-session", "last-turn"],
    options: [
      {
        value: "full-session",
        label: "Full session",
        description: "Upsert one document per session (recommended)",
      },
      {
        value: "last-turn",
        label: "Last turn",
        description: "Chunked retention sliced by turn boundaries",
      },
    ],
    default: "full-session",
  },
  {
    path: "ttsr.enabled",
    tab: "context",
    group: "Rules (TTSR)",
    label: "TTSR",
    description:
      "Interrupt the agent mid-stream when output matches rule patterns (Time-Traveling Stream Rules)",
    type: "boolean",
    default: true,
  },
  {
    path: "ttsr.contextMode",
    tab: "context",
    group: "Rules (TTSR)",
    label: "TTSR Context Mode",
    description: "What to do with partial output when TTSR triggers",
    type: "enum",
    values: ["discard", "keep"],
    options: [
      { value: "discard", label: "discard" },
      { value: "keep", label: "keep" },
    ],
    default: "discard",
  },
  {
    path: "ttsr.interruptMode",
    tab: "context",
    group: "Rules (TTSR)",
    label: "TTSR Interrupt Mode",
    description:
      "When to interrupt mid-stream vs inject warning after completion",
    type: "enum",
    values: ["never", "prose-only", "tool-only", "always"],
    options: [
      {
        value: "always",
        label: "always",
        description: "Interrupt on prose and tool streams",
      },
      {
        value: "prose-only",
        label: "prose-only",
        description: "Interrupt only on reply/thinking matches",
      },
      {
        value: "tool-only",
        label: "tool-only",
        description: "Interrupt only on tool-call argument matches",
      },
      {
        value: "never",
        label: "never",
        description: "Never interrupt; inject warning after completion",
      },
    ],
    default: "always",
  },
  {
    path: "ttsr.repeatMode",
    tab: "context",
    group: "Rules (TTSR)",
    label: "TTSR Repeat Mode",
    description:
      "How rules can repeat: once per session or after a message gap",
    type: "enum",
    values: ["once", "after-gap"],
    options: [
      { value: "once", label: "once" },
      { value: "after-gap", label: "after-gap" },
    ],
    default: "once",
  },
  {
    path: "edit.mode",
    tab: "files",
    group: "Editing",
    label: "Edit Mode",
    description:
      "Select the edit tool variant (replace, patch, hashline, or apply_patch)",
    type: "enum",
    values: ["apply_patch", "hashline", "patch", "replace"],
    options: [
      { value: "apply_patch", label: "apply_patch" },
      { value: "hashline", label: "hashline" },
      { value: "patch", label: "patch" },
      { value: "replace", label: "replace" },
    ],
    default: "hashline",
  },
  {
    path: "edit.fuzzyMatch",
    tab: "files",
    group: "Editing",
    label: "Fuzzy Match",
    description:
      "Accept high-confidence fuzzy matches for whitespace differences",
    type: "boolean",
    default: true,
  },
  {
    path: "git.enabled",
    tab: "interaction",
    group: "Git",
    label: "Enable Git Integration",
    description:
      "Show git branch, status, and PR information in the TUI and watch repository metadata.",
    type: "boolean",
    default: true,
  },
  {
    path: "tui.hyperlinks",
    tab: "appearance",
    group: "Display",
    label: "Terminal Hyperlinks",
    description:
      "Wrap paths and URLs in OSC 8 hyperlinks for terminal-native click-to-open (auto: detect support; off: never; always: unconditional)",
    type: "enum",
    values: ["off", "auto", "always"],
    options: [
      { value: "off", label: "off" },
      { value: "auto", label: "auto" },
      { value: "always", label: "always" },
    ],
    default: "auto",
  },
  {
    path: "tui.renderMermaid",
    tab: "appearance",
    group: "Display",
    label: "Render Mermaid Diagrams",
    description: "Render Mermaid fenced code blocks as ASCII diagrams",
    type: "boolean",
    default: true,
  },
  {
    path: "display.showTokenUsage",
    tab: "appearance",
    group: "Display",
    label: "Show Token Usage",
    description: "Show per-turn token usage on assistant messages",
    type: "boolean",
    default: false,
  },
  {
    path: "display.smoothStreaming",
    tab: "appearance",
    group: "Display",
    label: "Smooth Streaming",
    description:
      "Reveal assistant text and streamed tool input smoothly while chunks arrive",
    type: "boolean",
    default: true,
  },
  {
    path: "display.hideToolActivity",
    tab: "appearance",
    group: "Display",
    label: "Hide Tool Activity",
    description:
      "Hide model-initiated tool calls and results from the transcript",
    type: "boolean",
    default: false,
  },
  {
    path: "display.shimmer",
    tab: "appearance",
    group: "Display",
    label: "Shimmer",
    description: "Animation style for working/loading messages",
    type: "enum",
    values: ["classic", "kitt", "disabled"],
    options: [
      {
        value: "classic",
        label: "Classic",
        description: "Soft cosine wave sweeping across the text",
      },
      {
        value: "kitt",
        label: "KITT Scanner",
        description: "Knight Rider 1982 red light bouncing left-right",
      },
      {
        value: "disabled",
        label: "Disabled",
        description: "No animation; static muted text",
      },
    ],
    default: "classic",
  },
  {
    path: "edit.fuzzyThreshold",
    tab: "files",
    group: "Editing",
    label: "Fuzzy Match Threshold",
    description: "Similarity threshold (0-1) for accepting fuzzy matches",
    type: "number-choice",
    options: [
      { value: "0.85", label: "0.85", description: "Lenient" },
      { value: "0.90", label: "0.90", description: "Moderate" },
      { value: "0.95", label: "0.95", description: "Default" },
      { value: "0.98", label: "0.98", description: "Strict" },
    ],
    default: 0.95,
  },
  {
    path: "edit.streamingAbort",
    tab: "files",
    group: "Editing",
    label: "Abort on Failed Preview",
    description: "Abort streaming edit tool calls when patch preview fails",
    type: "boolean",
    default: false,
  },
  {
    path: "edit.blockAutoGenerated",
    tab: "files",
    group: "Editing",
    label: "Block Auto-Generated Files",
    description:
      "Prevent editing of files that appear to be auto-generated (protoc, sqlc, swagger, etc.)",
    type: "boolean",
    default: true,
  },
  {
    path: "edit.enforceSeenLines",
    tab: "files",
    group: "Editing",
    label: "Enforce Seen-Line Guard",
    description:
      "Reject edits anchored on lines a prior read/search never displayed in full",
    type: "boolean",
    default: false,
  },
  {
    path: "readLineNumbers",
    tab: "files",
    group: "Reading",
    label: "Line Numbers",
    description: "Prepend line numbers to read tool output by default",
    type: "boolean",
    default: false,
  },
  {
    path: "read.defaultLimit",
    tab: "files",
    group: "Reading",
    label: "Default Read Limit",
    description:
      "Default number of lines returned when agent calls read without a limit",
    type: "number-choice",
    options: [
      { value: "200", label: "200 lines" },
      { value: "300", label: "300 lines" },
      { value: "500", label: "500 lines" },
      { value: "1000", label: "1000 lines" },
      { value: "5000", label: "5000 lines" },
    ],
    default: 300,
  },
  {
    path: "read.renderMarkdown",
    tab: "files",
    group: "Reading",
    label: "Markdown Previews",
    description:
      "Render Markdown read results as formatted terminal Markdown previews instead of raw source",
    type: "boolean",
    default: false,
  },
  {
    path: "read.summarize.enabled",
    tab: "files",
    group: "Read Summaries",
    label: "Read Summaries",
    description:
      "Return structural code summaries when read is called without an explicit selector",
    type: "boolean",
    default: true,
  },
  {
    path: "read.summarize.prose",
    tab: "files",
    group: "Read Summaries",
    label: "Prose Summaries",
    description:
      "Return structural summaries for Markdown and plain text reads",
    type: "boolean",
    default: false,
  },
  {
    path: "read.toolResultPreview",
    tab: "files",
    group: "Reading",
    label: "Inline Read Previews",
    description:
      "Render read tool results inline in the transcript instead of summary rows",
    type: "boolean",
    default: false,
  },
  {
    path: "lsp.enabled",
    tab: "files",
    group: "LSP",
    label: "LSP",
    description:
      "Enable the lsp tool for code intelligence (definitions, references, diagnostics, rename)",
    type: "boolean",
    default: true,
  },
  {
    path: "lsp.lazy",
    tab: "files",
    group: "LSP",
    label: "Lazy LSP Startup",
    description:
      "Start language servers on first use (lsp tool or editing a matching file type) instead of at session startup",
    type: "boolean",
    default: true,
  },
  {
    path: "lsp.shared",
    tab: "files",
    group: "LSP",
    label: "Shared Language Servers",
    description:
      "Share one language server per project across omp instances via the daemon broker (falls back to private servers when unavailable)",
    type: "boolean",
    default: true,
  },
  {
    path: "lsp.formatOnWrite",
    tab: "files",
    group: "LSP",
    label: "Format on Write",
    description: "Automatically format code files using LSP after writing",
    type: "boolean",
    default: false,
  },
  {
    path: "lsp.diagnosticsOnWrite",
    tab: "files",
    group: "LSP",
    label: "Diagnostics on Write",
    description: "Return LSP diagnostics after writing code files",
    type: "boolean",
    default: true,
  },
  {
    path: "lsp.diagnosticsOnEdit",
    tab: "files",
    group: "LSP",
    label: "Diagnostics on Edit",
    description: "Return LSP diagnostics after editing code files",
    type: "boolean",
    default: false,
  },
  {
    path: "lsp.diagnosticsDeduplicate",
    tab: "files",
    group: "LSP",
    label: "Deduplicate Diagnostics",
    description:
      "Suppress post-edit LSP diagnostics already shown for a file; only surface new or changed ones",
    type: "boolean",
    default: true,
  },
  {
    path: "secrets.hide",
    tab: "providers",
    group: "Privacy",
    label: "Hide Secrets",
    description:
      "Obfuscate configured secrets and redact credential-shaped tokens before sending to AI providers",
    type: "boolean",
    default: true,
  },
  {
    path: "providers.antigravityEndpoint",
    tab: "providers",
    group: "Services",
    label: "Antigravity Endpoint Mode",
    description:
      "Endpoint routing strategy for google-antigravity providers (chat, search, image, discovery)",
    type: "enum",
    values: ["auto", "production", "sandbox"],
    options: [
      {
        value: "auto",
        label: "Auto",
        description: "Try production endpoint, fail over to sandbox on 5xx/429",
      },
      {
        value: "production",
        label: "Production Only",
        description: "Force production endpoint only",
      },
      {
        value: "sandbox",
        label: "Sandbox Only",
        description: "Force sandbox endpoint only",
      },
    ],
    default: "auto",
  },
  {
    path: "providers.fireworksTier",
    tab: "providers",
    group: "Fireworks",
    label: "Fireworks Tier",
    description:
      'Serving path for Fireworks requests. Priority sends `service_tier: "priority"` for higher reliability during peak traffic at a higher price; Standard omits it. Fast (`-fast`) models ignore this — Fast is its own serving path.',
    type: "enum",
    values: ["standard", "priority"],
    options: [
      {
        value: "standard",
        label: "Standard",
        description: "Default serving path (no service_tier)",
      },
      {
        value: "priority",
        label: "Priority",
        description:
          "Priority serving path: higher reliability, premium per-token pricing",
      },
    ],
    default: "standard",
  },
  {
    path: "providers.tts",
    tab: "providers",
    group: "Services",
    label: "Text-to-Speech Provider",
    description:
      "Backend for the tts tool: local on-device neural TTS (Kokoro-82M) or xAI Grok Voice",
    type: "enum",
    values: ["auto", "local", "xai"],
    options: [
      {
        value: "auto",
        label: "Auto",
        description:
          "Prefer local on-device TTS; route .mp3 output to xAI when credentials exist",
      },
      {
        value: "local",
        label: "Local",
        description: "On-device neural TTS (Kokoro-82M); output is WAV/PCM16",
      },
      {
        value: "xai",
        label: "xAI Grok Voice",
        description: "Requires xAI Grok OAuth or XAI_API_KEY; MP3 or WAV",
      },
    ],
    default: "auto",
  },
  {
    path: "speech.enabled",
    tab: "providers",
    group: "Services",
    label: "Speech Vocalization",
    description:
      "Speak the assistant's output aloud through the speakers as it streams",
    type: "boolean",
    default: false,
  },
  {
    path: "speech.mode",
    tab: "providers",
    group: "Services",
    label: "Speech Vocalization Mode",
    description:
      "What to speak: all = assistant messages + thinking; assistant = messages only; yield = only the final message at turn end",
    type: "enum",
    values: ["all", "assistant", "yield"],
    options: [
      { value: "all", label: "All (messages + thinking)" },
      { value: "assistant", label: "Assistant messages" },
      { value: "yield", label: "Final message only" },
    ],
    default: "assistant",
  },
  {
    path: "speech.enhanced",
    tab: "providers",
    group: "Services",
    label: "Enhanced Speech Rewriting",
    description:
      "Rewrite assistant output into natural spoken prose with the tiny/smol model before synthesis (describes code, drops links and markdown). Falls back to mechanical cleanup on failure",
    type: "boolean",
    default: false,
  },
  {
    path: "providers.kimiApiFormat",
    tab: "providers",
    group: "Protocol",
    label: "Kimi API Format",
    description:
      "API format for Kimi Code provider (auto follows live model metadata)",
    type: "enum",
    values: ["auto", "openai", "anthropic"],
    options: [
      {
        value: "auto",
        label: "Auto",
        description: "Use the model's server-declared protocol",
      },
      { value: "openai", label: "OpenAI", description: "api.kimi.com" },
      {
        value: "anthropic",
        label: "Anthropic",
        description: "api.moonshot.ai",
      },
    ],
    default: "auto",
  },
  {
    path: "providers.openaiWebsockets",
    tab: "providers",
    group: "Protocol",
    label: "OpenAI WebSockets",
    description:
      "Websocket policy for OpenAI Codex models (auto uses model defaults, on forces, off disables)",
    type: "enum",
    values: ["auto", "off", "on"],
    options: [
      {
        value: "auto",
        label: "Auto",
        description: "Use model/provider default websocket behavior",
      },
      {
        value: "off",
        label: "Off",
        description: "Disable websockets for OpenAI Codex models",
      },
      {
        value: "on",
        label: "On",
        description: "Force websockets for OpenAI Codex models",
      },
    ],
    default: "auto",
  },
  {
    path: "providers.streamFirstEventTimeoutSeconds",
    tab: "providers",
    group: "Timeouts",
    label: "Stream First Event Timeout",
    description:
      "Seconds to wait for the first model stream event; -1 uses provider/env defaults, 0 disables the watchdog",
    type: "number-choice",
    options: [
      {
        value: "-1",
        label: "Auto",
        description: "Use provider defaults and PI_* timeout env vars",
      },
      { value: "0", label: "Off", description: "Disable first-event timeout" },
      { value: "300", label: "5 minutes" },
      { value: "600", label: "10 minutes" },
      { value: "1800", label: "30 minutes" },
    ],
    default: -1,
  },
  {
    path: "providers.streamIdleTimeoutSeconds",
    tab: "providers",
    group: "Timeouts",
    label: "Stream Idle Timeout",
    description:
      "Seconds a model stream may stay silent between events; -1 uses provider/env defaults, 0 disables the watchdog",
    type: "number-choice",
    options: [
      {
        value: "-1",
        label: "Auto",
        description: "Use provider defaults and PI_* timeout env vars",
      },
      { value: "0", label: "Off", description: "Disable idle timeout" },
      { value: "300", label: "5 minutes" },
      { value: "600", label: "10 minutes" },
      { value: "1800", label: "30 minutes" },
    ],
    default: -1,
  },
  {
    path: "providers.openrouterVariant",
    tab: "providers",
    group: "Protocol",
    label: "OpenRouter Routing",
    description:
      "Default routing-variant suffix appended to OpenRouter model IDs (overridden when the selector already names a variant)",
    type: "enum",
    values: ["default", "nitro", "floor", "online", "exacto"],
    options: [
      {
        value: "default",
        label: "Default",
        description: "No suffix; use OpenRouter's default routing",
      },
      {
        value: "nitro",
        label: ":nitro",
        description: "Prioritize throughput / lowest latency",
      },
      {
        value: "floor",
        label: ":floor",
        description: "Prioritize cheapest available provider",
      },
      {
        value: "online",
        label: ":online",
        description: "Enable OpenRouter's web-search plugin",
      },
      {
        value: "exacto",
        label: ":exacto",
        description:
          "Cherry-picked high-quality providers (only defined for select models)",
      },
    ],
    default: "default",
  },
  {
    path: "providers.fetch",
    tab: "providers",
    group: "Services",
    label: "Fetch Provider",
    description: "Reader backend priority for the fetch/read URL tool",
    type: "enum",
    values: ["auto", "native", "trafilatura", "lynx", "parallel", "jina"],
    options: [
      {
        value: "auto",
        label: "Auto",
        description: "Priority: native > trafilatura > lynx > parallel > jina",
      },
      {
        value: "native",
        label: "Native",
        description: "In-process HTML→Markdown converter (always available)",
      },
      {
        value: "trafilatura",
        label: "Trafilatura",
        description: "Auto-installs via uv/pip",
      },
      {
        value: "lynx",
        label: "Lynx",
        description: "Requires lynx system package",
      },
      {
        value: "parallel",
        label: "Parallel",
        description: "Requires PARALLEL_API_KEY",
      },
      {
        value: "jina",
        label: "Jina",
        description: "Uses r.jina.ai reader (JINA_API_KEY optional)",
      },
    ],
    default: "auto",
  },
  {
    path: "codexResets.autoRedeem",
    tab: "providers",
    group: "Services",
    label: "Codex Auto-Redeem Saved Resets",
    description:
      "Spend saved Codex rate-limit resets automatically: restore an account blocked by an exhausted 5h or weekly window when a turn is stuck and no other account can take over, and salvage credits that are about to expire. unset asks before the first spend, yes spends without prompting, and no disables both checks.",
    type: "enum",
    values: ["unset", "yes", "no"],
    options: [
      {
        value: "unset",
        label: "Unset",
        description:
          "Check eligibility, then ask before spending the first saved reset.",
      },
      {
        value: "yes",
        label: "Yes",
        description: "Spend eligible saved resets without prompting.",
      },
      {
        value: "no",
        label: "No",
        description: "Do not run the saved-reset auto-redeem check.",
      },
    ],
    default: "unset",
  },
  {
    path: "provider.appendOnlyContext",
    tab: "providers",
    group: "Protocol",
    label: "Append-Only Context",
    description:
      "Cache system prompt + tool specs and keep an append-only message log so provider prefix caches (DeepSeek, Xiaomi/SGLang, Anthropic) hit at maximum rate. Auto enables for known prefix-cache providers.",
    type: "enum",
    values: ["auto", "on", "off"],
    options: [
      {
        value: "auto",
        label: "Auto",
        description: "Enable for known prefix-cache providers (recommended)",
      },
      {
        value: "on",
        label: "On",
        description: "Always enable append-only context",
      },
      {
        value: "off",
        label: "Off",
        description: "Disable append-only context",
      },
    ],
    default: "auto",
  },
  {
    path: "exa.enabled",
    tab: "providers",
    group: "Services",
    label: "Exa",
    description: "Enable the Exa web search provider",
    type: "boolean",
    default: true,
  },
  // TODO: runtime options
  {
    path: "plan.enabled",
    tab: "tasks",
    group: "Modes",
    label: "Plan Mode",
    description:
      "Enable plan mode for read-only exploration and planning before execution",
    type: "boolean",
    default: true,
  },
  {
    path: "plan.defaultOnStartup",
    tab: "tasks",
    group: "Modes",
    label: "Start in Plan Mode",
    description:
      "Automatically enter plan mode at the start of every new session",
    condition: "planModeEnabled",
    type: "boolean",
    default: false,
  },
  {
    path: "goal.enabled",
    tab: "tasks",
    group: "Modes",
    label: "Goal Mode",
    description: "Enable per-session goal mode and the hidden goal tool",
    type: "boolean",
    default: true,
  },
  {
    path: "goal.statusInFooter",
    tab: "tasks",
    group: "Modes",
    label: "Goal Status in Footer",
    description:
      "Show token budget alongside the goal indicator in the status line",
    type: "boolean",
    default: true,
  },
  {
    path: "title.refreshOnReplan",
    tab: "tasks",
    group: "Modes",
    label: "Refresh Title on Replan",
    description:
      "Refresh generated session titles after todo init replans unless the title was set by the user",
    type: "boolean",
    default: true,
  },
  {
    path: "task.isolation.mode",
    tab: "tasks",
    group: "Isolation",
    label: "Isolation Mode",
    description:
      'Isolation backend for subagents. "auto" lets the native PAL pick the best available backend (CoW-aware filesystems, then overlayfs/ProjFS, then a git worktree / recursive-copy fallback).',
    type: "enum",
    values: [
      "none",
      "auto",
      "apfs",
      "btrfs",
      "zfs",
      "reflink",
      "overlayfs",
      "projfs",
      "block-clone",
      "rcopy",
    ],
    options: [
      { value: "none", label: "None", description: "No isolation" },
      {
        value: "auto",
        label: "Auto",
        description: "Let the PAL pick the best available backend",
      },
      {
        value: "apfs",
        label: "APFS",
        description: "macOS clonefile reflink (APFS)",
      },
      {
        value: "btrfs",
        label: "btrfs",
        description: "btrfs subvolume snapshot",
      },
      { value: "zfs", label: "ZFS", description: "ZFS snapshot + clone" },
      {
        value: "reflink",
        label: "Reflink",
        description: "Linux FICLONE per-file reflink",
      },
      {
        value: "overlayfs",
        label: "Overlayfs",
        description: "Linux kernel overlay (or fuse-overlayfs fallback)",
      },
      {
        value: "projfs",
        label: "ProjFS",
        description: "Windows Projected File System",
      },
      {
        value: "block-clone",
        label: "Block clone",
        description: "Windows FSCTL_DUPLICATE_EXTENTS_TO_FILE (NTFS/ReFS)",
      },
      {
        value: "rcopy",
        label: "Recursive copy",
        description: "git worktree if available, otherwise recursive copy",
      },
    ],
    default: "none",
  },
  {
    path: "task.isolation.apply",
    tab: "tasks",
    group: "Isolation",
    label: "Apply Isolated Changes",
    description:
      "Automatically apply successful isolated task changes to the parent checkout; disable to retain patch or branch artifacts",
    type: "boolean",
    default: true,
  },
  {
    path: "task.isolation.merge",
    tab: "tasks",
    group: "Isolation",
    label: "Isolation Merge Strategy",
    description:
      "How isolated task changes are integrated (patch apply or branch merge)",
    type: "enum",
    values: ["patch", "branch"],
    options: [
      {
        value: "patch",
        label: "Patch",
        description: "Combine diffs and git apply",
      },
      {
        value: "branch",
        label: "Branch",
        description: "Commit per task, merge with --no-ff",
      },
    ],
    default: "patch",
  },
  {
    path: "task.isolation.commits",
    tab: "tasks",
    group: "Isolation",
    label: "Isolation Commit Style",
    description:
      "Commit message style for nested repo changes (generic or AI-generated)",
    type: "enum",
    values: ["generic", "ai"],
    options: [
      {
        value: "generic",
        label: "Generic",
        description: "Static commit message",
      },
      {
        value: "ai",
        label: "AI",
        description: "AI-generated commit message from diff",
      },
    ],
    default: "generic",
  },
  {
    path: "task.eager",
    tab: "tasks",
    group: "Subagents",
    label: "Prefer Task Delegation",
    description: "How strongly to push delegating work to subagents",
    type: "enum",
    values: ["default", "preferred", "always"],
    options: [
      {
        value: "default",
        label: "Default",
        description: "Model decides when to delegate",
      },
      {
        value: "preferred",
        label: "Preferred",
        description: "Adds delegation guidance to the system prompt",
      },
      {
        value: "always",
        label: "Always",
        description: "Prompt guidance plus a first-turn delegation reminder",
      },
    ],
    default: "default",
  },
  {
    path: "worktree.base",
    tab: "tasks",
    group: "Isolation",
    label: "Worktree Base Directory",
    description:
      "Base directory for agent-managed worktrees — task-isolation copies, `github` PR checkouts, and `omp worktree` cleanup all live here. Unset uses ~/.omp/wt. Must be an absolute or ~-relative path; relative paths are ignored. The OMP_WORKTREE_DIR env var overrides this.",
    type: "text",
    default: "",
  },
  {
    path: "task.batch",
    tab: "tasks",
    group: "Subagents",
    label: "Batch Task Calls",
    description:
      "Switch the task tool to its batch shape: one call carries { context, tasks[] } — one subagent per item, with an optional per-item agent (defaulting to the session spawn-policy agent), per-item isolation, and a required shared context prepended to every assignment. With async.enabled=true, each spawn runs as an independent background agent with the normal idle/parked lifecycle; otherwise the call blocks for merged results. Disable to restore the flat single-spawn schema.",
    type: "boolean",
    default: true,
  },
  {
    path: "task.enableEffort",
    tab: "tasks",
    group: "Subagents",
    label: "Per-Task Effort",
    description:
      "Expose the optional effort parameter on task spawns, allowing callers to override each subagent's thinking level",
    type: "boolean",
    default: false,
  },
  {
    path: "task.maxConcurrency",
    tab: "tasks",
    group: "Subagents",
    label: "Max Concurrent Tasks",
    description: "Maximum number of subagents running concurrently",
    type: "number-choice",
    options: [
      { value: "0", label: "Unlimited" },
      { value: "1", label: "1 task" },
      { value: "2", label: "2 tasks" },
      { value: "4", label: "4 tasks" },
      { value: "8", label: "8 tasks" },
      { value: "16", label: "16 tasks" },
      { value: "32", label: "32 tasks" },
      { value: "64", label: "64 tasks" },
    ],
    default: 32,
  },
  {
    path: "task.enableLsp",
    tab: "tasks",
    group: "Subagents",
    label: "LSP in Subagents",
    description:
      "Allow subagents spawned via the task tool to use the lsp tool. Off by default to keep subagents cheap; enable when LSP-aware delegation is worth the extra tokens.",
    type: "boolean",
    default: false,
  },
  {
    path: "task.maxRecursionDepth",
    tab: "tasks",
    group: "Subagents",
    label: "Max Task Recursion",
    description: "How many levels deep subagents can spawn their own subagents",
    type: "number-choice",
    options: [
      { value: "-1", label: "Unlimited" },
      { value: "0", label: "None" },
      { value: "1", label: "Single" },
      { value: "2", label: "Double" },
      { value: "3", label: "Triple" },
    ],
    default: 2,
  },
  {
    path: "task.maxRuntimeMs",
    tab: "tasks",
    group: "Subagents",
    label: "Max Subagent Runtime",
    description:
      "Hard wall-clock limit per subagent (ms). 0 disables it. Defense-in-depth against provider-side stream hangs that escape the inference-layer watchdog; triggers a normal subagent abort with a 'timed out' reason.",
    type: "number-choice",
    options: [
      { value: "0", label: "Unlimited", description: "Default" },
      { value: "300000", label: "5 minutes" },
      { value: "900000", label: "15 minutes" },
      { value: "1800000", label: "30 minutes" },
      { value: "3600000", label: "1 hour" },
    ],
    default: 0,
  },
  {
    path: "task.softRequestBudget",
    tab: "tasks",
    group: "Subagents",
    label: "Soft Subagent Request Budget",
    description:
      "Soft per-subagent request budget (assistant requests per run). Crossing it injects a wrap-up steering notice (see task.softRequestBudgetNotice); at 1.5x the budget the run is force-stopped and the agent must yield its partial findings. 0 disables the guard. Bundled scout/sonic agents cap out at a lower built-in budget, so a value below that cap still applies to them.",
    type: "number-choice",
    options: [
      { value: "0", label: "Disabled" },
      { value: "90", label: "90 requests" },
      { value: "150", label: "150 requests" },
      { value: "200", label: "200 requests", description: "Default" },
    ],
    default: 200,
  },
  {
    path: "task.softRequestBudgetNotice",
    tab: "tasks",
    group: "Subagents",
    label: "Soft Request Budget Notice",
    description:
      "Inject one steering notice when a subagent crosses its soft request budget, asking it to wrap up before the 1.5x forced-yield stop.",
    type: "boolean",
    default: true,
  },
  {
    path: "task.maxEffort",
    tab: "tasks",
    group: "Subagents",
    label: "Maximum Per-Spawn Effort",
    description:
      "Maximum reasoning effort allowed for the task tool's per-spawn effort hint. Lower values prevent callers from escalating subagents above this ceiling; the default preserves the model's full range.",
    type: "enum",
    values: ["minimal", "low", "medium", "high", "xhigh", "max"],
    options: [
      {
        value: "minimal",
        label: "min",
        description: "Very brief reasoning (~1k tokens)",
      },
      {
        value: "low",
        label: "low",
        description: "Light reasoning (~2k tokens)",
      },
      {
        value: "medium",
        label: "medium",
        description: "Moderate reasoning (~8k tokens)",
      },
      {
        value: "high",
        label: "high",
        description: "Deep reasoning (~16k tokens)",
      },
      {
        value: "xhigh",
        label: "xhigh",
        description: "Extended reasoning (~32k tokens)",
      },
      {
        value: "max",
        label: "max",
        description: "Maximum reasoning the model supports",
      },
    ],
    default: "max",
  },
  {
    path: "task.prewalk",
    tab: "tasks",
    group: "Subagents",
    label: "Generic Task Prewalk",
    description:
      "Arm prewalk for the bundled generic `task` subagent: it starts on its resolved model, plans and begins the implementation, then hands off to the 'smol' role at its first edit/write. Per-agent overrides (task.agentPrewalk, toggled with P in /agents) and user agent `prewalk` frontmatter apply regardless of this toggle.",
    type: "boolean",
    default: false,
  },
  {
    path: "skills.enableSkillCommands",
    tab: "tasks",
    group: "Commands & Skills",
    label: "Skill Commands",
    description: "Register skills as /skill:name commands",
    type: "boolean",
    default: true,
  },
  {
    path: "commands.enableClaudeUser",
    tab: "tasks",
    group: "Commands & Skills",
    label: "Claude User Commands",
    description: "Load commands from ~/.claude/commands/",
    type: "boolean",
    default: true,
  },
  {
    path: "commands.enableClaudeProject",
    tab: "tasks",
    group: "Commands & Skills",
    label: "Claude Project Commands",
    description: "Load commands from .claude/commands/",
    type: "boolean",
    default: true,
  },
  {
    path: "commands.enableOpencodeUser",
    tab: "tasks",
    group: "Commands & Skills",
    label: "OpenCode User Commands",
    description: "Load commands from ~/.config/opencode/commands/",
    type: "boolean",
    default: true,
  },
  {
    path: "commands.enableOpencodeProject",
    tab: "tasks",
    group: "Commands & Skills",
    label: "OpenCode Project Commands",
    description: "Load commands from .opencode/commands/",
    type: "boolean",
    default: true,
  },
  {
    path: "bash.enabled",
    tab: "shell",
    group: "Bash",
    label: "Bash",
    description: "Enable the bash tool for shell command execution",
    type: "boolean",
    default: true,
  },
  {
    path: "bash.autoBackground.enabled",
    tab: "shell",
    group: "Bash",
    label: "Bash Auto-Background",
    description:
      "Automatically background long-running bash commands and deliver the result later",
    type: "boolean",
    default: false,
  },
  {
    path: "bashInterceptor.enabled",
    tab: "shell",
    group: "Bash",
    label: "Bash Interceptor",
    description: "Block shell commands that have dedicated tools",
    type: "boolean",
    default: false,
  },
  {
    path: "bash.direnv",
    tab: "shell",
    group: "Bash",
    label: "direnv Auto-Load",
    description:
      "Auto-load a repo's direnv/devenv `.envrc` into the bash session so devenv tools and env vars are present without manual `direnv exec`. Honors direnv's allow list: an `.envrc` you haven't `direnv allow`ed is never executed",
    type: "enum",
    values: ["auto", "off"],
    options: [
      { value: "auto", label: "auto" },
      { value: "off", label: "off" },
    ],
    default: "auto",
  },
  {
    path: "shellMinimizer.enabled",
    tab: "shell",
    group: "Bash",
    label: "Shell Minimizer",
    description:
      "Compress verbose shell output (git, npm, cargo, etc.) before returning it to the agent",
    type: "boolean",
    default: true,
  },
  {
    path: "shellMinimizer.sourceOutlineLevel",
    tab: "shell",
    group: "Bash",
    label: "Shell Minimizer Source Outline",
    description:
      "Source outline mode for cat/read of source files: default or aggressive",
    type: "enum",
    values: ["default", "aggressive"],
    options: [
      { value: "default", label: "default" },
      { value: "aggressive", label: "aggressive" },
    ],
    default: "default",
  },
  {
    path: "eval.py",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "Python Eval Backend",
    description:
      "Allow the eval tool to dispatch Python cells to the IPython kernel",
    type: "boolean",
    default: true,
  },
  {
    path: "eval.js",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "JavaScript Eval Backend",
    description:
      "Allow the eval tool to dispatch JavaScript cells to the in-process runtime",
    type: "boolean",
    default: true,
  },
  {
    path: "eval.rb",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "Ruby Eval Backend",
    description:
      "Allow the eval tool to dispatch Ruby cells to the persistent Ruby kernel",
    type: "boolean",
    default: false,
  },
  {
    path: "eval.jl",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "Julia Eval Backend",
    description:
      "Allow the eval tool to dispatch Julia cells to the persistent Julia kernel",
    type: "boolean",
    default: false,
  },
  {
    path: "python.kernelMode",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "Python Kernel Mode",
    description:
      "Keep the IPython kernel alive across eval calls or start fresh each time",
    type: "enum",
    values: ["session", "per-call"],
    options: [
      { value: "session", label: "session" },
      { value: "per-call", label: "per-call" },
    ],
    default: "session",
  },
  {
    path: "python.interpreter",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "Python Interpreter",
    description:
      "Optional path to an exact Python executable. When set, automatic Python runtime discovery is skipped.",
    type: "text",
    default: "",
  },
  {
    path: "ruby.interpreter",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "Ruby Interpreter",
    description:
      "Optional path to an exact Ruby executable. When set, automatic Ruby runtime discovery is skipped.",
    type: "text",
    default: "",
  },
  {
    path: "julia.interpreter",
    tab: "shell",
    group: "Eval & Runtimes",
    label: "Julia Interpreter",
    description:
      "Optional path to an exact Julia executable. When set, automatic Julia runtime discovery is skipped.",
    type: "text",
    default: "",
  },

  {
    path: "tools.artifactSpillThreshold",
    tab: "tools",
    group: "Output Limits",
    label: "Artifact Spill Threshold (KB)",
    description:
      "Tool output above this size is saved as an artifact; tail is kept inline",
    options: [
      { value: "1", label: "1 KB", description: "~250 tokens" },
      { value: "2.5", label: "2.5 KB", description: "~625 tokens" },
      { value: "5", label: "5 KB", description: "~1.25K tokens" },
      { value: "10", label: "10 KB", description: "~2.5K tokens" },
      { value: "20", label: "20 KB", description: "~5K tokens" },
      { value: "30", label: "30 KB", description: "~7.5K tokens" },
      { value: "50", label: "50 KB", description: "Default; ~12.5K tokens" },
      { value: "75", label: "75 KB", description: "~19K tokens" },
      { value: "100", label: "100 KB", description: "~25K tokens" },
      { value: "200", label: "200 KB", description: "~50K tokens" },
      { value: "500", label: "500 KB", description: "~125K tokens" },
      { value: "1000", label: "1 MB", description: "~250K tokens" },
    ],
    type: "number-choice",
    default: 50,
  },
  {
    path: "tools.artifactTailBytes",
    tab: "tools",
    group: "Output Limits",
    label: "Artifact Tail Size (KB)",
    description:
      "Amount of tail content kept inline when output spills to artifact",
    options: [
      { value: "1", label: "1 KB", description: "~250 tokens" },
      { value: "2.5", label: "2.5 KB", description: "~625 tokens" },
      { value: "5", label: "5 KB", description: "~1.25K tokens" },
      { value: "10", label: "10 KB", description: "~2.5K tokens" },
      { value: "20", label: "20 KB", description: "Default; ~5K tokens" },
      { value: "50", label: "50 KB", description: "~12.5K tokens" },
      { value: "100", label: "100 KB", description: "~25K tokens" },
      { value: "200", label: "200 KB", description: "~50K tokens" },
    ],
    type: "number-choice",
    default: 20,
  },
  {
    path: "tools.artifactHeadBytes",
    tab: "tools",
    group: "Output Limits",
    label: "Artifact Head Size (KB)",
    description:
      "Amount of head content kept inline alongside the tail when output spills to artifact (middle elision). 0 disables — keep tail only.",
    options: [
      {
        value: "0",
        label: "0 KB",
        description: "Disabled; tail-only truncation",
      },
      { value: "1", label: "1 KB", description: "~250 tokens" },
      { value: "2.5", label: "2.5 KB", description: "~625 tokens" },
      { value: "5", label: "5 KB", description: "~1.25K tokens" },
      { value: "10", label: "10 KB", description: "~2.5K tokens" },
      { value: "20", label: "20 KB", description: "Default; ~5K tokens" },
      { value: "50", label: "50 KB", description: "~12.5K tokens" },
      { value: "100", label: "100 KB", description: "~25K tokens" },
      { value: "200", label: "200 KB", description: "~50K tokens" },
    ],
    type: "number-choice",
    default: 20,
  },
  {
    path: "tools.outputMaxColumns",
    tab: "tools",
    group: "Output Limits",
    label: "Output Column Cap",
    description:
      "Per-line byte cap for streaming tool outputs (bash, python, js eval) and `read`. Lines wider than this are ellipsis-truncated; remaining bytes up to the next newline are dropped. 0 disables.",
    options: [
      { value: "0", label: "Off", description: "No per-line cap" },
      { value: "256", label: "256", description: "Tight" },
      { value: "512", label: "512" },
      { value: "768", label: "768", description: "Default" },
      { value: "1024", label: "1024" },
      { value: "2048", label: "2048" },
      { value: "4096", label: "4096", description: "Loose" },
    ],
    type: "number-choice",
    default: 768,
  },
  {
    path: "tools.artifactTailLines",
    tab: "tools",
    group: "Output Limits",
    label: "Artifact Tail Lines",
    description:
      "Maximum lines of tail content kept inline when output spills to artifact",
    options: [
      { value: "50", label: "50 lines", description: "~250 tokens" },
      { value: "100", label: "100 lines", description: "~500 tokens" },
      { value: "250", label: "250 lines", description: "~1.25K tokens" },
      {
        value: "500",
        label: "500 lines",
        description: "Default; ~2.5K tokens",
      },
      { value: "1000", label: "1000 lines", description: "~5K tokens" },
      { value: "2000", label: "2000 lines", description: "~10K tokens" },
      { value: "5000", label: "5000 lines", description: "~25K tokens" },
    ],
    type: "number-choice",
    default: 500,
  },
  {
    path: "todo.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Todos",
    description: "Enable the todo tool for task tracking",
    type: "boolean",
    default: true,
  },
  {
    path: "todo.reminders",
    tab: "tools",
    group: "Todos",
    label: "Todo Reminders",
    description: "Remind the agent to complete todos before stopping",
    type: "boolean",
    default: true,
  },
  {
    path: "todo.remindersMax",
    tab: "tools",
    group: "Todos",
    label: "Todo Reminder Limit",
    description: "Maximum number of todo reminders before giving up",
    options: [
      { value: "1", label: "1 reminder" },
      { value: "2", label: "2 reminders" },
      { value: "3", label: "3 reminders" },
      { value: "5", label: "5 reminders" },
    ],
    type: "number-choice",
    default: 3,
  },
  {
    path: "todo.eager",
    tab: "tools",
    group: "Todos",
    label: "Create Todos Automatically",
    description:
      "How strongly to push automatic todo-list creation after the first message",
    options: [
      {
        value: "default",
        label: "Default",
        description: "Model decides; no automatic todo list",
      },
      {
        value: "preferred",
        label: "Preferred",
        description:
          "Suggests a todo list on the first message (reminder, not forced)",
      },
      {
        value: "always",
        label: "Always",
        description: "Forces a comprehensive todo list on the first message",
      },
    ],
    type: "enum",
    values: ["default", "preferred", "always"],
    default: "default",
  },
  {
    path: "glob.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Glob",
    description: "Enable the glob tool for glob-based file lookup",
    type: "boolean",
    default: true,
  },
  {
    path: "grep.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Grep",
    description: "Enable the grep tool for regex content search",
    type: "boolean",
    default: true,
  },
  {
    path: "grep.contextBefore",
    tab: "tools",
    group: "Grep & Browser",
    label: "Grep Context Before",
    description: "Lines of context before each grep match",
    options: [
      { value: "0", label: "0 lines" },
      { value: "1", label: "1 line" },
      { value: "2", label: "2 lines" },
      { value: "3", label: "3 lines" },
      { value: "5", label: "5 lines" },
    ],
    type: "number-choice",
    default: 1,
  },
  {
    path: "grep.contextAfter",
    tab: "tools",
    group: "Grep & Browser",
    label: "Grep Context After",
    description: "Lines of context after each grep match",
    options: [
      { value: "0", label: "0 lines" },
      { value: "1", label: "1 line" },
      { value: "2", label: "2 lines" },
      { value: "3", label: "3 lines" },
      { value: "5", label: "5 lines" },
      { value: "10", label: "10 lines" },
    ],
    type: "number-choice",
    default: 3,
  },
  {
    path: "astGrep.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "AST Grep",
    description: "Enable the ast_grep tool for structural AST search",
    type: "boolean",
    default: false,
  },
  {
    path: "astEdit.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "AST Edit",
    description: "Enable the ast_edit tool for structural AST rewrites",
    type: "boolean",
    default: true,
  },
  {
    path: "debug.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Debug",
    description: "Enable the debug tool for DAP-based debugging",
    type: "boolean",
    default: true,
  },
  {
    path: "launch.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Launch",
    description:
      "Enable the launch tool for supervising shared long-running project processes",
    type: "boolean",
    default: true,
  },
  {
    path: "speechgen.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Speech Generation",
    description:
      "Enable the tts tool for on-device (Kokoro) or xAI Grok Voice speech-file synthesis",
    type: "boolean",
    default: false,
  },
  {
    path: "generate_image.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Generate Image",
    description:
      "Enable the generate_image tool (text-to-image generation and editing). Exposed as an xd:// device when tools.xdev is on.",
    type: "boolean",
    default: false,
  },
  {
    path: "inspect_image.mode",
    tab: "tools",
    group: "Available Tools",
    label: "Inspect Image",
    description:
      "Controls the inspect_image tool, which delegates image understanding to a vision-capable model. 'auto' exposes it only when the active model lacks native image input; 'on' always exposes it; 'off' never does.",
    options: [
      { value: "auto", label: "Auto (only for models without vision)" },
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
    type: "enum",
    values: ["auto", "on", "off"],
    default: "auto",
  },
  {
    path: "computer.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Computer",
    description:
      "Enable the scriptable host-desktop control tool (screenshots, input, accessibility)",
    type: "boolean",
    default: false,
  },
  {
    path: "computer.display",
    tab: "tools",
    group: "Computer",
    label: "Computer Display",
    description: "Composite all displays or select a native display id",
    type: "text",
    default: "all",
  },
  {
    path: "inspect_image.timeoutMs",
    tab: "tools",
    group: "Execution",
    label: "Inspect Image Timeout",
    description:
      "Per-request timeout for the inspect_image vision-model call, in milliseconds. A stalled provider fails fast with a timeout error instead of blocking until manual abort. Set to 0 to disable the timeout.",
    options: [
      { value: "0", label: "Disabled" },
      { value: "60000", label: "1 minute" },
      { value: "120000", label: "2 minutes" },
      { value: "180000", label: "3 minutes" },
      { value: "300000", label: "5 minutes" },
    ],
    type: "number-choice",
    default: 300000,
  },
  {
    path: "checkpoint.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Checkpoint/Rewind",
    description:
      "Enable the checkpoint and rewind tools for context checkpointing",
    type: "boolean",
    default: false,
  },
  {
    path: "fetch.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Read URLs",
    description: "Allow the read tool to fetch and process URLs",
    type: "boolean",
    default: true,
  },
  {
    path: "vault.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Obsidian Vault",
    description:
      "Enable the vault:// internal URL for reading and editing Obsidian vault content via the Obsidian CLI. When disabled, vault:// resolution is refused and the vault:// entry is omitted from the system prompt.",
    type: "boolean",
    default: false,
  },
  {
    path: "github.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "GitHub CLI",
    description:
      "Enable the github tool (op-based dispatch for repository, issue, pull request, diff, search, checkout, push, and Actions watch workflows)",
    type: "boolean",
    default: false,
  },
  {
    path: "github.cache.enabled",
    tab: "tools",
    group: "GitHub",
    label: "GitHub View Cache",
    description:
      "Cache rendered issue/PR view output in ~/.omp/cache/github-cache.db so repeated reads are free",
    type: "boolean",
    default: true,
  },
  {
    path: "web_search.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Web Search",
    description: "Enable the web_search tool for live web results",
    type: "boolean",
    default: true,
  },
  {
    path: "security.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Security",
    description:
      "Enable OMP-native security scan planning, execution, and the read-only security:// resource namespace",
    type: "boolean",
    default: false,
  },
  {
    path: "ask.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Ask",
    description: "Enable the ask tool for interactive user questions",
    type: "boolean",
    default: true,
  },
  {
    path: "browser.enabled",
    tab: "tools",
    group: "Available Tools",
    label: "Browser",
    description:
      "Enable the browser tool for scripted Chromium automation (puppeteer)",
    type: "boolean",
    default: true,
  },
  {
    path: "browser.relay",
    tab: "tools",
    group: "Grep & Browser",
    label: "Browser Relay",
    description:
      "Drive your own Chrome tabs through the omp browser relay. Install the extension once (`omp browser-relay install`); the relay server auto-starts when the browser tool needs it. Takes precedence over Browser CDP URL; set PI_BROWSER_RELAY=0 or PI_BROWSER_RELAY=1 to override.",
    type: "boolean",
    default: false,
  },
  {
    path: "browser.headless",
    tab: "tools",
    group: "Grep & Browser",
    label: "Headless Browser",
    description: "Launch browser in headless mode (disable to show browser UI)",
    type: "boolean",
    default: true,
  },
  {
    path: "browser.cmux",
    tab: "tools",
    group: "Grep & Browser",
    label: "cmux Browser",
    description:
      "Use cmux WKWebView surfaces for browser automation when a cmux socket is available. Set PI_BROWSER_CMUX=0 or PI_BROWSER_CMUX=1 to override.",
    type: "boolean",
    default: true,
  },
  {
    path: "tools.intentTracing",
    tab: "tools",
    group: "Execution",
    label: "Intent Tracing",
    description:
      "Ask the agent to describe the intent of each tool call before executing it",
    type: "boolean",
    default: true,
  },
  {
    path: "tools.abortOnFabricatedResult",
    tab: "tools",
    group: "Execution",
    label: "Abort On Fabricated Tool Result",
    description:
      "With in-band tool calls, stop the model immediately when it starts hallucinating a tool result mid-turn. Disable to let the model finish generating and discard the fabricated continuation instead.",
    type: "boolean",
    default: true,
  },
  {
    path: "tools.maxTimeout",
    tab: "tools",
    group: "Execution",
    label: "Max Tool Timeout",
    description:
      "Maximum timeout in seconds the agent can set for any tool (0 = no limit)",
    options: [
      { value: "0", label: "No limit" },
      { value: "30", label: "30 seconds" },
      { value: "60", label: "60 seconds" },
      { value: "120", label: "120 seconds" },
      { value: "300", label: "5 minutes" },
      { value: "600", label: "10 minutes" },
    ],
    type: "number-choice",
    default: 0,
  },
  {
    path: "async.enabled",
    tab: "tools",
    group: "Execution",
    label: "Async Execution",
    description: "Enable async bash commands and background task execution",
    type: "boolean",
    default: true,
  },
  {
    path: "async.pollWaitDuration",
    tab: "tools",
    group: "Execution",
    label: "Max Poll Time",
    description:
      "How long a `hub` wait watches background jobs before returning the current state. A fixed value waits that exact duration every time. `smart` adapts: it starts at 5s and lengthens with each back-to-back wait (up to 5m), then resets to 5s after about a minute without waiting.",
    options: [
      { value: "5s", label: "5 seconds" },
      { value: "10s", label: "10 seconds" },
      { value: "30s", label: "30 seconds" },
      { value: "1m", label: "1 minute" },
      { value: "5m", label: "5 minutes" },
      {
        value: "smart",
        label: "Smart",
        description: "Default — adaptive 5s→5m, resets when you stop polling",
      },
    ],
    type: "enum",
    values: ["5s", "10s", "30s", "1m", "5m", "smart"],
    default: "smart",
  },
  {
    path: "irc.timeoutMs",
    tab: "tools",
    group: "Execution",
    label: "IRC Timeout",
    description:
      "Default timeout for hub message waits (and send await:true) in milliseconds; 0 disables the timeout",
    options: [
      { value: "0", label: "Disabled" },
      { value: "30000", label: "30 seconds" },
      { value: "60000", label: "1 minute" },
      { value: "120000", label: "2 minutes" },
      { value: "300000", label: "5 minutes" },
    ],
    type: "number-choice",
    default: 120000,
  },
  {
    path: "tools.xdev",
    tab: "tools",
    group: "Discovery & MCP",
    label: "xd:// Tools",
    description:
      "Mount rarely-used (discoverable) tools under xd:// device URLs driven via read/write instead of shipping their schemas on every request. Sessions without a granted write tool skip mounting and expose every tool top-level. Disable to expose every enabled tool top-level.",
    type: "boolean",
    default: true,
  },
  {
    path: "tools.xdevDocs",
    tab: "tools",
    group: "Discovery & MCP",
    label: "xd:// Prompt Docs",
    description:
      "Choose which mounted-device docs and schemas are inlined in the system prompt. Built-ins keeps core tools inline while MCP and extension tools stay on-demand.",
    options: [
      {
        value: "inline",
        label: "All Devices",
        description: "Inline docs and schemas for every mounted device.",
      },
      {
        value: "builtins",
        label: "Built-ins Only",
        description:
          "Inline built-in docs; fetch MCP and extension docs on demand.",
      },
      {
        value: "catalog",
        label: "Catalog Only",
        description: "List every device; fetch all docs on demand.",
      },
    ],
    type: "enum",
    values: ["inline", "builtins", "catalog"],
    default: "builtins",
  },
  {
    path: "mcp.enableProjectConfig",
    tab: "tools",
    group: "Discovery & MCP",
    label: "MCP Project Config",
    description: "Load .mcp.json/mcp.json from project root",
    type: "boolean",
    default: true,
  },
  {
    path: "mcp.renderMarkdownResults",
    tab: "tools",
    group: "Discovery & MCP",
    label: "MCP Markdown Results",
    description:
      "Render non-JSON MCP text results as Markdown in the transcript",
    type: "boolean",
    default: true,
  },
  {
    path: "mcp.notifications",
    tab: "tools",
    group: "Discovery & MCP",
    label: "MCP Update Injection",
    description: "Inject MCP resource updates into the agent conversation",
    type: "boolean",
    default: false,
  },
  {
    path: "tasks.todoClearDelay",
    tab: "tools",
    group: "Todos",
    label: "Todo Auto-Clear Delay",
    description:
      "Delay before completed or abandoned todos are removed from the todo widget",
    options: [
      { value: "0", label: "Instant" },
      { value: "60", label: "1 minute", description: "Default" },
      { value: "300", label: "5 minutes" },
      { value: "900", label: "15 minutes" },
      { value: "1800", label: "30 minutes" },
      { value: "3600", label: "1 hour" },
      { value: "-1", label: "Never" },
    ],
    type: "number-choice",
    default: 60,
  },
  {
    path: "dev.autoqa",
    tab: "tools",
    group: "Developer",
    label: "Auto QA",
    description:
      "Automated tool issue reporting (xd://report_issue). On by default; the first report asks for consent, and denying it disables reporting until re-enabled explicitly",
    type: "boolean",
    default: true,
  },
  {
    path: "dev.autoqaPush.endpoint",
    tab: "tools",
    group: "Developer",
    label: "Auto QA Push Endpoint",
    description:
      "Full URL receiving Auto QA JSON reports (default https://qa.omp.sh/v1/grievances)",
    type: "text",
    default: "https://qa.omp.sh/v1/grievances",
  },
];
