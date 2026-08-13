/**
 * Bash / shell tool → `<TerminalBlock>` prop shape.
 *
 * Pure function: `(block, result, options?) => TerminalStats`. No React, no
 * bridge, no I/O. Unit-tested in `adapters.test.ts`.
 *
 * Only `command`, `lines`, `visibleCount`, `done` are consumed by the
 * vendored component itself. `exitCode`, `cwd`, `isCancelled`, `isError` are
 * out-of-band metadata the enclosing wrapper (`parts/tools/BashToolPart.tsx`)
 * renders around the component — the vendored `<TerminalBlock>` hard-codes
 * "exit 0" and has no cwd/cancelled slot.
 */

import type { ToolCallContent, ToolResultMessage } from "@/lib/types";

export interface TerminalStats {
  command: string;
  /** Non-empty stdout/stderr lines, in order. */
  lines: readonly string[];
  /** Default caller-truncation window; the wrapper may raise this to
   *  `lines.length` on user "expand". Never larger than `lines.length`. */
  visibleCount: number;
  done: boolean;
  exitCode?: number;
  cwd?: string;
  isCancelled?: boolean;
  isError?: boolean;
}

export interface TerminalStatsOptions {
  /** Session working directory to fall back on when `block.input.cwd` is
   *  absent. Passed through verbatim; adapter never touches the filesystem. */
  cwd?: string;
  /** Wrapper-supplied default for `visibleCount` when many lines. */
  defaultVisibleCount?: number;
}

const DEFAULT_VISIBLE_COUNT = 50;

function readString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === "string" ? v : "";
}

function readCommand(block: ToolCallContent): string {
  return (
    readString(block.input, "command") ||
    readString(block.input, "cmd") ||
    readString(block.input, "script") ||
    ""
  );
}

function readCwd(block: ToolCallContent): string | undefined {
  const c = readString(block.input, "cwd") || readString(block.input, "workingDir");
  return c || undefined;
}

/**
 * Flatten a tool result to a single string, joining every `text` block.
 * Never touches `details`; those are the caller's responsibility (e.g.
 * `details.exitCode` on bash results below).
 */
function resultText(result: ToolResultMessage | undefined): string {
  if (!result) return "";
  const parts: string[] = [];
  for (const c of result.content) {
    if (c.type === "text") parts.push(c.text);
  }
  return parts.join("");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface BashDetails {
  exitCode?: number;
  cancelled?: boolean;
  cwd?: string;
  truncated?: boolean;
}

function readBashDetails(result: ToolResultMessage | undefined): BashDetails {
  if (!result) return {};
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return {};
  const inner = isRecord(details.rawOutput) ? details.rawOutput : details;
  const out: BashDetails = {};
  if (typeof inner.exitCode === "number") out.exitCode = inner.exitCode;
  else if (typeof inner.exit_code === "number") out.exitCode = inner.exit_code;
  if (typeof inner.cancelled === "boolean") out.cancelled = inner.cancelled;
  if (typeof inner.cwd === "string" && inner.cwd) out.cwd = inner.cwd;
  if (typeof inner.truncated === "boolean") out.truncated = inner.truncated;
  return out;
}

/** Split output into non-empty lines. Empty trailing lines from a trailing
 *  newline are dropped so the visible-count math is stable. */
export function splitOutputLines(text: string): string[] {
  if (!text) return [];
  const raw = text.split(/\r?\n/);
  // Drop only a single trailing empty line (from the final "\n").
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  return raw;
}

export function toTerminalStats(
  block: ToolCallContent,
  result: ToolResultMessage | undefined,
  options: TerminalStatsOptions = {}
): TerminalStats {
  const command = readCommand(block);
  const text = resultText(result);
  const lines = splitOutputLines(text);
  const details = readBashDetails(result);

  const done = result !== undefined;
  const isError = result?.isError === true;
  const isCancelled = details.cancelled === true;
  const exitCode = details.exitCode;
  const cwd = details.cwd || readCwd(block) || options.cwd || undefined;

  const defaultVisible = Math.max(
    1,
    Math.floor(options.defaultVisibleCount ?? DEFAULT_VISIBLE_COUNT)
  );
  const visibleCount = Math.min(lines.length, defaultVisible);

  const out: TerminalStats = { command, lines, visibleCount, done };
  if (exitCode !== undefined) out.exitCode = exitCode;
  if (cwd) out.cwd = cwd;
  if (isCancelled) out.isCancelled = true;
  if (isError) out.isError = true;
  return out;
}
