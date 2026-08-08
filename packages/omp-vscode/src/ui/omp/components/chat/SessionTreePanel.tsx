// Full-history session tree (OMP TUI Session Tree equivalent): renders the
// COMPLETE tree from the session file — every branch incl. old rewinds —
// with the active branch highlighted. Clicking a node switches the active
// branch (same file, reorder + restart, no new session / no deletion).
import { useState } from "react";
import { Bot, ListTree, User, Wrench } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { SessionEntry, SessionTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

function roleIcon(role: string) {
  if (role === "user") return <User size={11} className="shrink-0 text-[var(--text-dim)]" />;
  if (role === "assistant") return <Bot size={11} className="shrink-0 text-[var(--accent)]" />;
  return <Wrench size={11} className="shrink-0 text-[var(--text-dim)]" />;
}

function entryText(entry?: SessionEntry): string {
  if (!entry) return "";
  if (!("message" in entry) || !entry.message) return "";
  const blocks = "content" in entry.message && Array.isArray(entry.message.content)
    ? entry.message.content as Array<{ type?: string; text?: string }>
    : [];
  const text = blocks.find((c) => c.type === "text" && c.text)?.text ?? "";
  return text.replace(/\s+/g, " ").trim().slice(0, 80);
}

function entryRole(entry?: SessionEntry): string {
  return entry && "message" in entry && entry.message ? entry.message.role : "entry";
}

function TreeNode({
  node,
  depth,
  activeIds,
  onSelect,
}: {
  node: SessionTreeNode;
  depth: number;
  activeIds: Set<string>;
  onSelect: (entryId: string) => void;
}) {
  const id = node.entry?.id ?? "";
  const role = entryRole(node.entry);
  const isActive = activeIds.has(id);
  const hasBranch = node.children.length > 1;
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[5px] text-left text-xs",
          isActive
            ? "bg-[var(--bg-selected)] text-[var(--text)]"
            : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
        )}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        {roleIcon(role)}
        <span className="min-w-0 flex-1 truncate">{entryText(node.entry) || role}</span>
        {hasBranch && (
          <span className="shrink-0 rounded-[4px] border border-[var(--border)] bg-[var(--bg-hover)] px-[4px] py-[1px] text-[9px] leading-none whitespace-nowrap text-[var(--text-dim)]">
            branch
          </span>
        )}
      </button>
      {node.children.map((child) => (
        <TreeNode key={child.entry?.id ?? Math.random()} node={child} depth={depth + 1} activeIds={activeIds} onSelect={onSelect} />
      ))}
    </>
  );
}

interface SessionTreePanelProps {
  tree: SessionTreeNode[];
  activeEntryIds: string[];
  onSelect: (entryId: string) => void;
  t: (key: string) => string;
}

export function SessionTreePanel({ tree, activeEntryIds, onSelect, t }: SessionTreePanelProps) {
  const [open, setOpen] = useState(false);
  const activeIds = new Set(activeEntryIds);
  const count = tree.length;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={t("i18n.sessionTree") ?? "Full history tree"}
          className="h-6 gap-1.5 rounded-[9px] px-2 text-[11px] text-[var(--text-dim)] hover:bg-[var(--toolbar-hover)] hover:text-[var(--text)]"
        >
          <ListTree size={12} className="shrink-0" />
          <span className="font-mono">{count}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="max-w-[min(72vw,480px)] p-1">
        <div className="max-h-[min(60vh,420px)] overflow-y-auto">
          {count === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--text-dim)]">No messages</div>
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.entry?.id ?? Math.random()}
                node={node}
                depth={0}
                activeIds={activeIds}
                onSelect={(entryId) => {
                  onSelect(entryId);
                  setOpen(false);
                }}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
