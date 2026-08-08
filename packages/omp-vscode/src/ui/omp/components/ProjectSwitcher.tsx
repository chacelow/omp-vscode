// ProjectSwitcher — current project name + "Select Workspace" hover card +
// click-to-expand project dropdown. Sits at the top-left of the empty chat
// page (the "input top-left" entry point), replacing the sidebar's project
// picker for this view.

import { useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";

interface Project {
  name: string;
  path: string;
}

function pathName(p: string): string {
  const seg = p.split(/[\\/]/).filter(Boolean);
  return seg.length > 0 ? seg[seg.length - 1] : p;
}

export function ProjectSwitcher({
  cwdName,
  cwd,
  onSelect,
}: {
  cwdName: string | null;
  /** Full path (shown in the hover card); falls back to cwdName. */
  cwd?: string | null;
  onSelect: (cwd: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Load the project list (deduped by projectRoot) when the dropdown opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d: { sessions?: SessionInfo[] }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const list: Project[] = [];
        for (const s of d.sessions ?? []) {
          const root = s.projectRoot ?? s.cwd;
          if (seen.has(root)) continue;
          seen.add(root);
          list.push({ name: pathName(root), path: root });
        }
        list.sort((a, b) => a.name.localeCompare(b.name));
        setProjects(list);
      })
      .catch(() => setProjects([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={cwdName ?? "Select project"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text)",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cwdName ?? "Select project"}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Hover hint card */}
      {hover && !open && cwdName && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 130,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 6px 20px var(--vscode-widget-shadow, rgba(0,0,0,0.18))",
            padding: "8px 12px",
            minWidth: 200,
            maxWidth: 320,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
            Select Workspace
          </div>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {cwd ?? cwdName}
          </div>
        </div>
      )}

      {/* Project dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 140,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 6px 20px var(--vscode-widget-shadow, rgba(0,0,0,0.18))",
            minWidth: 240,
            maxWidth: 320,
            maxHeight: 280,
            overflowY: "auto",
            padding: 4,
          }}
        >
          {projects.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>
              No projects yet
            </div>
          ) : (
            projects.map((p) => (
              <button
                key={p.path}
                onClick={() => {
                  onSelect(p.path);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  background: "none",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--text)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <div style={{ fontSize: 12, fontWeight: 500 }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.path}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
