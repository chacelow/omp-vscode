"use client";

import { FileText } from "lucide-react";
import { CodeDiff } from "@/components/ai/code-diff";
import { toDiffLinesList, type DiffCard } from "@/domain/diff";
import type { ToolPartProps } from "../types";
import { cn } from "@/lib/utils";

function basename(path: string): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * File-change tool renderer (edit / write / create / multi_edit), backed by
 * the vendored `<CodeDiff>` component.
 *
 * Two upstream-shaped facts drive the layout here:
 *
 *   1. `<CodeDiff>` takes a flat unified list. Multi-hunk output stacks N
 *      cards, one per hunk — the adapter enforces that split. Concatenating
 *      hunks into a single card with visual separators looks worse than a
 *      short vertical stack; see the ticket-3 addendum.
 *   2. `<CodeDiff>` has no `onFileClick`. We render our own clickable
 *      filename header **above** each card and pass `filename=""` down so
 *      upstream's internal header is a no-op — no visible duplication.
 *
 * Nothing here talks to the bridge; `onOpenFile` is passed by the assistant
 * frame and comes from the existing `openInVSCode` seam.
 */
export function DiffToolPart({
  block,
  result,
  cwd,
  onOpenFile,
}: ToolPartProps) {
  const cards = toDiffLinesList(block, result, { cwd });

  // No hunk to draw — degrade gracefully. Historic sessions may lack a patch
  // and have no synthesizable input (rare); keep the row informative.
  if (cards.length === 0) {
    const path =
      (typeof block.input.path === "string" && block.input.path) || "";
    return (
      <FileHeader path={path} onOpenFile={onOpenFile} noDiff />
    );
  }

  return (
    <div className="my-1 flex w-full max-w-md flex-col gap-2">
      {cards.map((card, i) => (
        <DiffCardRow
          key={`${card.filename || "unknown"}-${i}`}
          card={card}
          cycle={i}
          onOpenFile={onOpenFile}
          isFirst={i === 0}
        />
      ))}
    </div>
  );
}

function DiffCardRow({
  card,
  cycle,
  onOpenFile,
  isFirst,
}: {
  card: DiffCard;
  cycle: number;
  onOpenFile?: (path: string) => void;
  isFirst: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {isFirst && <FileHeader path={card.filename} onOpenFile={onOpenFile} />}
      {/* `filename=""` makes upstream's internal header render an empty span,
          so ours (above) is the only visible file label. */}
      <CodeDiff
        filename=""
        additions={card.additions}
        deletions={card.deletions}
        lines={card.lines}
        cycle={cycle}
      />
    </div>
  );
}

function FileHeader({
  path,
  onOpenFile,
  noDiff,
}: {
  path: string;
  onOpenFile?: (path: string) => void;
  noDiff?: boolean;
}) {
  const label = path ? basename(path) : "(no path)";
  const clickable = Boolean(path && onOpenFile);
  return (
    <div className="flex items-center gap-1.5 px-1 font-mono text-[11px]">
      <FileText size={11} className="shrink-0 text-[var(--text-dim)]" />
      <button
        type="button"
        onClick={clickable ? () => onOpenFile!(path) : undefined}
        disabled={!clickable}
        title={path}
        className={cn(
          "min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left underline-offset-2",
          clickable
            ? "cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)] hover:underline"
            : "text-[var(--text-dim)]"
        )}
      >
        {label}
      </button>
      {noDiff && (
        <span className="shrink-0 text-[10px] text-[var(--text-dim)]">
          (no diff)
        </span>
      )}
    </div>
  );
}
