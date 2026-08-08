// Shared full-history tree rendering for the session tree (header panel and
// the message-list dropdown). Renders every branch from the session file;
// the active branch is highlighted; clicking a node switches branches.
import { Bot, User, Wrench } from "lucide-react";
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

export function SessionTreeNodes({
  tree,
  activeIds,
  onSelect,
}: {
  tree: SessionTreeNode[];
  activeIds: Set<string>;
  onSelect: (entryId: string) => void;
}) {
  const renderNode = (node: SessionTreeNode, depth: number) => {
    const id = node.entry?.id ?? "";
    const role = entryRole(node.entry);
    const isActive = activeIds.has(id);
    const hasBranch = node.children.length > 1;
    return (
      <div key={id}>
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
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };
  return <>{tree.map((node) => renderNode(node, 0))}</>;
}
