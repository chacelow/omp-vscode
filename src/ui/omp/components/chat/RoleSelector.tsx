import { useState, useRef, memo } from "react";
import { Crosshair } from "lucide-react";
import { Button } from "../ui/button";
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => {
          const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setRect({ top: el.top, left: el.left, width: el.width });
          setOpen((o) => !o);
        }}
        disabled={isStreaming}
        title="Switch model role"
        className={`h-6 max-w-[130px] gap-1.5 overflow-hidden rounded-[9px] px-2 text-xs ${
          open ? "bg-[var(--bg-hover)] text-[var(--text)]" : "bg-[rgba(var(--accent-rgb,120,120,120),0.12)] text-[var(--text)]"
        } ${isStreaming ? "cursor-not-allowed opacity-50" : "hover:bg-[var(--bg-hover)]"}`}
      >
        <Crosshair size={11} className="shrink-0" />
        <span className="truncate">
          {activeRoleLabel ?? "Role"}
        </span>
      </Button>
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
              <Button
                key={role}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onRoleChange(role);
                }}
                className={`w-full justify-start gap-2 rounded-[7px] px-2.5 py-1.5 text-xs ${
                  isActive ? "bg-[var(--bg-hover)] text-[var(--text)] hover:bg-[var(--bg-hover)]" : "text-[var(--text-muted)]"
                }`}
                title={rr ? `${rr.provider}/${rr.modelId}${rr.thinkingLevel ? ":" + rr.thinkingLevel : ""}` : role}
              >
                <span className="flex-1 truncate">
                  {ROLE_LABELS[role] ?? role}
                </span>
                {rr && (
                  <span className="max-w-[90px] truncate text-[10px] opacity-50">
                    {rr.modelId}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
});
