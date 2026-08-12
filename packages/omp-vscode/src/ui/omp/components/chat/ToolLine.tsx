"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight, Copy, Check, ExternalLink, FileText, Folder, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { resolveLocalFileHref } from "@/lib/file-links";
import type {
  TextContent,
  ToolCallContent,
  ToolCallKind,
  ToolResultMessage,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/** Tools that participate in the collapsible "Explored" group. */
const EXPLORING_KINDS: Record<ToolCallKind, true | undefined> = {
  read: true,
  search: true,
  fetch: true,
  edit: undefined,
  delete: undefined,
  move: undefined,
  execute: undefined,
  think: undefined,
  switch_mode: undefined,
  other: undefined,
};

/** Fallback name-based classification for messages without ACP `kind`. */
const EXPLORING_NAMES: Record<string, true> = {
  read: true,
  grep: true,
  grepped: true,
  glob: true,
  search: true,
  web_search: true,
  websearch: true,
  web_fetch: true,
  webfetch: true,
  fetch: true,
};

/** True when the block should render as an inline exploring line. */
export function isExploringTool(block: ToolCallContent): boolean {
  if (block.toolKind && EXPLORING_KINDS[block.toolKind]) return true;
  const name = (block.toolName || "").toLowerCase();
  return EXPLORING_NAMES[name] === true;
}

/** True when the block is a shell command; still line-style but not grouped. */
export function isBashTool(block: ToolCallContent): boolean {
  if (block.toolKind === "execute") return true;
  const name = (block.toolName || "").toLowerCase();
  return name === "bash" || name === "run" || name === "shell";
}

/** True when the block modifies files (edit / write / delete / move / create). */
export function isChangeTool(block: ToolCallContent): boolean {
  if (block.toolKind === "edit" || block.toolKind === "delete" || block.toolKind === "move") return true;
  const name = (block.toolName || "").toLowerCase();
  return (
    name === "edit" ||
    name.endsWith("_edit") ||
    name.endsWith(".edit") ||
    name.startsWith("edit_") ||
    name.includes("str_replace") ||
    name === "write" ||
    name === "create" ||
    name === "delete" ||
    name === "move" ||
    name === "rename"
  );
}

/** True when the block should render as an inline read-only "activity" line.
 *  Edit/write/delete/move + bash stay as expandable tool cards (Cursor style). */
export function isLineStyleTool(block: ToolCallContent): boolean {
  return isExploringTool(block);
}

/* -------------------------------------------------------------------------- */
/* Result helpers                                                             */
/* -------------------------------------------------------------------------- */

function getResultText(result: ToolResultMessage | undefined): string {
  if (!result) return "";
  return result.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function readStringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readInputPath(block: ToolCallContent): string {
  return readStringField(block.input, "path") || readStringField(block.input, "file_path");
}

function readGrepPattern(block: ToolCallContent): string {
  return readStringField(block.input, "pattern") || readStringField(block.input, "query");
}

/** Extract the structured file list from an omp glob tool result. Matches
 *  omp's GlobToolDetails.files (see reference glob.ts buildResult()). */
function readGlobFiles(details: unknown): string[] | null {
  if (!details || typeof details !== "object" || !("files" in details)) return null;
  const files = (details as { files: unknown }).files;
  if (!Array.isArray(files)) return null;
  return files.filter((file): file is string => typeof file === "string");
}

function readWebQuery(block: ToolCallContent): string {
  return readStringField(block.input, "query") || readStringField(block.input, "q");
}

function readFetchUrl(block: ToolCallContent): string {
  return readStringField(block.input, "url") || readStringField(block.input, "href");
}

function readBashCommand(block: ToolCallContent): string {
  const command = block.input.command;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) {
    const last = command[command.length - 1];
    return typeof last === "string" ? last : "";
  }
  return "";
}

function readBashIntent(block: ToolCallContent): string | undefined {
  const intent = block.input.i;
  return typeof intent === "string" && intent.trim() ? intent.trim() : undefined;
}

function readGrepPath(block: ToolCallContent): string {
  return readStringField(block.input, "path");
}

/** Split a plain result body into non-empty lines. */
function resultLines(result: ToolResultMessage | undefined): string[] {
  const text = getResultText(result);
  if (!text) return [];
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

interface FileMatchGroup {
  path: string;
  matches: number;
  firstLine?: number;
}

interface GrepResultSummary {
  fileGroups: FileMatchGroup[];
  fileCount: number;
  matchCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read grep's structured result. ACP rawOutput wraps tool details once. */
function grepResultSummary(result: ToolResultMessage | undefined): GrepResultSummary | null {
  if (!result || !isRecord(result.details)) return null;
  const rawDetails = result.details;
  const details = isRecord(rawDetails.details) ? rawDetails.details : rawDetails;
  const fileGroups: FileMatchGroup[] = [];
  const fileMatches = details.fileMatches;

  if (Array.isArray(fileMatches)) {
    for (const entry of fileMatches) {
      if (!isRecord(entry) || typeof entry.path !== "string") continue;
      fileGroups.push({
        path: entry.path,
        matches: typeof entry.count === "number" ? entry.count : 1,
        firstLine: typeof entry.line === "number" ? entry.line : undefined,
      });
    }
  } else if (Array.isArray(details.files)) {
    for (const path of details.files) {
      if (typeof path === "string") fileGroups.push({ path, matches: 1 });
    }
  } else {
    return null;
  }

  const groupedMatchCount = fileGroups.reduce((sum, group) => sum + group.matches, 0);
  return {
    fileGroups,
    fileCount: typeof details.fileCount === "number" ? details.fileCount : fileGroups.length,
    matchCount: typeof details.matchCount === "number" ? details.matchCount : groupedMatchCount,
  };
}

/** Split a POSIX path into `{ dir, base }`. Missing dir → empty string. */
function splitPath(path: string): { dir: string; base: string } {
  const clean = path.replace(/\/+$/, "");
  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash < 0) return { dir: "", base: clean };
  return { dir: clean.slice(0, lastSlash), base: clean.slice(lastSlash + 1) };
}


/* -------------------------------------------------------------------------- */
/* Base line primitive                                                        */
/* -------------------------------------------------------------------------- */

interface ToolLineBaseProps {
  verb: string;
  primary?: ReactNode;
  hint?: ReactNode;
  duration?: number;
  isError?: boolean;
  isPending?: boolean;
  hover?: ReactNode;
  onPrimaryClick?: () => void;
  primaryTitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}

function StatusDot({ isError, isPending }: { isError?: boolean; isPending?: boolean }) {
  if (isPending) {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]"
      />
    );
  }
  if (isError) {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--destructive)]"
      />
    );
  }
  return null;
}

/**
 * Renders one tool call as a single flowing text row: bold past-tense verb,
 * optional primary (path/query/command), a lighter hint and an optional hover
 * popover with expanded detail. No card, no border, no expand toggle — this is
 * the Cursor-style "activity line" used for explorer + shell tools.
 */
function ToolLineBase({
  verb,
  primary,
  hint,
  duration,
  isError,
  isPending,
  hover,
  onPrimaryClick,
  primaryTitle,
  actions,
  icon,
}: ToolLineBaseProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const cancelOpen = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelOpen();
    cancelClose();
    if (!hover) return;
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  /** Hovering the row starts a short delay before opening; a second entry
   *  while the popover is already open keeps it open with no flicker. */
  const scheduleOpen = () => {
    cancelClose();
    if (!hover || open) return;
    if (openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, 250);
  };
  /** Used by the popover content itself: definitively keep it open. */
  const keepOpen = () => {
    cancelOpen();
    cancelClose();
  };

  const primaryNode = onPrimaryClick ? (
    <button
      type="button"
      onClick={onPrimaryClick}
      title={primaryTitle}
      className={cn(
        "min-w-0 truncate border-none bg-transparent p-0 text-left font-mono text-[11px] underline-offset-2 cursor-pointer",
        isError ? "text-[var(--text-dim)]" : "text-[var(--text-muted)]",
        "hover:text-[var(--text)] hover:underline"
      )}
    >
      {primary}
    </button>
  ) : (
    <span
      className={cn(
        "min-w-0 truncate font-mono text-[11px]",
        isError ? "text-[var(--text-dim)]" : "text-[var(--text-muted)]"
      )}
      title={primaryTitle}
    >
      {primary}
    </span>
  );

  // The row spans the full width of the message column so that the hover hit
  // area covers the whole line regardless of content length.
  const row = (
    <div
      className={cn(
        "group flex w-full min-w-0 items-center gap-1.5 py-0.5 text-[12px]",
        isError && "opacity-70"
      )}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={scheduleClose}
    >
      <StatusDot isError={isError} isPending={isPending} />
      {icon}
      <span
        className={cn(
          "shrink-0 font-mono text-[11px] font-semibold",
          isError ? "text-[var(--text-dim)]" : "text-[var(--text)]"
        )}
      >
        {verb}
      </span>
      {primary && primaryNode}
      {hint && (
        <span className="shrink-0 truncate font-mono text-[10px] text-[var(--text-dim)]">
          {hint}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {actions}
        {duration !== undefined && (
          <span className="font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
            {duration}s
          </span>
        )}
      </span>
    </div>
  );

  if (!hover) return row;

  // sideOffset={0} + inner margin makes the visual gap while keeping the hit
  // area continuous: the transparent PopoverContent extends right up to the
  // row, so moving the pointer down never crosses dead space.
  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : scheduleClose())}>
      <PopoverTrigger asChild>{row}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={0}
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        className="w-[min(520px,90vw)] max-w-none border-none bg-transparent p-0 shadow-none"
      >
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="mt-1.5 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text)] shadow-md"
        >
          {hover}
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-tool renderers                                                         */
/* -------------------------------------------------------------------------- */

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function ReadLine({ block, result, duration, onOpenFile }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onOpenFile?: (path: string) => void;
}) {
  const path = readInputPath(block);
  const isError = result?.isError === true;
  const isPending = !result;
  const name = basename(path) || "(no path)";
  const isDirectory = name.endsWith("/") || path.endsWith("/");
  const entries = useMemo(() => (isDirectory ? resultLines(result) : []), [isDirectory, result]);

  const hover = path ? (
    <div className="p-3">
      <div className="mb-1 font-mono text-[10px] text-[var(--text-dim)]">Full path</div>
      <div className="mb-2 break-all font-mono text-[11px] text-[var(--text-muted)]">{path}</div>
      {isDirectory && entries.length > 0 && (
        <>
          <div className="mb-1 font-mono text-[10px] text-[var(--text-dim)]">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </div>
          <div className="max-h-64 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-1">
            {entries.map((entry, index) => (
              <button
                key={`${entry}-${index}`}
                type="button"
                onClick={() => onOpenFile?.(entry.startsWith("/") ? entry : `${path.replace(/\/$/, "")}/${entry}`)}
                className="block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              >
                {entry}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  ) : null;

  return (
    <ToolLineBase
      verb={isDirectory ? "Listed" : "Read"}
      icon={isDirectory ? <Folder size={11} className="shrink-0 text-[var(--text-dim)]" /> : <FileText size={11} className="shrink-0 text-[var(--text-dim)]" />}
      primary={name}
      primaryTitle={path}
      onPrimaryClick={path && !isDirectory ? () => onOpenFile?.(path) : undefined}
      duration={duration}
      isError={isError}
      isPending={isPending}
      hover={hover}
    />
  );
}

function GrepLine({ block, result, duration, cwd, onOpenFile }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}) {
  const pattern = readGrepPattern(block);
  const scope = readGrepPath(block);
  const isError = result?.isError === true;
  const isPending = !result;
  const summary = useMemo(() => grepResultSummary(result), [result]);
  const fileGroups = summary?.fileGroups ?? [];
  const totalMatches = summary?.matchCount ?? 0;
  const totalFiles = summary?.fileCount ?? 0;

  const hint = summary
    ? `${totalFiles} ${totalFiles === 1 ? "file" : "files"} · ${totalMatches} ${totalMatches === 1 ? "match" : "matches"}`
    : scope
      ? `in ${scope}`
      : "no matches";

  const hover = fileGroups.length > 0 ? (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-[var(--text-dim)]">
        <Search size={10} />
        <span className="truncate">{pattern || "(pattern)"}</span>
        {scope && <span className="text-[var(--text-dim)]">· in {scope}</span>}
      </div>
      <div className="max-h-72 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-1">
        {fileGroups.slice(0, 100).map((entry) => {
          const { dir, base } = splitPath(entry.path);
          const resolvedPath = resolveLocalFileHref(entry.path, cwd);
          const openPath = resolvedPath
            ? (entry.firstLine ? `${resolvedPath}:${entry.firstLine}` : resolvedPath)
            : null;
          return (
            <button
              key={entry.path}
              type="button"
              disabled={!openPath}
              onClick={() => openPath && onOpenFile?.(openPath)}
              className="flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-[var(--bg-hover)] disabled:cursor-default"
            >
              <FileText size={11} className="shrink-0 text-[var(--text-dim)]" />
              <span className="shrink-0 truncate font-mono text-[11px] text-[var(--text-muted)]">
                {base}
              </span>
              {dir && (
                <span className="min-w-0 truncate font-mono text-[10px] text-[var(--text-dim)]">
                  {dir}
                </span>
              )}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--text-dim)] tabular-nums">
                {entry.matches} {entry.matches === 1 ? "match" : "matches"}
              </span>
            </button>
          );
        })}
        {fileGroups.length > 100 && (
          <div className="px-1.5 py-1 font-mono text-[10px] text-[var(--text-dim)]">
            +{fileGroups.length - 100} more files…
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <ToolLineBase
      verb="Grepped"
      icon={<Search size={11} className="shrink-0 text-[var(--text-dim)]" />}
      primary={pattern || "(pattern)"}
      primaryTitle={pattern}
      hint={hint}
      duration={duration}
      isError={isError}
      isPending={isPending}
      hover={hover}
    />
  );
}

function GlobLine({ block, result, duration, onOpenFile }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onOpenFile?: (path: string) => void;
}) {
  const pattern = readGrepPattern(block) || readInputPath(block);
  // omp's glob tool ships two payloads:
  //   • text() — a human-readable markdown tree (`# dir / ## sub / file`)
  //     built by `formatGroupedPaths` — meant for the model to read.
  //   • details.files — the CANONICAL string[] of matched paths.
  // Read the structured field directly; splitting the markdown on
  // newlines treated `# .agents` and `## zoey-project` as filenames
  // and produced a 150-line grid of headings that weren't files.
  const files = useMemo(() => {
    const detailFiles = readGlobFiles(result?.details);
    if (detailFiles) return detailFiles;
    // Legacy sessions may not carry `details` (older JSONL). Fall back
    // to newline-splitting only when there's genuinely no structure.
    return resultLines(result);
  }, [result]);
  const isError = result?.isError === true;
  const isPending = !result;

  const hover = files.length > 0 ? (
    <div className="p-3">
      <div className="mb-1 font-mono text-[10px] text-[var(--text-dim)]">
        {files.length} {files.length === 1 ? "file" : "files"}
      </div>
      <div className="max-h-72 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-1">
        {files.slice(0, 200).map((file, index) => {
          const { dir, base } = splitPath(file);
          return (
            <button
              key={`${file}-${index}`}
              type="button"
              onClick={() => onOpenFile?.(file)}
              className="flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-[var(--bg-hover)]"
            >
              <FileText size={11} className="shrink-0 text-[var(--text-dim)]" />
              <span className="shrink-0 truncate font-mono text-[11px] text-[var(--text-muted)]">
                {base}
              </span>
              {dir && (
                <span className="min-w-0 truncate font-mono text-[10px] text-[var(--text-dim)]">
                  {dir}
                </span>
              )}
            </button>
          );
        })}
        {files.length > 200 && (
          <div className="px-1.5 py-1 font-mono text-[10px] text-[var(--text-dim)]">
            +{files.length - 200} more…
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <ToolLineBase
      verb="Globbed"
      icon={<Search size={11} className="shrink-0 text-[var(--text-dim)]" />}
      primary={pattern || "(pattern)"}
      primaryTitle={pattern}
      hint={files.length > 0 ? `${files.length} ${files.length === 1 ? "file" : "files"}` : "no matches"}
      duration={duration}
      isError={isError}
      isPending={isPending}
      hover={hover}
    />
  );
}

function FetchLine({ block, result, duration }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
}) {
  const url = readFetchUrl(block);
  const isError = result?.isError === true;
  const isPending = !result;
  let host = url;
  try {
    if (url) host = new URL(url).host;
  } catch {
    // keep raw url as fallback
  }

  const text = getResultText(result);
  const hover = url ? (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-1 font-mono text-[10px] text-[var(--text-dim)]">
        <ExternalLink size={10} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate break-all text-[var(--accent)] hover:underline"
        >
          {url}
        </a>
      </div>
      {text && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-2 font-mono text-[10px] text-[var(--text-muted)]">
          {text.length > 4000 ? `${text.slice(0, 4000)}\n\n…truncated` : text}
        </pre>
      )}
    </div>
  ) : null;

  return (
    <ToolLineBase
      verb="Fetched"
      icon={<ExternalLink size={11} className="shrink-0 text-[var(--text-dim)]" />}
      primary={host || "(url)"}
      primaryTitle={url}
      duration={duration}
      isError={isError}
      isPending={isPending}
      hover={hover}
    />
  );
}

function WebSearchLine({ block, result, duration }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
}) {
  const query = readWebQuery(block);
  const isError = result?.isError === true;
  const isPending = !result;

  const entries = useMemo(() => {
    const text = getResultText(result);
    if (!text) return [] as Array<{ title: string; url: string; snippet?: string }>;
    // Match Markdown-style bullets first: "- [Title](https://...) snippet"
    const items: Array<{ title: string; url: string; snippet?: string }> = [];
    const markdown = text.matchAll(/^[-*]\s*\[(?<title>[^\]]+)\]\((?<url>https?:\/\/[^)\s]+)\)\s*(?<snippet>.*)$/gm);
    for (const match of markdown) {
      if (match.groups) items.push({ title: match.groups.title, url: match.groups.url, snippet: match.groups.snippet.trim() || undefined });
    }
    if (items.length > 0) return items;
    // Fall back to bare URLs.
    for (const match of text.matchAll(/https?:\/\/[^\s)]+/g)) {
      items.push({ title: match[0], url: match[0] });
    }
    return items;
  }, [result]);

  const hover = entries.length > 0 ? (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-1 font-mono text-[10px] text-[var(--text-dim)]">
        <Search size={10} />
        <span className="truncate">{query || "(query)"}</span>
      </div>
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {entries.slice(0, 50).map((entry, index) => (
          <a
            key={`${entry.url}-${index}`}
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-1.5 hover:border-[var(--accent)]"
          >
            <div className="flex items-center gap-1 truncate text-[11px] text-[var(--text)]">
              <ExternalLink size={10} className="shrink-0 text-[var(--text-dim)]" />
              <span className="truncate">{entry.title || entry.url}</span>
            </div>
            <div className="truncate font-mono text-[10px] text-[var(--text-dim)]">{entry.url}</div>
            {entry.snippet && (
              <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--text-muted)]">{entry.snippet}</div>
            )}
          </a>
        ))}
        {entries.length > 50 && (
          <div className="px-1.5 py-1 font-mono text-[10px] text-[var(--text-dim)]">
            +{entries.length - 50} more…
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <ToolLineBase
      verb="Searched web"
      icon={<Search size={11} className="shrink-0 text-[var(--text-dim)]" />}
      primary={query || "(query)"}
      primaryTitle={query}
      hint={entries.length > 0 ? `${entries.length} ${entries.length === 1 ? "result" : "results"}` : undefined}
      duration={duration}
      isError={isError}
      isPending={isPending}
      hover={hover}
    />
  );
}

function BashLine({ block, result, duration }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
}) {
  const command = readBashCommand(block);
  const intent = readBashIntent(block);
  const isError = result?.isError === true;
  const isPending = !result;
  const text = getResultText(result);
  const [copied, setCopied] = useState(false);

  const primary = intent || command;
  const primaryTitle = command;

  const hover = command ? (
    <div className="p-3">
      <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] text-[var(--text-dim)]">
        <span>Command</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void copyText(command).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          {copied ? <Check size={10} className="text-[var(--success)]" /> : <Copy size={10} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mb-2 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-2 font-mono text-[10px] text-[var(--text-muted)]">
        {command}
      </pre>
      {text && (
        <>
          <div className="mb-1 font-mono text-[10px] text-[var(--text-dim)]">Output</div>
          <pre className="max-h-64 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-2 font-mono text-[10px] text-[var(--text-muted)]">
            {text.length > 6000 ? `${text.slice(0, 6000)}\n\n…truncated` : text}
          </pre>
        </>
      )}
    </div>
  ) : null;

  return (
    <ToolLineBase
      verb="Ran"
      primary={primary || "(command)"}
      primaryTitle={primaryTitle}
      duration={duration}
      isError={isError}
      isPending={isPending}
      hover={hover}
    />
  );
}


/** Verb chosen from tool kind/name. Falls back to a generic "Changed". */
function changeVerb(block: ToolCallContent): string {
  if (block.toolKind === "delete") return "Deleted";
  if (block.toolKind === "move") return "Moved";
  const name = (block.toolName || "").toLowerCase();
  if (name === "delete") return "Deleted";
  if (name === "move" || name === "rename") return "Moved";
  if (name === "write" || name === "create") return "Wrote";
  return "Edited";
}

function readMovePaths(block: ToolCallContent): { from: string; to: string } | null {
  const from = readStringField(block.input, "from") || readStringField(block.input, "source") || readStringField(block.input, "src");
  const to = readStringField(block.input, "to") || readStringField(block.input, "destination") || readStringField(block.input, "dest");
  if (!from || !to) return null;
  return { from, to };
}

function ChangeLine({ block, result, duration, onOpenFile }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onOpenFile?: (path: string) => void;
}) {
  const isError = result?.isError === true;
  const isPending = !result;
  const verb = changeVerb(block);

  // Move/rename: show `from → to` inline.
  if (verb === "Moved") {
    const paths = readMovePaths(block);
    const primary = paths ? `${basename(paths.from)} → ${basename(paths.to)}` : readInputPath(block);
    const hover = paths ? (
      <div className="p-3 font-mono text-[10px] text-[var(--text-muted)]">
        <div className="mb-1 text-[var(--text-dim)]">From</div>
        <div className="mb-2 break-all">{paths.from}</div>
        <div className="mb-1 text-[var(--text-dim)]">To</div>
        <div className="break-all">{paths.to}</div>
      </div>
    ) : null;
    return (
      <ToolLineBase
        verb="Moved"
        icon={<FileText size={11} className="shrink-0 text-[var(--text-dim)]" />}
        primary={primary || "(path)"}
        primaryTitle={paths ? `${paths.from} → ${paths.to}` : primary}
        onPrimaryClick={paths ? () => onOpenFile?.(paths.to) : undefined}
        duration={duration}
        isError={isError}
        isPending={isPending}
        hover={hover}
      />
    );
  }

  const path = readInputPath(block);
  const base = path ? basename(path) : "(path)";
  const hover = path ? (
    <div className="p-3">
      <div className="mb-1 font-mono text-[10px] text-[var(--text-dim)]">Full path</div>
      <div className="break-all font-mono text-[11px] text-[var(--text-muted)]">{path}</div>
    </div>
  ) : null;
  return (
    <ToolLineBase
      verb={verb}
      icon={<FileText size={11} className="shrink-0 text-[var(--text-dim)]" />}
      primary={base}
      primaryTitle={path}
      onPrimaryClick={path ? () => onOpenFile?.(path) : undefined}
      duration={duration}
      isError={isError}
      isPending={isPending}
      hover={hover}
    />
  );
}
/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

export function ToolLine({
  block,
  result,
  duration,
  cwd,
  onOpenFile,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}) {
  const name = (block.toolName || "").toLowerCase();
  if (name === "read" || block.toolKind === "read") {
    return <ReadLine block={block} result={result} duration={duration} onOpenFile={onOpenFile} />;
  }
  if (name === "grep" || name === "grepped") {
    return <GrepLine block={block} result={result} duration={duration} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (name === "glob") {
    return <GlobLine block={block} result={result} duration={duration} onOpenFile={onOpenFile} />;
  }
  if (name === "web_search" || name === "websearch") {
    return <WebSearchLine block={block} result={result} duration={duration} />;
  }
  if (name === "fetch" || name === "web_fetch" || name === "webfetch" || block.toolKind === "fetch") {
    return <FetchLine block={block} result={result} duration={duration} />;
  }
  if (isBashTool(block)) {
    return <BashLine block={block} result={result} duration={duration} />;
  }
  if (isChangeTool(block)) {
    return <ChangeLine block={block} result={result} duration={duration} onOpenFile={onOpenFile} />;
  }
  // Search kind without a known name: reuse grep line as a reasonable default.
  if (block.toolKind === "search") {
    return <GrepLine block={block} result={result} duration={duration} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Explorer group                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Collapsible group for 2+ consecutive tool calls sharing a bucket. Live while
 * any child is running (auto-expanded), auto-collapses when the run ends.
 *
 * `variant`:
 * - "exploring" — read / grep / glob / fetch / web_search
 * - "bash"      — shell commands
 */
export function ExploringGroup({
  blocks,
  toolResults,
  toolCallDurations,
  cwd,
  onOpenFile,
  variant = "exploring",
}: {
  blocks: ToolCallContent[];
  toolResults?: Map<string, ToolResultMessage>;
  toolCallDurations?: Map<string, number>;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  variant?: "exploring" | "bash" | "changes";
}) {
  const live = blocks.some((block) => !toolResults?.get(block.toolCallId));
  const failed = blocks.reduce((count, block) => {
    const result = toolResults?.get(block.toolCallId);
    return count + (result?.isError ? 1 : 0);
  }, 0);
  const [expanded, setExpanded] = useState(live);
  useMemo(() => {
    if (!live) setExpanded(false);
  }, [live]);

  let label: string;
  const summaryParts: string[] = [];
  if (variant === "bash") {
    label = live ? "Running" : "Ran";
    summaryParts.push(`${blocks.length} ${blocks.length === 1 ? "command" : "commands"}`);
  } else if (variant === "changes") {
    const edits = blocks.filter((block) => changeVerb(block) === "Edited" || changeVerb(block) === "Wrote").length;
    const deletes = blocks.filter((block) => changeVerb(block) === "Deleted").length;
    const moves = blocks.filter((block) => changeVerb(block) === "Moved").length;
    // Choose the dominant verb for the header label; "Changed" acts as the
    // umbrella when several kinds are mixed.
    if (deletes > 0 && edits === 0 && moves === 0) label = live ? "Deleting" : "Deleted";
    else if (moves > 0 && edits === 0 && deletes === 0) label = live ? "Moving" : "Moved";
    else if (edits > 0 && deletes === 0 && moves === 0) label = live ? "Editing" : "Edited";
    else label = live ? "Changing" : "Changed";
    if (edits > 0) summaryParts.push(`${edits} ${edits === 1 ? "file" : "files"}`);
    if (deletes > 0) summaryParts.push(`${deletes} ${deletes === 1 ? "deleted" : "deletions"}`);
    if (moves > 0) summaryParts.push(`${moves} ${moves === 1 ? "move" : "moves"}`);
  } else {
    label = live ? "Exploring" : "Explored";
    const searches = blocks.filter((block) => {
      const name = (block.toolName || "").toLowerCase();
      return name === "grep" || name === "glob" || name === "web_search" || name === "websearch" || block.toolKind === "search";
    }).length;
    const reads = blocks.filter((block) => (block.toolName || "").toLowerCase() === "read" || block.toolKind === "read").length;
    const fetches = blocks.filter((block) => {
      const name = (block.toolName || "").toLowerCase();
      return name === "fetch" || name === "web_fetch" || name === "webfetch" || block.toolKind === "fetch";
    }).length;
    if (searches > 0) summaryParts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
    if (reads > 0) summaryParts.push(`${reads} ${reads === 1 ? "file" : "files"}`);
    if (fetches > 0) summaryParts.push(`${fetches} ${fetches === 1 ? "fetch" : "fetches"}`);
  }
  if (failed > 0) summaryParts.push(`${failed} failed`);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 border-none bg-transparent p-0 text-left text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-[var(--text-dim)]" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-[var(--text-dim)]" />
        )}
        <span className="font-mono text-[11px] font-semibold text-[var(--text)]">
          {label}
        </span>
        <span className="truncate font-mono text-[10px] text-[var(--text-dim)]">
          {summaryParts.join(" · ")}
        </span>
      </button>
      {expanded && (
        <div className="mt-0.5 flex flex-col gap-0.5 pl-[18px]">
          {blocks.map((block) => (
            <ToolLine
              key={block.toolCallId}
              block={block}
              result={toolResults?.get(block.toolCallId)}
              duration={toolCallDurations?.get(block.toolCallId)}
              cwd={cwd}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
