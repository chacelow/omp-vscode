/**
 * Edit / write / multi-edit tool → list of `<CodeDiff>` prop shapes,
 * one entry per hunk. The caller stacks N cards.
 *
 * Pure function: no React, no bridge, no I/O. Unit-tested in
 * `adapters.test.ts`.
 *
 * Sources of diff text, in preference order:
 *   1. `result.details.patch` — unified patch produced by the engine.
 *   2. `result.details.diff` — same, older alias.
 *   3. Synthesized from `block.input.{old_string, new_string}` (edit)
 *      or `block.input.content` (write / create), or the `edits` array
 *      (multi_edit).
 * The synth path is used pre-result (streaming) and as a fallback when
 * the engine did not include a patch. When neither is available the
 * adapter returns an empty array — the caller falls back to a line summary.
 */

import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { parseUnifiedPatch } from "@/lib/patch";

export type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export interface DiffCard {
  /** Absolute or repo-relative path of the changed file. Empty string only
   *  when the caller wants to hide upstream's header (rendering its own). */
  filename: string;
  additions: number;
  deletions: number;
  lines: readonly DiffLine[];
}

export interface DiffOptions {
  /** Session cwd, used only to strip repeated prefixes from patch paths;
   *  the adapter never resolves paths against it. */
  cwd?: string;
}

function readString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === "string" ? v : "";
}

function readPath(block: ToolCallContent): string {
  return (
    readString(block.input, "path") ||
    readString(block.input, "file") ||
    readString(block.input, "filename") ||
    ""
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractPatchText(result: ToolResultMessage | undefined): string | null {
  if (!result) return null;
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;
  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return patch;
  const diff = typeof details.diff === "string" ? details.diff : null;
  return diff;
}

/** Turn plain text into all-added or all-removed diff lines. */
function textToDiffLines(text: string, kind: DiffKind): DiffLine[] {
  if (!text) return [];
  const raw = text.split(/\r?\n/);
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  return raw.map((line) => ({ kind, text: line }));
}

function countKind(lines: readonly DiffLine[], kind: DiffKind): number {
  let n = 0;
  for (const l of lines) if (l.kind === kind) n++;
  return n;
}

/**
 * Break a parsed patch file into one `DiffCard` per @@ hunk. The parsed
 * file rows come from `parseUnifiedPatch`, which is split-diff shaped —
 * we flatten each hunk back to a unified `DiffLine[]` before returning.
 *
 * Multi-hunk output is deliberately one card per hunk, not one card
 * concatenated with hunk separators; visually those separators clash
 * with `<CodeDiff>`'s own header/gutter.
 */
function cardsFromPatchText(patchText: string): DiffCard[] {
  const files = parseUnifiedPatch(patchText);
  if (!files) return [];
  const cards: DiffCard[] = [];
  for (const file of files) {
    const filename = file.newPath || file.oldPath || "";
    let hunk: DiffLine[] = [];
    const flush = () => {
      if (hunk.length === 0) return;
      cards.push({
        filename,
        additions: countKind(hunk, "added"),
        deletions: countKind(hunk, "removed"),
        lines: hunk,
      });
      hunk = [];
    };
    for (const row of file.rows) {
      if (row.type === "hunk") {
        // "\ No newline at end of file" markers are treated as hunk markers
        // by parseUnifiedPatch; treat as a fence too.
        flush();
        continue;
      }
      const { left, right } = row;
      // Context row (both sides carry the same context text).
      if (left.type === "context" && right.type === "context") {
        hunk.push({ kind: "context", text: left.text });
        continue;
      }
      // Emit removed then added so the unified order matches the patch.
      if (left.type === "removed") hunk.push({ kind: "removed", text: left.text });
      if (right.type === "added") hunk.push({ kind: "added", text: right.text });
    }
    flush();
  }
  return cards;
}

function synthesizeEditCard(
  filename: string,
  oldStr: string,
  newStr: string
): DiffCard {
  const removed = textToDiffLines(oldStr, "removed");
  const added = textToDiffLines(newStr, "added");
  const lines: DiffLine[] = [...removed, ...added];
  return {
    filename,
    additions: added.length,
    deletions: removed.length,
    lines,
  };
}

function synthesizeWriteCard(filename: string, content: string): DiffCard {
  const added = textToDiffLines(content, "added");
  return { filename, additions: added.length, deletions: 0, lines: added };
}

export function toDiffLinesList(
  block: ToolCallContent,
  result: ToolResultMessage | undefined,
  _options: DiffOptions = {}
): DiffCard[] {
  // 1) Prefer a real unified patch from the tool result — most accurate,
  //    includes context lines from the actual file content.
  const patchText = extractPatchText(result);
  if (patchText) {
    const cards = cardsFromPatchText(patchText);
    if (cards.length > 0) return cards;
  }

  const filename = readPath(block);
  const toolName = (block.toolName || "").toLowerCase();

  // 2) multi_edit: an array of {old_string, new_string} entries — one hunk
  //    per entry.
  const edits = block.input.edits;
  if (Array.isArray(edits) && edits.length > 0) {
    const cards: DiffCard[] = [];
    for (const e of edits) {
      if (!isRecord(e)) continue;
      const oldStr = typeof e.old_string === "string" ? e.old_string : "";
      const newStr = typeof e.new_string === "string" ? e.new_string : "";
      if (!oldStr && !newStr) continue;
      cards.push(synthesizeEditCard(filename, oldStr, newStr));
    }
    if (cards.length > 0) return cards;
  }

  // 3) Single edit: {old_string, new_string} on input.
  const oldStr = readString(block.input, "old_string");
  const newStr = readString(block.input, "new_string");
  if (oldStr || newStr) {
    return [synthesizeEditCard(filename, oldStr, newStr)];
  }

  // 4) Write / create: full new content.
  const content =
    readString(block.input, "content") ||
    readString(block.input, "text") ||
    readString(block.input, "body");
  if (content && (toolName === "write" || toolName === "create" || block.toolKind === "edit")) {
    return [synthesizeWriteCard(filename, content)];
  }

  return [];
}
