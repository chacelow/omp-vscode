// Full-history session tree (OMP TUI Session Tree equivalent): renders the
// COMPLETE tree from the session file — every branch incl. old rewinds —
// with the active branch highlighted. Clicking a node switches the active
// branch (same file, reorder + restart, no new session / no deletion).
import { useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { SessionTreeNode } from "@/lib/types";
import { SessionTreeNodes } from "./session-tree-view";

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
            <SessionTreeNodes
              tree={tree}
              activeIds={activeIds}
              onSelect={(entryId) => {
                onSelect(entryId);
                setOpen(false);
              }}
            />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
