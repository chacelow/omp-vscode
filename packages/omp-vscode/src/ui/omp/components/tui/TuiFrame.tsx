"use client";

// TUI-styled shell that mirrors the terminal Settings selector layout:
// bordered box · title · horizontal tab strip · divider · body · optional detail
// panel · divider · footer hint line. Designed to host both the Workbench top-
// level tabs and the Settings sub-tabs with a consistent look.

import type { CSSProperties, JSX, ReactNode } from "react";

export interface TuiTab {
  id: string;
  label: string;
  hint?: string;
}

interface TuiFrameProps {
  title?: string;
  tabs: readonly TuiTab[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  footerHint?: string;
  detail?: ReactNode;
  bodyStyle?: CSSProperties;
  children: ReactNode;
}

const BORDER: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
};
const DIVIDER: CSSProperties = {
  height: 1,
  background: "var(--border)",
  flexShrink: 0,
};

function TuiTabButton({
  tab,
  active,
  onSelect,
}: {
  tab: TuiTab;
  active: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={tab.hint}
      style={{
        padding: "6px 14px",
        border: "none",
        borderBottom: active
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        background: "transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        fontFamily: "var(--vscode-font-family)",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        whiteSpace: "nowrap",
      }}
    >
      {tab.label}
    </button>
  );
}

export function TuiFrame({
  title,
  tabs,
  activeTab,
  onSelectTab,
  footerHint,
  detail,
  bodyStyle,
  children,
}: TuiFrameProps): JSX.Element {
  return (
    <div
      style={{
        ...BORDER,
        background: "var(--bg)",
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
    >
      {title ? (
        <>
          <header
            style={{
              padding: "8px 14px",
              fontSize: 12,
              color: "var(--text-muted)",
              letterSpacing: 0.5,
            }}
          >
            {title}
          </header>
          <div style={DIVIDER} />
        </>
      ) : null}
      <nav
        aria-label={title ? `${title} tabs` : "Tabs"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => (
          <TuiTabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTab}
            onSelect={() => onSelectTab(tab.id)}
          />
        ))}
      </nav>
      <div style={DIVIDER} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          ...(bodyStyle ?? {}),
        }}
      >
        {children}
      </div>
      {detail ? (
        <>
          <div style={DIVIDER} />
          <div
            style={{
              padding: "10px 16px",
              minHeight: 56,
              color: "var(--text-dim)",
              fontSize: 12,
              lineHeight: 1.5,
              background: "var(--bg-panel)",
            }}
          >
            {detail}
          </div>
        </>
      ) : null}
      {footerHint ? (
        <>
          <div style={DIVIDER} />
          <footer
            style={{
              padding: "6px 14px",
              color: "var(--text-dim)",
              fontSize: 11,
              fontFamily: "var(--vscode-font-family)",
            }}
          >
            {footerHint}
          </footer>
        </>
      ) : null}
    </div>
  );
}
