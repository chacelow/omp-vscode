import { useState, memo } from "react";
import { Wrench, Check, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { RoleSelector, type RoleSelectorProps } from "./RoleSelector";
import { ModelSelector, type ModelSelectorProps } from "./ModelSelector";
import { SendButton } from "./SendButton";

// Bottom toolbar row of the chat input: LEFT (role + model + attach),
// spacer, RIGHT (tools preset / compact / sound / more) + send button.
// Owns its dropdown state (tool preset, mobile controls menu).

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = { off: "none", default: "default", full: "full" };

interface ToolbarRowProps {
  isMobile: boolean;
  isStreaming: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  role: RoleSelectorProps;
  model: ModelSelectorProps;
  attach?: { count: number; onAttach: () => void };
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  canSend: boolean;
  onSend: () => void;
  onAbort: () => void;
}

export const ToolbarRow = memo(function ToolbarRow({
  isMobile, isStreaming, t, role, model, attach,
  toolPreset, onToolPresetChange,
  canSend, onSend, onAbort,
}: ToolbarRowProps) {
  const [toolOpen, setToolOpen] = useState(false);

  const toolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default";

  const iconBtn = "h-6 rounded-[9px] px-2 text-[13px] text-[var(--text-muted)] hover:bg-[var(--toolbar-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

  return (
    <div className="mt-2 flex items-center gap-2">
      {/* LEFT: role + model */}
      <div className="flex min-w-0 items-center gap-1.5">
        <RoleSelector {...role} />
        <ModelSelector {...model} />
      </div>

      {/* spacer */}
      {!isMobile && <div className="flex-1" />}

      {/* RIGHT: tools + send */}
      <div className="relative flex shrink-0 items-center justify-end gap-1.5 ml-auto">
        <div className="flex items-center gap-1.5">
          {!isStreaming && onToolPresetChange && (
            <DropdownMenu open={toolOpen} onOpenChange={setToolOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isStreaming}
                  variant="ghost"
                  size="sm"
                  title={`${t("chat.changeToolPreset")}: ${toolPresetLabel}`}
                  aria-label={t("chat.changeToolPreset")}
                  className={`${iconBtn} gap-1.5 data-[state=open]:bg-[var(--toolbar-hover)]`}
                >
                  <Wrench size={11} className="shrink-0" />
                  <span className="whitespace-nowrap">{toolPresetLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="min-w-[140px] p-1">
                {TOOL_PRESETS.map((lvl) => {
                  const preset = TOOL_PRESET_MAP[lvl];
                  const isActive = (toolPreset ?? "default") === preset;
                  const desc = lvl === "off" ? t("chat.noTools") : lvl === "default" ? t("chat.builtInTools", { count: 4 }) : t("chat.allBuiltInTools");
                  return (
                    <DropdownMenuItem
                      key={lvl}
                      onSelect={() => { if (!isActive) onToolPresetChange(preset); }}
                      className={`gap-2 text-xs ${isActive ? "bg-[var(--bg-selected)] font-semibold text-[var(--text)] focus:bg-[var(--bg-selected)]" : "text-[var(--text-muted)]"}`}
                    >
                      {isActive
                        ? <Check size={10} strokeWidth={2} className="shrink-0 text-[var(--accent)]" />
                        : <span className="w-2.5 shrink-0" />}
                      <span className="flex-1">{lvl}</span>
                      <span className="ml-2 text-[11px] text-[var(--text-dim)]">{desc}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {attach && (
            <Button
              onClick={attach.onAttach}
              disabled={isStreaming}
              variant="ghost"
              size="sm"
              title={t("chat.attachImage")}
              className={cn("h-6 w-6 shrink-0 rounded-[9px] p-0", attach.count ? "text-[var(--accent)] hover:text-[var(--accent)]" : "text-[var(--text-muted)]")}
            >
              <ImagePlus size={15} strokeWidth={1.8} />
            </Button>
          )}
        </div>

        <SendButton
          isStreaming={isStreaming}
          canSend={canSend}
          onSend={onSend}
          onAbort={onAbort}
        />
      </div>
    </div>
  );
});
