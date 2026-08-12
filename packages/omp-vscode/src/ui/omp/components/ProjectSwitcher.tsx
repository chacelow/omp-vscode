// ProjectSwitcher — current project name + "Select Workspace" hover card +
// click-to-expand project dropdown. Sits at the top-left of the empty chat
// page (the "input top-left" entry point), replacing the sidebar's project
// picker for this view.

import { useEffect, useRef, useState } from "react";
import { Folder, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Shimmer } from "./ai-elements/shimmer";
import { useI18n } from "@/hooks/useI18n";
import { hostCall } from "../../bridge";

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
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Load the project list (deduped by projectRoot) when the dropdown opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    hostCall("sessionsList", {})
      .then(({ sessions }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const list: Project[] = [];
        for (const session of sessions) {
          const root = session.projectRoot ?? session.cwd;
          if (seen.has(root)) continue;
          seen.add(root);
          list.push({ name: pathName(root), path: root });
        }
        list.sort((left, right) => left.name.localeCompare(right.name));
        setProjects(list);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={cwdName ?? "Select project"}
        className="h-6 max-w-[200px] gap-1.5 rounded-[9px] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] data-[state=open]:bg-[var(--bg-hover)]"
      >
        <Folder size={11} className="shrink-0" />
        <span className="max-w-[160px] min-w-0 truncate">
          {cwdName ?? "Select project"}
        </span>
        <ChevronDown size={10} strokeWidth={2.2} className="shrink-0" />
      </Button>

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
            boxShadow:
              "0 6px 20px var(--vscode-widget-shadow, rgba(0,0,0,0.18))",
            padding: "8px 12px",
            minWidth: 200,
            maxWidth: 320,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text)",
              marginBottom: 4,
            }}
          >
            Select Workspace
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
            }}
          >
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
            boxShadow:
              "0 6px 20px var(--vscode-widget-shadow, rgba(0,0,0,0.18))",
            minWidth: 240,
            maxWidth: 320,
            maxHeight: 280,
            overflowY: "auto",
            padding: 4,
          }}
        >
          {loading ? (
            <Shimmer
              className="px-2.5 py-2 text-[11px]"
              duration={2.5}
              spread={1}
            >
              {t("sidebar.loadingProjects")}
            </Shimmer>
          ) : projects.length === 0 ? (
            <div
              style={{
                padding: "8px 10px",
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              {t("sidebar.noProjects")}
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
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 500 }}>{p.name}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
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
