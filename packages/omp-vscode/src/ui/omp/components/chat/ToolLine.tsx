"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Copy, Check, ExternalLink, FileText, Folder, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
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

/** True when the block should use the new inline renderer at all. */
export function isLineStyleTool(block: ToolCallContent): boolean {
  return isExploringTool(block) || isBashTool(block);
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

/** Parse `<path>:<line>` matches. Ripgrep default output. */
function parseGrepMatches(result: ToolResultMessage | undefined): Array<{
  path: string;
  line?: number;
  preview: string;
}> {
  const lines = resultLines(result);
  const out: Array<{ path: string; line?: number; preview: string }> = [];
  for (const raw of lines) {
    const match = raw.match(/^(?<path>[^\s:]+):(?<line>\d+):(?<rest>.*)$/);
    if (match?.groups) {
      out.push({
        path: match.groups.path,
        line: Number.parseInt(match.groups.line, 10),
        preview: match.groups.rest.trim(),
      });
      continue;
    }
    out.push({ path: raw, preview: "" });
  }
  return out;
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

  const row = (
    <div
      className={cn(
        "group flex min-w-0 items-center gap-1.5 text-[12px]",
        isError && "opacity-70"
      )}
      onMouseEnter={hover ? () => setOpen(true) : undefined}
      onMouseLeave={hover ? () => setOpen(false) : undefined}
      onFocus={hover ? () => setOpen(true) : undefined}
      onBlur={hover ? () => setOpen(false) : undefined}
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{row}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="w-[min(520px,90vw)] max-w-none p-0"
      >
        {hover}
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

function GrepLine({ block, result, duration, onOpenFile }: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onOpenFile?: (path: string) => void;
}) {
  const pattern = readGrepPattern(block);
  const scope = readGrepPath(block);
  const isError = result?.isError === true;
  const isPending = !result;
  const matches = useMemo(() => (result ? parseGrepMatches(result) : []), [result]);
  const uniqueFiles = useMemo(() => {
    const set = new Set<string>();
    for (const match of matches) set.add(match.path);
    return set.size;
  }, [matches]);

  const hint = matches.length > 0
    ? `${uniqueFiles} ${uniqueFiles === 1 ? "file" : "files"} · ${matches.length} ${matches.length === 1 ? "match" : "matches"}`
    : scope
      ? `in ${scope}`
      : "no matches";

  const hover = matches.length > 0 ? (
    <div className="p-3">
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-[var(--text-dim)]">
        <Search size={10} />
        <span className="truncate">{pattern || "(pattern)"}</span>
        {scope && <span className="text-[var(--text-dim)]">· in {scope}</span>}
      </div>
      <div className="max-h-72 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-1">
        {matches.slice(0, 100).map((match, index) => (
          <button
            key={`${match.path}-${match.line ?? index}-${index}`}
            type="button"
            onClick={() => onOpenFile?.(match.path)}
            className="block w-full min-w-0 rounded px-1.5 py-0.5 text-left hover:bg-[var(--bg-hover)]"
          >
            <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
              <span className="truncate">{match.path}</span>
              {match.line !== undefined && (
                <span className="shrink-0 text-[var(--text-dim)]">:{match.line}</span>
              )}
            </div>
            {match.preview && (
              <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-dim)]">
                {match.preview}
              </div>
            )}
          </button>
        ))}
        {matches.length > 100 && (
          <div className="px-1.5 py-1 font-mono text-[10px] text-[var(--text-dim)]">
            +{matches.length - 100} more…
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
  const files = useMemo(() => resultLines(result), [result]);
  const isError = result?.isError === true;
  const isPending = !result;

  const hover = files.length > 0 ? (
    <div className="p-3">
      <div className="mb-1 font-mono text-[10px] text-[var(--text-dim)]">
        {files.length} {files.length === 1 ? "file" : "files"}
      </div>
      <div className="max-h-72 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-subtle)] p-1">
        {files.slice(0, 200).map((file, index) => (
          <button
            key={`${file}-${index}`}
            type="button"
            onClick={() => onOpenFile?.(file)}
            className="block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {file}
          </button>
        ))}
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

/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

export function ToolLine({
  block,
  result,
  duration,
  onOpenFile,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onOpenFile?: (path: string) => void;
}) {
  const name = (block.toolName || "").toLowerCase();
  if (name === "read" || block.toolKind === "read") {
    return <ReadLine block={block} result={result} duration={duration} onOpenFile={onOpenFile} />;
  }
  if (name === "grep" || name === "grepped") {
    return <GrepLine block={block} result={result} duration={duration} onOpenFile={onOpenFile} />;
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
  // Search kind without a known name: reuse grep line as a reasonable default.
  if (block.toolKind === "search") {
    return <GrepLine block={block} result={result} duration={duration} onOpenFile={onOpenFile} />;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Explorer group                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Collapsible group for 3+ consecutive exploring tool calls. Live while any
 * child is still running (auto-expanded), auto-collapses when the run ends.
 */
export function ExploringGroup({
  blocks,
  toolResults,
  toolCallDurations,
  onOpenFile,
}: {
  blocks: ToolCallContent[];
  toolResults?: Map<string, ToolResultMessage>;
  toolCallDurations?: Map<string, number>;
  onOpenFile?: (path: string) => void;
}) {
  const live = blocks.some((block) => {
    const result = toolResults?.get(block.toolCallId);
    return !result;
  });
  const failed = blocks.reduce((count, block) => {
    const result = toolResults?.get(block.toolCallId);
    return count + (result?.isError ? 1 : 0);
  }, 0);
  const [expanded, setExpanded] = useState(live);
  // Auto-collapse once the whole group settles.
  useMemo(() => {
    if (!live) setExpanded(false);
  }, [live]);

  const summaryParts: string[] = [];
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
          {live ? "Exploring" : "Explored"}
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
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
