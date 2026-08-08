import { useState, useRef, memo } from "react";
import type { SlashCommandInfo } from "@/hooks/useAgentSession";

// Role switcher (Default / Fast / Plan) — matches the TUI: a role is
// switchable when both the role is configured (config.yml modelRoles) AND
// its command exists in get_available_commands (/fast → smol, /plan → plan).

const ROLE_LABELS: Record<string, string> = { default: "Default", smol: "Fast", plan: "Plan" };
const ROLE_ORDER = ["default", "smol", "plan"] as const;

export interface RoleSelectorProps {
  modelRoles?: Record<string, { provider: string; modelId: string; thinkingLevel?: string }>;
  model?: { provider: string; modelId: string } | null;
  fastMode?: boolean;
  slashCommands?: SlashCommandInfo[];
  isStreaming?: boolean;
  onRoleChange?: (role: string) => void;
}

export const RoleSelector = memo(function RoleSelector({
  modelRoles, model, fastMode, slashCommands, isStreaming, onRoleChange,
}: RoleSelectorProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const roleCmdExists = (name: string) => (slashCommands ?? []).some((c) => c.name === name);
  const roleNames = ROLE_ORDER.filter((r) => {
    if (r === "default") return modelRoles?.default != null;
    if (!modelRoles?.[r]) return false;
    return roleCmdExists(r === "smol" ? "fast" : "plan");
  });
  const activeRole = roleNames.find((r) => {
    const rr = modelRoles?.[r];
    return rr && model && rr.provider === model.provider && rr.modelId === model.modelId;
  }) ?? (roleNames.includes("default") ? "default" : undefined);
  const activeRoleLabel = activeRole ? (ROLE_LABELS[activeRole] ?? activeRole) : undefined;

  if (roleNames.length === 0 || !onRoleChange) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={(e) => {
          const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setRect({ top: el.top, left: el.left, width: el.width });
          setOpen((o) => !o);
        }}
        disabled={isStreaming}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 8px", height: 24, maxWidth: 120, overflow: "hidden",
          background: open ? "var(--bg-hover)" : "rgba(var(--accent-rgb, 120, 120, 120), 0.12)",
          border: "1px solid rgba(var(--accent-rgb, 120, 120, 120), 0.35)",
          borderRadius: 9, color: "var(--text)",
          cursor: isStreaming ? "not-allowed" : "pointer", fontSize: 12,
          opacity: isStreaming ? 0.5 : 1, transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          if (isStreaming) return;
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = open ? "var(--bg-hover)" : "rgba(var(--accent-rgb, 120, 120, 120), 0.12)";
        }}
        title="Switch model role"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeRoleLabel ?? "Role"}
        </span>
      </button>
      {open && rect && (
        <div
          style={{
            position: "fixed", bottom: (window.visualViewport?.height ?? window.innerHeight) - rect.top + 6, left: rect.left,
            minWidth: rect.width, maxHeight: 320, overflowY: "auto",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)", zIndex: 1000, padding: 4,
          }}
        >
          {roleNames.map((role) => {
            const rr = modelRoles?.[role];
            const isActive = role === activeRole || (role === "smol" && fastMode);
            return (
              <button
                key={role}
                onClick={() => {
                  setOpen(false);
                  onRoleChange(role);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "6px 10px", border: "none", borderRadius: 7,
                  background: isActive ? "var(--bg-hover)" : "none",
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer", fontSize: 12, textAlign: "left",
                }}
                title={rr ? `${rr.provider}/${rr.modelId}${rr.thinkingLevel ? ":" + rr.thinkingLevel : ""}` : role}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ROLE_LABELS[role] ?? role}
                </span>
                {rr && (
                  <span style={{ opacity: 0.5, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>
                    {rr.modelId}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
