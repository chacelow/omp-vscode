"use client";

import { useState, useCallback, useMemo, useRef, useEffect, type KeyboardEvent, type MouseEvent } from "react";
import type { SessionEntry, SessionTreeNode } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { hostCall } from "../../bridge";

interface Props {
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  sessionId?: string | null;
  onLeafChange: (leafId: string | null) => void;
  /** When true, renders as a compact inline button for embedding in a top bar */
  inline?: boolean;
  /** When inline, use this ref's bounding rect to size/position the dropdown */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Controlled open state for inline mode */
  open?: boolean;
  /** Called when the button is clicked in inline mode */
  onToggle?: () => void;
  /** Whether a session is currently active (used to show appropriate empty reason) */
  hasSession?: boolean;
  /** When inline, render icon-only (no text label) to save horizontal space */
  compact?: boolean;
}

// Find the visible entry IDs on the path from root to activeLeafId.
function buildActivePath(nodes: SessionTreeNode[], targetId: string | null): Set<string> {
  if (!targetId) return new Set();
  const target = targetId;
  function search(nodes: SessionTreeNode[], path: string[]): string[] | null {
    for (const node of nodes) {
      const next = [...path, node.entry.id];
      if (node.entry.id === target || node.compressedEntryIds?.includes(target)) {
        return next;
      }
      const found = search(node.children, next);
      if (found) return found;
    }
    return null;
  }
  return new Set(search(nodes, []) ?? []);
}

// Compress a visible linear chain into the first branching/leaf node.
// Server-side compressed IDs also count as skipped nodes.
function compress(node: SessionTreeNode): { node: SessionTreeNode; skipped: number } {
  let current = node;
  let skipped = current.compressedEntryIds?.length ?? 0;
  while (current.children.length === 1) {
    current = current.children[0];
    skipped += 1 + (current.compressedEntryIds?.length ?? 0);
  }
  return { node: current, skipped };
}

function getLabel(entry: SessionEntry): string {
  if (entry.type === "message" && "message" in entry) {
    const msg = entry.message as { role: string; content: unknown };
    const content = msg.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(" ");
    }
    if (text.length > 40) text = text.slice(0, 40) + "…";
    if (text) return text;
    if (msg.role === "assistant") return "[assistant]";
  }
  return entry.type;
}

// Does the tree have any branching at all?
function hasBranch(nodes: SessionTreeNode[]): boolean {
  for (const node of nodes) {
    if (node.children.length > 1) return true;
    if (hasBranch(node.children)) return true;
  }
  return false;
}

interface TreeNodeProps {
  node: SessionTreeNode;
  activePathIds: Set<string>;
  depth: number;
  isLast: boolean;
  parentLines: boolean[];
  onSelect: (id: string) => void;
  onEditLabel: (entryId: string, label: string) => void;
  editingId: string | null;
  onStartEdit: (entryId: string, label: string) => void;
}

function TreeNodeView({ node, activePathIds, depth, isLast, parentLines, onSelect, onEditLabel, editingId, onStartEdit }: TreeNodeProps) {
  const { node: rep, skipped } = compress(node);
  const isActive = activePathIds.has(rep.entry.id);
  const isOnPath = activePathIds.has(node.entry.id) || activePathIds.has(rep.entry.id);
  const label = node.label?.trim() || getLabel(rep.entry);
  const role = rep.entry.type === "message" && "message" in rep.entry
    ? (rep.entry.message as { role: string }).role
    : null;
  const editing = editingId === rep.entry.id;
  const [draftLabel, setDraftLabel] = useState(label);
  useEffect(() => { if (editing) setDraftLabel(label); }, [editing, label]);

  return (
    <div>
      {/* This node row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 24,
          cursor: "pointer",
        }}
        onClick={() => onSelect(rep.entry.id)}
        onContextMenu={(event: MouseEvent<HTMLDivElement>) => { event.preventDefault(); onStartEdit(rep.entry.id, label); }}
      >
        {/* Indent guide lines */}
        {parentLines.map((hasLine, i) => (
          <div key={i} style={{ width: 16, flexShrink: 0, position: "relative", height: "100%", alignSelf: "stretch" }}>
            {hasLine && (
              <div style={{
                position: "absolute",
                left: 7,
                top: 0,
                bottom: 0,
                width: 1,
                background: "var(--border)",
              }} />
            )}
          </div>
        ))}

        {/* Branch connector */}
        <div style={{ width: 16, flexShrink: 0, position: "relative", height: "100%", alignSelf: "stretch" }}>
          {/* vertical line up (to parent) */}
          <div style={{
            position: "absolute",
            left: 7,
            top: 0,
            bottom: isLast ? "50%" : 0,
            width: 1,
            background: "var(--border)",
          }} />
          {/* horizontal line to node */}
          <div style={{
            position: "absolute",
            left: 7,
            top: "50%",
            width: 9,
            height: 1,
            background: "var(--border)",
          }} />
        </div>

        {/* Node dot */}
        <div style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flexShrink: 0,
          background: isActive ? "var(--accent)" : isOnPath ? "var(--text-muted)" : "var(--border)",
          border: isActive ? "none" : "1px solid var(--text-dim)",
          marginRight: 6,
          transition: "background 0.12s",
        }} />

        {/* Role badge */}
        {role && (
          <span style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: role === "user" ? "var(--accent)" : "var(--text-dim)",
            background: role === "user" ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "var(--bg-hover)",
            border: `1px solid ${role === "user" ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "var(--border)"}`,
            borderRadius: 3,
            padding: "0 4px",
            marginRight: 5,
            flexShrink: 0,
            lineHeight: "16px",
          }}>
            {role === "user" ? "U" : "A"}
          </span>
        )}

        {/* Skipped indicator */}
        {skipped > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", marginRight: 5, flexShrink: 0 }}>
            +{skipped}
          </span>
        )}

        {editing ? (
          <input
            aria-label="Entry label"
            autoFocus
            value={draftLabel}
            onChange={(event) => setDraftLabel(event.target.value)}
            onBlur={() => onEditLabel(rep.entry.id, draftLabel)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEditLabel(rep.entry.id, draftLabel); } if (event.key === "Escape") onEditLabel(rep.entry.id, label); }}
            style={{ flex: 1, minWidth: 0, fontSize: 11, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--accent)" }}
          />
        ) : (
          <span style={{
            fontSize: 11,
            color: isActive ? "var(--text)" : isOnPath ? "var(--text-muted)" : "var(--text-dim)",
            fontWeight: isActive ? 500 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}>
            {label}
          </span>
        )}
      </div>

      {rep.children.map((child, idx) => (
        <TreeNodeView
          key={child.entry.id}
          node={child}
          activePathIds={activePathIds}
          depth={depth + 1}
          isLast={idx === rep.children.length - 1}
          parentLines={[...parentLines, !isLast]}
          onSelect={onSelect}
          onEditLabel={onEditLabel}
          editingId={editingId}
          onStartEdit={onStartEdit}
        />
      ))}
    </div>
  );
}

export function BranchNavigator({ tree, activeLeafId, onLeafChange, sessionId, inline, containerRef, open: openProp, onToggle, hasSession, compact }: Props) {
  const { t } = useI18n();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !inline) return;
    const anchor = containerRef?.current ?? btnRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [open, inline, containerRef]);

  const activePathIds = useMemo(
    () => buildActivePath(tree, activeLeafId),
    [tree, activeLeafId]
  );

  const handleSelect = useCallback((id: string) => {
    onLeafChange(id);
  }, [onLeafChange]);
  const handleEditLabel = useCallback((entryId: string, label: string) => {
    setEditingId(null);
    if (!sessionId || !label.trim()) return;
    void hostCall("sessionRenameEntry", { sessionId, entryId, label: label.trim() });
  }, [sessionId]);

  const noBranchReason = !hasSession
    ? t("i18n.noActiveSession")
    : !hasBranch(tree)
      ? t("i18n.noBranches")
      : null;
  // Find first meaningful node (skip pure linear prefix)
  const compressed = tree.length > 0 ? compress(tree[0]) : null;
  const firstNode = compressed?.node ?? null;
  const hasContent = !noBranchReason && firstNode && firstNode.children.length > 1;
  const filteredChildren = useMemo(() => firstNode?.children.filter((node) => {
    const query = filter.trim().toLowerCase();
    return !query || getLabel(node.entry).toLowerCase().includes(query) || node.label?.toLowerCase().includes(query);
  }) ?? [], [filter, firstNode]);
  const onTreeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const ids = filteredChildren.map((node) => compress(node).node.entry.id);
    const current = activeLeafId ? ids.indexOf(activeLeafId) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End" || event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : event.key === "ArrowDown" || event.key === "PageDown" ? Math.min(ids.length - 1, current + (event.key === "PageDown" ? 5 : 1)) : Math.max(0, current - (event.key === "PageUp" ? 5 : 1));
      if (ids[next]) onLeafChange(ids[next]);
    }
    if (event.key === "Enter" && event.shiftKey && activeLeafId && sessionId) {
      event.preventDefault();
      const summary = window.prompt("Summary for this branch");
      if (summary?.trim()) {
        void hostCall("sessionAppendSummary", { sessionId, entryId: activeLeafId, summary: summary.trim() })
          .then(() => onLeafChange(activeLeafId));
      }
      return;
    }
    if (event.key === "Enter" && activeLeafId) { event.preventDefault(); onLeafChange(activeLeafId); }
  }, [activeLeafId, filteredChildren, onLeafChange, sessionId]);

  const branchIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: hasContent ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );

  const chevron = (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
      <polyline points="2 3.5 5 6.5 8 3.5" />
    </svg>
  );


  if (inline) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "stretch" }}>
        <button
          ref={btnRef}
          onClick={() => onToggle ? onToggle() : setOpenInternal((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: "100%",
            padding: "0 12px",
            background: open ? "var(--bg-selected)" : "none",
            border: "none",
            borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
            borderRight: "1px solid var(--border)",
            cursor: "pointer",
            color: open ? "var(--text)" : "var(--text-muted)",
            fontSize: 11,
            whiteSpace: "nowrap",
            transition: "color 0.1s, background 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)"; }}
           title={t("i18n.branches")}
           aria-label={t("i18n.branches")}
          aria-pressed={open}
        >
          {branchIcon}
           {!compact && <span>{t("i18n.branches")}</span>}
        </button>
        {open && dropdownPos && (
          <div style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            zIndex: 500,
          }}>
            {hasContent && firstNode ? (
              <div tabIndex={0} onKeyDown={onTreeKeyDown} style={{ padding: "4px 12px 8px", maxHeight: 260, overflowY: "auto" }}>
                <input aria-label="Filter branches" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter branches" style={{ width: "100%", marginBottom: 4 }} />
                {filteredChildren.map((child, idx) => (
                  <TreeNodeView key={child.entry.id} node={child} activePathIds={activePathIds} depth={0} isLast={idx === filteredChildren.length - 1} parentLines={[]} onSelect={handleSelect} onEditLabel={handleEditLabel} editingId={editingId} onStartEdit={(entryId) => setEditingId(entryId)} />
                ))}
              </div>
            ) : (
              <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                {noBranchReason}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0, position: "relative" }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpenInternal((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "5px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 11,
          textAlign: "left",
        }}
      >
        {branchIcon}
         <span style={{ color: "var(--text-muted)" }}>{t("i18n.branches")}</span>
        {chevron}
      </button>

      {/* Tree panel - overlay */}
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 4px 12px var(--vscode-widget-shadow, rgba(0,0,0,0.1))",
          zIndex: 100,
        }}>
          {hasContent && firstNode ? (
            <div tabIndex={0} onKeyDown={onTreeKeyDown} style={{ padding: "4px 12px 8px", maxHeight: 260, overflowY: "auto" }}>
              <input aria-label="Filter branches" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter branches" style={{ width: "100%", marginBottom: 4 }} />
              {filteredChildren.map((child, idx) => (
                <TreeNodeView key={child.entry.id} node={child} activePathIds={activePathIds} depth={0} isLast={idx === filteredChildren.length - 1} parentLines={[]} onSelect={handleSelect} onEditLabel={handleEditLabel} editingId={editingId} onStartEdit={(entryId) => setEditingId(entryId)} />
              ))}
            </div>
          ) : (
            <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              {noBranchReason ?? t("i18n.noBranches")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
