import { useState, useRef, useMemo, memo } from "react";
import { Grid3x3, Check } from "lucide-react";

// Model selector: current model button + searchable provider-grouped list.
// The effort label next to the model name opens the thinking-level picker.

const MODEL_FILTER_THRESHOLD = 8;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

function formatProviderName(provider: string): string {
  const clean = provider.includes(":") ? provider.split(":")[0] : provider;
  if (clean.includes("/")) {
    const parts = clean.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? clean;
  }
  return clean.replace(/-/g, " ");
}

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return (a.name || a.modelId).localeCompare(b.name || b.modelId)
    || a.provider.localeCompare(b.provider)
    || a.modelId.localeCompare(b.modelId);
}

function filterModelOptions(options: ModelOption[], query: string): ModelOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) =>
    o.modelId.toLowerCase().includes(q)
    || o.name.toLowerCase().includes(q)
    || o.provider.toLowerCase().includes(q),
  );
}

export interface ModelSelectorProps {
  model?: { provider: string; modelId: string } | null;
  modelList?: Array<{ id: string; name: string; provider: string }>;
  modelNames?: Record<string, string>;
  modelError?: string | null;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isMobile?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  onModelOpen?: () => void;
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  t: (key: string) => string;
}

export const ModelSelector = memo(function ModelSelector({
  model, modelList, modelNames, modelError, thinkingLevel, isStreaming, isMobile,
  onModelChange, onModelOpen, onThinkingLevelChange, t,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);

  const modelOptions = useMemo<ModelOption[]>(() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    })).sort(compareModelOptions);
  }, [modelList, modelNames, model]);

  const filtered = filterModelOptions(modelOptions, filter);
  const showFilter = modelOptions.length > MODEL_FILTER_THRESHOLD;

  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of filtered) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const currentName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;

  return (
    <div ref={dropdownRef} className={`relative min-w-0 ${isMobile ? "flex-1" : ""}`}>
      <button
        onClick={(e) => {
          if (isStreaming) return;
          onModelOpen?.();
          const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setRect({ top: el.top, left: el.left, width: el.width });
          setOpen((o) => {
            if (o) setFilter("");
            return !o;
          });
        }}
        disabled={isStreaming}
        title={modelOptions.length > 0 ? "Change model" : "No available models"}
        className={`flex h-6 items-center gap-1.5 overflow-hidden rounded-[9px] text-xs text-[var(--text-muted)] transition-colors ${
          isMobile ? "w-full max-w-full justify-start px-2 py-1.5" : "max-w-[220px] px-2 py-[5px]"
        } ${open ? "bg-[var(--bg-hover)]" : ""} ${
          isStreaming ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        }`}
      >
        <Grid3x3 size={11} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {currentName ?? (modelOptions.length > 0 ? "Select model" : (modelError ? "No models" : "Loading…"))}
        </span>
        <span
          role="button"
          title="Switch thinking effort"
          onClick={(e) => {
            e.stopPropagation();
            setThinkingOpen((o) => !o);
          }}
          className={`ml-0.5 shrink-0 cursor-pointer font-mono text-[10px] text-[var(--text-dim)] opacity-80 ${thinkingOpen ? "underline" : ""}`}
        >
          {thinkingLevel || "auto"}▾
        </span>
      </button>

      {thinkingOpen && (
        <div
          ref={thinkingRef}
          className="absolute bottom-full right-0 z-[1001] mb-1 min-w-[120px] rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          {THINKING_LEVELS.map((level) => {
            const active = thinkingLevel === level;
            return (
              <button
                key={level}
                onClick={() => {
                  onThinkingLevelChange?.(level);
                  setThinkingOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[5px] text-left font-mono text-xs ${
                  active
                    ? "bg-[var(--bg-selected)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>
      )}

      {open && rect && (
        <div
          style={{
            position: "fixed",
            bottom: (window.visualViewport?.height ?? window.innerHeight) - rect.top + 6,
            left: rect.left,
            width: "max-content", minWidth: rect.width,
            maxHeight: Math.max(120, Math.min(rect.top - 8, (window.visualViewport?.height ?? window.innerHeight) * 0.6)),
          }}
          className="z-[1000] flex flex-col overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          {showFilter && (
            <div className="px-1 pb-1.5">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("chat.filterModels") || "Filter models"}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className={`w-full rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-2 py-[5px] font-mono text-[11px] text-[var(--text)] outline-none ${
                  isMobile ? "" : "min-w-[220px]"
                }`}
                style={{ boxSizing: "border-box" }}
              />
            </div>
          )}
          <div className="min-h-0 overflow-y-auto">
            {modelsByProvider.length === 0 ? (
              <div className="whitespace-nowrap px-3 py-2 text-xs text-[var(--text-dim)]">
                {filter.trim() ? "No matching models" : "No available models"}
              </div>
            ) : modelsByProvider.map((group, gi) => (
              <div key={group.provider}>
                {modelsByProvider.length > 1 && (
                  <div className={`px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-dim)] ${gi > 0 ? "border-t border-[var(--border)]" : ""}`}>
                    {formatProviderName(group.provider)}
                  </div>
                )}
                {group.options.map((opt) => {
                  const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                  return (
                    <button
                      key={`${opt.provider}:${opt.modelId}`}
                      onClick={() => {
                        setOpen(false);
                        setFilter("");
                        if (!isActive) onModelChange?.(opt.provider, opt.modelId);
                      }}
                      className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-[7px] text-left text-xs ${
                        isActive
                          ? "bg-[var(--bg-selected)] font-semibold text-[var(--text)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      {isActive
                        ? <Check size={10} strokeWidth={2} className="shrink-0 text-[var(--accent)]" />
                        : <span className="w-2.5 shrink-0" />}
                      {opt.name}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
