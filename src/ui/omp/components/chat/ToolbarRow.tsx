import { useState, useRef, useEffect, memo } from "react";
import { Wrench, Check, ImagePlus, Square, Shrink, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "../ui/button";
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
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  canSend: boolean;
  onSend: () => void;
  onAbort: () => void;
}

export const ToolbarRow = memo(function ToolbarRow({
  isMobile, isStreaming, t, role, model, attach,
  toolPreset, onToolPresetChange,
  onCompact, onAbortCompaction, isCompacting,
  soundEnabled, onSoundToggle,
  canSend, onSend, onAbort,
}: ToolbarRowProps) {
  const [toolOpen, setToolOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toolRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolRef.current && !toolRef.current.contains(e.target as Node)) setToolOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default";

  const iconBtn = "h-6 rounded-[9px] px-2 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

  return (
    <div className={`mt-2 flex items-center gap-1.5 ${isMobile ? "grid grid-cols-[minmax(0,1fr)_auto]" : ""}`}>
      {/* LEFT: role + model */}
      <div className={`flex min-w-0 items-center gap-0.5 ${isMobile ? "col-start-1" : ""}`}>
        <RoleSelector {...role} />
        <ModelSelector {...model} />
      </div>

      {/* spacer */}
      {!isMobile && <div className="flex-1" />}

      {/* RIGHT: tools + send */}
      <div
        ref={menuRef}
        className={`relative flex shrink-0 items-center justify-end ${isMobile ? "col-start-2" : "ml-auto"}`}
      >
        {isMobile && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={menuOpen ? undefined : t("chat.moreControls")}
            aria-label={t("chat.moreControls")}
            aria-expanded={menuOpen}
            aria-hidden={menuOpen || undefined}
            tabIndex={menuOpen ? -1 : undefined}
            onClick={() => setMenuOpen(true)}
            className={`${iconBtn} font-medium ${menuOpen ? "pointer-events-none invisible" : ""}`}
          >
            {t("chat.moreControls")}
          </Button>
        )}
        <div
          className={`flex items-center ${isMobile ? "absolute right-0 bottom-0 z-[60] w-max max-w-[calc(100vw-32px)] gap-0.5 rounded-[10px] border border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_92%,var(--bg))] p-px shadow-[0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur-[10px]" : "gap-0.5"} ${isMobile && !menuOpen ? "hidden" : "flex"}`}
        >
          {!isStreaming && onToolPresetChange && (
            <div ref={toolRef} className="relative">
              <Button
                onClick={() => setToolOpen((v) => !v)}
                disabled={isStreaming}
                variant="ghost"
                size="sm"
                title={`${t("chat.changeToolPreset")}: ${toolPresetLabel}`}
                aria-label={t("chat.changeToolPreset")}
                className={`${iconBtn} gap-1.5 ${toolOpen ? "bg-[var(--bg-hover)]" : ""}`}
              >
                <Wrench size={11} className="shrink-0" />
                {(!isMobile || menuOpen) && <span className="whitespace-nowrap">{toolPresetLabel}</span>}
              </Button>
              {toolOpen && (
                <div className="absolute right-0 bottom-[calc(100%+6px)] z-[100] min-w-[120px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-[0_-4px_16px_rgba(0,0,0,0.10)]">
                  {TOOL_PRESETS.map((lvl) => {
                    const preset = TOOL_PRESET_MAP[lvl];
                    const isActive = (toolPreset ?? "default") === preset;
                    const desc = lvl === "off" ? t("chat.noTools") : lvl === "default" ? t("chat.builtInTools", { count: 4 }) : t("chat.allBuiltInTools");
                    return (
                      <Button
                        key={lvl}
                        variant="ghost"
                        size="sm"
                        onClick={() => { setToolOpen(false); if (!isActive) onToolPresetChange(preset); }}
                        className={`w-full justify-start gap-2 whitespace-nowrap rounded-none px-3 py-[7px] text-xs ${
                          isActive ? "bg-[var(--bg-selected)] font-semibold text-[var(--text)] hover:bg-[var(--bg-selected)]" : "text-[var(--text-muted)]"
                        }`}
                      >
                        {isActive
                          ? <Check size={10} strokeWidth={2} className="shrink-0 text-[var(--accent)]" />
                          : <span className="w-2.5 shrink-0" />}
                        <span className="flex-1">{lvl}</span>
                        <span className="ml-2 text-[11px] text-[var(--text-dim)]">{desc}</span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {attach && (
            <Button
              onClick={attach.onAttach}
              disabled={isStreaming}
              variant="ghost"
              size="icon"
              title={t("chat.attachImage")}
              className={`h-[26px] w-[26px] ${attach.count ? "text-[var(--accent)] hover:text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
            >
              <ImagePlus size={15} strokeWidth={1.8} />
            </Button>
          )}

          {!isStreaming && onCompact && (
            <Button
              onClick={isCompacting ? onAbortCompaction : onCompact}
              disabled={isStreaming && !isCompacting}
              variant="ghost"
              size="sm"
              title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
              aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
              className={`${iconBtn} gap-1.5 ${
                isCompacting ? "bg-[#ef4444]/8 text-[#ef4444] hover:bg-[#ef4444]/15 hover:text-[#ef4444]" : ""
              }`}
            >
              {isCompacting ? (
                <><Square size={10} fill="currentColor" />{(!isMobile || menuOpen) && <span className="whitespace-nowrap">{t("chat.compacting")}</span>}</>
              ) : (
                <><Shrink size={11} className="shrink-0" />{(!isMobile || menuOpen) && <span className="whitespace-nowrap">{t("chat.compact")}</span>}</>
              )}
            </Button>
          )}

          {onSoundToggle !== undefined && (
            <Button
              onClick={onSoundToggle}
              variant="ghost"
              size="icon"
              title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
              aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
              className={`h-6 w-8 ${soundEnabled ? "text-[var(--text-muted)]" : "opacity-55"}`}
            >
              {soundEnabled ? (
                <Volume2 size={12} />
              ) : (
                <VolumeX size={12} />
              )}
            </Button>
          )}

          {isMobile && menuOpen && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t("chat.collapseControls")}
              aria-label={t("chat.collapseControls")}
              aria-expanded={true}
              onClick={() => { setToolOpen(false); setMenuOpen(false); }}
              className="h-6 w-9 rounded-r-[9px] border-l border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[var(--bg-hover)] text-[var(--text)] hover:bg-[var(--bg-selected)]"
            >
              <X size={13} strokeWidth={2} />
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
