"use client";

// TUI-styled row list. Each item is either a section heading (full-width label,
// no interaction) or a row (label on left, current value on right, optional
// expand-inline control revealed when the row is the active one).

import type { CSSProperties, JSX, ReactNode } from "react";
import { useEffect, useRef } from "react";

export interface TuiRow {
  id: string;
  kind: "row";
  label: string;
  value: ReactNode;
  description?: string;
  disabled?: boolean;
  onActivate?: () => void;
  detail?: ReactNode; // Rendered inline when this row is active (submenu/input).
}

export interface TuiHeading {
  id: string;
  kind: "heading";
  label: string;
}

export type TuiListItem = TuiRow | TuiHeading;

interface TuiRowListProps {
  items: readonly TuiListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "6px 16px",
  fontSize: 13,
  cursor: "pointer",
  borderLeft: "2px solid transparent",
  color: "var(--text)",
};

const HEADING_STYLE: CSSProperties = {
  padding: "10px 16px 4px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

export function TuiRowList({
  items,
  activeId,
  onSelect,
}: TuiRowListProps): JSX.Element {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <div
      role="listbox"
      aria-label="Settings"
      style={{ display: "flex", flexDirection: "column", padding: "4px 0" }}
    >
      {items.map((item) => {
        if (item.kind === "heading") {
          return (
            <div key={item.id} style={HEADING_STYLE}>
              {item.label}
            </div>
          );
        }
        const isActive = item.id === activeId;
        return (
          <div key={item.id} ref={isActive ? activeRef : undefined}>
            <div
              role="option"
              aria-selected={isActive}
              aria-disabled={item.disabled ? "true" : undefined}
              onClick={() => {
                if (item.disabled) return;
                onSelect(item.id);
                item.onActivate?.();
              }}
              style={{
                ...ROW_STYLE,
                background: isActive
                  ? "var(--bg-selected, rgba(255,255,255,0.05))"
                  : "transparent",
                borderLeftColor: isActive ? "var(--accent)" : "transparent",
                opacity: item.disabled ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (item.disabled || isActive) return;
                (event.currentTarget as HTMLDivElement).style.background =
                  "var(--bg-panel)";
              }}
              onMouseLeave={(event) => {
                if (isActive) return;
                (event.currentTarget as HTMLDivElement).style.background =
                  "transparent";
              }}
            >
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 12,
                  fontFamily: "var(--vscode-editor-font-family, ui-monospace)",
                  flexShrink: 0,
                  maxWidth: "50%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.value}
              </div>
            </div>
            {isActive && item.detail ? (
              <div
                style={{
                  padding: "6px 16px 12px 30px",
                  background: "var(--bg-panel)",
                  borderLeft: "2px solid var(--accent)",
                }}
              >
                {item.detail}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
