// Full-history session tree for the header panel, built on shadcn's
// reui/c-tree-2 (headless-tree): proper indent (--tree-indent) + guide lines,
// folders expand/collapse, active branch highlighted. Data comes from the
// session file's full tree (every branch); clicking a node switches the
// branch via navigate-leaf (same file, no new session).
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
  const walk = (nodes: SessionTreeNode[], parentId: string) => {
    for (const node of nodes) {
      const id = node.entry?.id ?? "";
      if (!id) continue;
      items[id] = {
        name: entryText(node.entry) || entryRole(node.entry),
        role: entryRole(node.entry),
        isActive: activeIds.has(id),
        hasBranch: node.children.length > 1,
      };
      if (node.children.length > 0) {
        items[id].children = node.children.map((c) => c.entry?.id ?? "").filter(Boolean);
      }
      (items[parentId].children ??= []).push(id);
      walk(node.children, id);
    }
  };
  walk(tree, ROOT_ID);
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
  const expanded = Object.keys(items).filter((id) => (items[id].children?.length ?? 0) > 0);

  const treeApi = useTree<NodeData>({
    initialState: { expandedItems: expanded },
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
    <Tree
      className="relative before:absolute before:inset-0 before:-ms-1 before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)))]"
      indent={INDENT}
      tree={treeApi}
    >
      {treeApi.getItems().map((item) => {
        const id = item.getId();
        const data = item.getItemData();
        if (id === ROOT_ID) return null;
        // headless-tree's getItems() returns ALL loaded items (folded ones
        // included) — render only items whose ancestor chain is expanded,
        // otherwise collapsed subtrees duplicate on screen.
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
          <TreeItem
            key={id}
            item={item}
            onClick={() => {
              if (id !== ROOT_ID) onSelect(id);
            }}
          >
            <TreeItemLabel
              className={cn(
                "flex w-full min-w-0 items-center gap-1.5 rounded-[7px] px-2 py-1 text-xs",
                data.isActive
                  ? "bg-[var(--bg-selected)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
              )}
            >
              {roleIcon(data.role)}
              <span className="min-w-0 flex-1 truncate">{data.name}</span>
              {data.hasBranch && (
                <span className="shrink-0 rounded-[4px] border border-[var(--border)] bg-[var(--bg-hover)] px-[4px] py-[1px] text-[9px] leading-none whitespace-nowrap text-[var(--text-dim)]">
                  branch
                </span>
              )}
            </TreeItemLabel>
          </TreeItem>
        );
      })}
    </Tree>
  );
}
