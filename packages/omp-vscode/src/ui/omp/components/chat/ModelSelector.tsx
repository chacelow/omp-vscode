import { useState, useRef, useEffect, useMemo, memo } from "react";
import { Bot, Check } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "../ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
  const [filter, setFilter] = useState("");

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
    <div className="relative min-w-0">
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setFilter("");
          if (o) onModelOpen?.();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isStreaming}
            title={modelOptions.length > 0 ? "Change model" : "No available models"}
            className="h-6 max-w-[180px] gap-1.5 overflow-hidden rounded-[9px] px-2 text-[13px] text-[var(--text-muted)] hover:bg-[var(--toolbar-hover)] hover:text-[var(--text)] data-[state=open]:bg-[var(--bg-hover)] data-[state=open]:text-[var(--text)]"
          >
            <Bot size={11} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {currentName ?? (modelOptions.length > 0 ? "Select model" : (modelError ? "No models" : "Loading…"))}
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <span
                  role="button"
                  title="Switch thinking effort"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                  }}
                  className={cn(
                    "ml-0.5 shrink-0 cursor-pointer font-mono text-[10px] text-[var(--text-dim)] opacity-80",
                  )}
                >
                  {thinkingLevel || "auto"}▾
                </span>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-auto min-w-[120px] p-1">
                {THINKING_LEVELS.map((level) => {
                  const active = thinkingLevel === level;
                  return (
                    <Button
                      key={level}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onThinkingLevelChange?.(level);
                      }}
                      className={cn(
                        "w-full justify-start gap-2 rounded-[7px] px-2.5 py-[5px] font-mono text-xs",
                        active
                          ? "bg-[var(--bg-selected)] text-[var(--text)] hover:bg-[var(--bg-selected)]"
                          : "text-[var(--text-muted)]",
                      )}
                    >
                      {level}
                    </Button>
                  );
                })}
              </PopoverContent>
            </Popover>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="max-w-[min(60vw,420px)] p-1">
          {showFilter && (
            <div className="px-1 pb-1.5">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("chat.filterModels") || "Filter models"}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="h-7 min-w-[220px] font-mono text-[11px]"
              />
            </div>
          )}
          <div className="max-h-[min(40vh,320px)] overflow-y-auto">
            {modelsByProvider.length === 0 ? (
              <div className="px-3 py-2 text-xs whitespace-nowrap text-[var(--text-dim)]">
                {filter.trim() ? "No matching models" : "No available models"}
              </div>
            ) : modelsByProvider.map((group, gi) => (
              <div key={group.provider}>
                {modelsByProvider.length > 1 && (
                  <DropdownMenuLabel className={cn(
                    "px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-dim)]",
                    gi > 0 && "border-t border-[var(--border)]",
                  )}>
                    {formatProviderName(group.provider)}
                  </DropdownMenuLabel>
                )}
                {group.options.map((opt) => {
                  const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                  return (
                    <DropdownMenuItem
                      key={`${opt.provider}:${opt.modelId}`}
                      onSelect={() => {
                        if (!isActive) onModelChange?.(opt.provider, opt.modelId);
                      }}
                      className={cn(
                        "gap-2 whitespace-nowrap px-3 py-[7px] text-xs",
                        isActive
                          ? "bg-[var(--bg-selected)] font-semibold text-[var(--text)] focus:bg-[var(--bg-selected)]"
                          : "text-[var(--text-muted)]",
                      )}
                    >
                      {isActive
                        ? <Check size={10} strokeWidth={2} className="shrink-0 text-[var(--accent)]" />
                        : <span className="w-2.5 shrink-0" />}
                      {opt.name}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
