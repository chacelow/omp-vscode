// Lightweight session tree: the current session's messages as a flat
// turn list (OMP TUI Session Tree equivalent). Clicking an entry scrolls
// the chat to that message. Fork/branch points show when the session file
// carries parentId links (future: render children recursively).
import { useState } from "react";
import { Bot, ListTree, User, Wrench } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { AgentMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

function roleIcon(role: string) {
  if (role === "user") return <User size={11} className="shrink-0 text-[var(--text-dim)]" />;
  if (role === "assistant") return <Bot size={11} className="shrink-0 text-[var(--accent)]" />;
  return <Wrench size={11} className="shrink-0 text-[var(--text-dim)]" />;
}

function summaryOf(m: AgentMessage): string {
  const parts: string[] = [];
  const blocks = "content" in m && Array.isArray(m.content) ? m.content : [];
  for (const block of blocks) {
    if (block.type === "text" && "text" in block && block.text) parts.push(block.text.replace(/\s+/g, " ").trim());
    else if (block.type === "image") parts.push("🖼 image");
    else if (block.type === "toolCall") parts.push(`⚙ ${"name" in block ? block.name : "tool"}`);
  }
  const s = parts.join(" · ").trim();
  return s.length > 90 ? s.slice(0, 90) + "…" : (s || "(empty)");
}

interface SessionTreePanelProps {
  messages: AgentMessage[];
  entryIds: string[];
  activeEntryId?: string | null;
  onSelect: (entryId: string) => void;
  t: (key: string) => string;
}

export function SessionTreePanel({ messages, entryIds, activeEntryId, onSelect, t }: SessionTreePanelProps) {
  const [open, setOpen] = useState(false);
  const count = messages.length;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={t("i18n.sessionTree") ?? "Session tree"}
          className="h-6 gap-1.5 rounded-[9px] px-2 text-[11px] text-[var(--text-dim)] hover:bg-[var(--toolbar-hover)] hover:text-[var(--text)]"
        >
          <ListTree size={12} className="shrink-0" />
          <span className="font-mono">{count}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="max-w-[min(70vw,460px)] p-1"
      >
        <div className="max-h-[min(60vh,420px)] overflow-y-auto">
          {count === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--text-dim)]">No messages</div>
          ) : (
            entryIds.map((id, i) => {
              const msg = messages[i];
              const isActive = activeEntryId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onSelect(id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[5px] text-left text-xs",
                    isActive
                      ? "bg-[var(--bg-selected)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
                  )}
                >
                  <span className="shrink-0 font-mono text-[9px] text-[var(--text-dim)]">{i + 1}</span>
                  {roleIcon(msg?.role ?? "")}
                  <span className="min-w-0 flex-1 truncate">
                    {msg ? summaryOf(msg) : id}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
