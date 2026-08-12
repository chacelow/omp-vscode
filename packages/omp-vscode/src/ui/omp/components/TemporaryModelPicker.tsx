"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Model = { provider: string; modelId: string; name: string };

export interface TemporaryModelPickerProps {
  open: boolean;
  onClose: () => void;
  currentModel?: { provider: string; modelId: string } | null;
  modelList?: Model[];
  onSelect?: (model: { provider: string; modelId: string }) => void;
}

export function TemporaryModelPicker({
  open,
  onClose,
  currentModel = null,
  modelList = [],
  onSelect,
}: TemporaryModelPickerProps) {
  const [filter, setFilter] = useState("");
  const filteredModels = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return modelList;
    return modelList.filter((model) =>
      `${model.provider} ${model.name} ${model.modelId}`
        .toLocaleLowerCase()
        .includes(query)
    );
  }, [filter, modelList]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[101] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Temporary model picker"
    >
      <div className="flex max-h-[min(620px,90vh)] w-full max-w-lg flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-xl">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Temporary model</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Used for the next turn, then restored.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close temporary model picker"
          >
            <X size={16} />
          </Button>
        </header>
        <div className="p-3">
          <Input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter models"
            aria-label="Filter temporary models"
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-2 pb-3">
          {filteredModels.map((model) => {
            const selected =
              currentModel?.provider === model.provider &&
              currentModel.modelId === model.modelId;
            return (
              <button
                type="button"
                key={`${model.provider}/${model.modelId}`}
                onClick={() => {
                  onSelect?.({
                    provider: model.provider,
                    modelId: model.modelId,
                  });
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[var(--bg-hover)]"
              >
                <span className="w-4">
                  {selected ? (
                    <Check size={14} className="text-[var(--accent)]" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{model.name}</span>
                <span className="truncate text-xs text-[var(--text-muted)]">
                  {model.provider}
                </span>
              </button>
            );
          })}
          {filteredModels.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
              No matching models.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
export default TemporaryModelPicker;
