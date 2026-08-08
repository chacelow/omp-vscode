import { useState, memo } from "react";
import { Crosshair } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isStreaming}
          title="Switch model role"
          className="h-6 max-w-[130px] gap-1.5 overflow-hidden rounded-[9px] px-2 text-xs data-[state=open]:bg-[var(--bg-hover)]"
        >
          <Crosshair size={11} className="shrink-0" />
          <span className="truncate">
            {activeRoleLabel ?? "Role"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)] p-1">
        {roleNames.map((role) => {
          const rr = modelRoles?.[role];
          const isActive = role === activeRole || (role === "smol" && fastMode);
          return (
            <DropdownMenuItem
              key={role}
              onSelect={() => onRoleChange(role)}
              title={rr ? `${rr.provider}/${rr.modelId}${rr.thinkingLevel ? ":" + rr.thinkingLevel : ""}` : role}
              className={`gap-2 text-xs ${isActive ? "bg-[var(--bg-selected)] font-semibold text-[var(--text)] focus:bg-[var(--bg-selected)]" : "text-[var(--text-muted)]"}`}
            >
              <span className="flex-1 truncate">
                {ROLE_LABELS[role] ?? role}
              </span>
              {rr && (
                <span className="max-w-[90px] truncate text-[10px] opacity-50">
                  {rr.modelId}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
