import { useState, useRef, useEffect, memo } from "react";
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

  const iconBtn = "flex h-6 items-center justify-center rounded-[9px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50 disabled:hover:bg-transparent";

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
          <button
            type="button"
            title={menuOpen ? undefined : t("chat.moreControls")}
            aria-label={t("chat.moreControls")}
            aria-expanded={menuOpen}
            aria-hidden={menuOpen || undefined}
            tabIndex={menuOpen ? -1 : undefined}
            onClick={() => setMenuOpen(true)}
            className={`${iconBtn} px-2.5 text-xs font-medium ${menuOpen ? "pointer-events-none invisible" : ""}`}
          >
            {t("chat.moreControls")}
          </button>
        )}
        <div
          className={`flex items-center ${isMobile ? "absolute right-0 bottom-0 z-[60] w-max max-w-[calc(100vw-32px)] gap-0.5 rounded-[10px] border border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_92%,var(--bg))] p-px shadow-[0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur-[10px]" : "gap-0.5"} ${isMobile && !menuOpen ? "hidden" : "flex"}`}
        >
          {!isStreaming && onToolPresetChange && (
            <div ref={toolRef} className="relative">
              <button
                onClick={() => setToolOpen((v) => !v)}
                disabled={isStreaming}
                title={`${t("chat.changeToolPreset")}: ${toolPresetLabel}`}
                aria-label={t("chat.changeToolPreset")}
                className={`${iconBtn} flex items-center gap-1.5 disabled:cursor-not-allowed ${toolOpen ? "bg-[var(--bg-hover)]" : ""}`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                {(!isMobile || menuOpen) && <span className="whitespace-nowrap">{toolPresetLabel}</span>}
              </button>
              {toolOpen && (
                <div className="absolute right-0 bottom-[calc(100%+6px)] z-[100] min-w-[120px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-[0_-4px_16px_rgba(0,0,0,0.10)]">
                  {TOOL_PRESETS.map((lvl) => {
                    const preset = TOOL_PRESET_MAP[lvl];
                    const isActive = (toolPreset ?? "default") === preset;
                    const desc = lvl === "off" ? t("chat.noTools") : lvl === "default" ? t("chat.builtInTools", { count: 4 }) : t("chat.allBuiltInTools");
                    return (
                      <button
                        key={lvl}
                        onClick={() => { setToolOpen(false); if (!isActive) onToolPresetChange(preset); }}
                        className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-[7px] text-left text-xs ${
                          isActive ? "bg-[var(--bg-selected)] font-semibold text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        {isActive
                          ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                          : <span className="w-2.5 shrink-0" />}
                        <span className="flex-1">{lvl}</span>
                        <span className="ml-2 text-[11px] text-[var(--text-dim)]">{desc}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {attach && (
            <button
              onClick={attach.onAttach}
              disabled={isStreaming}
              title={t("chat.attachImage")}
              className={`${iconBtn} h-[26px] w-[26px] ${attach.count ? "text-[var(--accent)] hover:text-[var(--accent)]" : ""} disabled:cursor-not-allowed`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          )}

          {!isStreaming && onCompact && (
            <button
              onClick={isCompacting ? onAbortCompaction : onCompact}
              disabled={isStreaming && !isCompacting}
              title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
              aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
              className={`${iconBtn} flex items-center gap-1.5 disabled:cursor-not-allowed ${
                isCompacting ? "bg-[#ef4444]/8 text-[#ef4444] hover:bg-[#ef4444]/15 hover:text-[#ef4444]" : ""
              }`}
            >
              {isCompacting ? (
                <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>{(!isMobile || menuOpen) && <span className="whitespace-nowrap">{t("chat.compacting")}</span>}</>
              ) : (
                <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                  <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                </svg>{(!isMobile || menuOpen) && <span className="whitespace-nowrap">{t("chat.compact")}</span>}</>
              )}
            </button>
          )}

          {onSoundToggle !== undefined && (
            <button
              onClick={onSoundToggle}
              title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
              aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
              className={`${iconBtn} w-8 ${soundEnabled ? "" : "opacity-55"}`}
            >
              {soundEnabled ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              )}
            </button>
          )}

          {isMobile && menuOpen && (
            <button
              type="button"
              title={t("chat.collapseControls")}
              aria-label={t("chat.collapseControls")}
              aria-expanded={true}
              onClick={() => { setToolOpen(false); setMenuOpen(false); }}
              className="flex h-6 w-9 items-center justify-center rounded-r-[9px] border-l border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[var(--bg-hover)] text-[var(--text)] transition-colors hover:bg-[var(--bg-selected)]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
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
