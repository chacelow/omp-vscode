import { useState, useRef, useMemo, memo } from "react";

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
    <div ref={dropdownRef} style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
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
        style={{
          display: "flex", alignItems: "center", gap: 6,
          justifyContent: isMobile ? "flex-start" : undefined,
          padding: isMobile ? "6px 8px" : "5px 8px",
          height: 24,
          width: isMobile ? "100%" : undefined,
          maxWidth: isMobile ? "100%" : 220,
          overflow: "hidden",
          background: open ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 9,
          color: "var(--text-muted)",
          cursor: isStreaming ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: isStreaming ? 0.5 : 1,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          if (isStreaming) return;
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = open ? "var(--bg-hover)" : "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
        title={modelOptions.length > 0 ? "Change model" : "No available models"}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {currentName ?? (modelOptions.length > 0 ? "Select model" : (modelError ? "No models" : "Loading…"))}
        </span>
        <span
          role="button"
          title="Switch thinking effort"
          onClick={(e) => {
            e.stopPropagation();
            setThinkingOpen((o) => !o);
          }}
          style={{ fontSize: 10, color: "var(--text-dim)", opacity: 0.8, fontFamily: "var(--font-mono)", flexShrink: 0, marginLeft: 2, cursor: "pointer", textDecoration: thinkingOpen ? "underline" : "none" }}
        >
          {thinkingLevel || "auto"}▾
        </span>
      </button>

      {thinkingOpen && (
        <div
          ref={thinkingRef}
          style={{
            position: "absolute", bottom: "100%", right: 0, marginBottom: 4,
            minWidth: 120, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)", zIndex: 1001, padding: 4,
          }}
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
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "5px 10px", border: "none", borderRadius: 7,
                  background: active ? "var(--bg-selected)" : "none",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "left",
                }}
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
            position: "fixed", top: rect.top - 4, left: rect.left,
            width: "max-content", minWidth: rect.width,
            maxHeight: Math.max(120, Math.min(rect.top - 8, (window.visualViewport?.height ?? window.innerHeight) * 0.6)),
            overflowY: "auto",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)", zIndex: 1000, padding: 4,
            display: "flex", flexDirection: "column",
          }}
        >
          {showFilter && (
            <div style={{ padding: "0 4px 6px" }}>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("chat.filterModels") || "Filter models"}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%", minWidth: isMobile ? 0 : 220,
                  fontSize: 11, fontFamily: "var(--font-mono)",
                  padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 5,
                  outline: "none", background: "var(--bg)", color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}
          <div style={{ minHeight: 0, overflowY: "auto" }}>
            {modelsByProvider.length === 0 ? (
              <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: 12, whiteSpace: "nowrap" }}>
                {filter.trim() ? "No matching models" : "No available models"}
              </div>
            ) : modelsByProvider.map((group, gi) => (
              <div key={group.provider}>
                {modelsByProvider.length > 1 && (
                  <div style={{
                    padding: "6px 12px 4px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                    textTransform: "uppercase", letterSpacing: "0.07em",
                    borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                  }}>
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
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "7px 12px",
                        background: isActive ? "var(--bg-selected)" : "none",
                        border: "none",
                        color: isActive ? "var(--text)" : "var(--text-muted)",
                        cursor: "pointer", fontSize: 12, textAlign: "left",
                        fontWeight: isActive ? 600 : 400,
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                    >
                      {isActive
                        ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                        : <span style={{ width: 10, flexShrink: 0 }} />}
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
