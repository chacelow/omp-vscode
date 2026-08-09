// Full-history session tree for the header panel, built on shadcn's
// reui/c-tree-2 (headless-tree): proper indent (--tree-indent) + guide lines,
// folders expand/collapse, active branch highlighted. Data comes from the
// session file's full tree (every branch); clicking a node switches the
// branch via navigate-leaf (same file, no new session).
import { useEffect, useRef } from "react";
import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Bot, User, Wrench } from "lucide-react";
import type { SessionEntry, SessionTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

const INDENT = 20;
const ROOT_ID = "__session__";

interface NodeData {
  name: string;
  role: string;
  isActive: boolean;
  hasBranch: boolean;
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

function roleIcon(role: string) {
  if (role === "user") return <User size={11} className="shrink-0 text-[var(--text-dim)]" />;
  if (role === "assistant") return <Bot size={11} className="shrink-0 text-[var(--accent)]" />;
  return <Wrench size={11} className="shrink-0 text-[var(--text-dim)]" />;
}

function buildTreeData(tree: SessionTreeNode[], activeIds: Set<string>) {
  const items: Record<string, NodeData & { children?: string[] }> = {
    [ROOT_ID]: { name: "Session", role: "root", isActive: false, hasBranch: false, children: [] },
  };

  // Session parentId links form a full chronological chain. That storage shape
  // must not become visual indentation: linear turns remain siblings. A node
  // creates a visual level only when it has multiple children (a real fork).
  const walk = (node: SessionTreeNode, displayParentId: string): void => {
    const nodeId = node.entry?.id;
    if (!nodeId) return;
    items[nodeId] = {
      name: entryText(node.entry) || entryRole(node.entry),
      role: entryRole(node.entry),
      isActive: activeIds.has(nodeId),
      hasBranch: node.children.length > 1,
      children: [],
    };
    (items[displayParentId].children ??= []).push(nodeId);

    if (node.children.length === 1) {
      walk(node.children[0], displayParentId);
      return;
    }
    for (const child of node.children) walk(child, nodeId);
  };

  for (const node of tree) walk(node, ROOT_ID);
  return items;
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
  const items = buildTreeData(tree, activeIds);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [tree]);
  const treeApi = useTree<NodeData>({
    // Default: fully expanded — the full history tree opens showing every
    // branch; users collapse subtrees as needed.
    initialState: { expandedItems: Object.keys(items) },
    indent: INDENT,
    rootItemId: ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData() as { children?: string[] })?.children?.length !== undefined,
    dataLoader: {
      getItem: (itemId) => items[itemId],
      getChildren: (itemId) => items[itemId].children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });
  return (
    <div ref={scrollRef} className="max-h-[calc(min(60vh,420px)-16px)] overflow-y-auto">
      <Tree
        className="relative before:absolute before:inset-0 before:-ms-1 before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)))]"
        indent={INDENT}
        tree={treeApi}
      >
        {treeApi.getItems().map((item) => {
          const id = item.getId();
          const data = item.getItemData();
          if (id === ROOT_ID) return null;
          let visible = true;
          let parent = item.getParent();
          while (parent) {
            if (parent.getId() !== ROOT_ID && !parent.isExpanded()) {
              visible = false;
              break;
            }
            parent = parent.getParent();
          }
          if (!visible) return null;
          return (
            <TreeItem key={id} item={item} onClick={() => onSelect(id)}>
              <TreeItemLabel
                className={cn(
                  "flex w-full min-w-0 items-center gap-1.5 rounded-[7px] px-2 py-1 text-left text-xs",
                  data.isActive
                    ? "bg-[var(--bg-selected)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
                )}
              >
                {roleIcon(data.role)}
                <span className="min-w-0 flex-1 truncate">{data.name}</span>
                {data.hasBranch && <span className="shrink-0 rounded-[4px] border border-[var(--border)] bg-[var(--bg-hover)] px-[4px] py-[1px] text-[9px] leading-none whitespace-nowrap text-[var(--text-dim)]">branch</span>}
              </TreeItemLabel>
            </TreeItem>
          );
        })}
      </Tree>
    </div>
  );
}
