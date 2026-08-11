// Ported verbatim from reference/oh-my-pi/packages/coding-agent/src/config/model-roles.ts:22-66.
// Keep this list in sync with omp; it is the source of truth for the Workbench Model
// Roles panel and any UI that enumerates configurable roles.

export type ModelRole =
  | "default"
  | "smol"
  | "slow"
  | "vision"
  | "plan"
  | "designer"
  | "commit"
  | "tiny"
  | "task"
  | "advisor";

export interface ModelRoleInfo {
  tag?: string;
  name: string;
  color?: string;
  hidden?: boolean;
}

export const MODEL_ROLES: Record<ModelRole, ModelRoleInfo> = {
  default: { tag: "DEFAULT", name: "Default", color: "success" },
  smol: { tag: "SMOL", name: "Fast", color: "warning" },
  slow: { tag: "SLOW", name: "Thinking", color: "accent" },
  vision: { tag: "VISION", name: "Vision", color: "error" },
  plan: { tag: "PLAN", name: "Architect", color: "muted" },
  designer: { tag: "DESIGNER", name: "Designer", color: "muted" },
  commit: { tag: "COMMIT", name: "Commit", color: "dim" },
  tiny: { tag: "TINY", name: "Tiny", color: "dim" },
  task: { tag: "TASK", name: "Subtask", color: "muted" },
  advisor: { tag: "ADVISOR", name: "Advisor", color: "accent" },
};

export const MODEL_ROLE_IDS: readonly ModelRole[] = [
  "default",
  "smol",
  "slow",
  "vision",
  "plan",
  "designer",
  "commit",
  "tiny",
  "task",
  "advisor",
];

export const THINKING_LEVELS: readonly { value: string; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
  { value: "auto", label: "Auto" },
];
