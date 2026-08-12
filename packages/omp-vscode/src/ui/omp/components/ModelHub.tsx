"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GripVertical, X } from "lucide-react";
import { acpRequest } from "../../bridge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const ROLES = ["default", "fast", "plan", "advisor"] as const;
const LEVELS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
const MRU_KEY = "omp.mruModels";
const ROLE_KEY = "omp.roles";
const CYCLE_KEY = "omp.modelCycle";
const FALLBACK_KEY = "omp.modelFallbackChain";
type Role = (typeof ROLES)[number];
type Model = {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
};
type Assignment = {
  role: string;
  provider: string;
  modelId: string;
  thinkingLevel?: string;
};
type Assignments = Record<Role, Assignment | null>;

/**
 * Persisted browser model preferences:
 * `omp.mruModels` stores up to ten `{ provider, modelId }` values;
 * `omp.roles` stores `{ role, provider, modelId, thinkingLevel? }[]`;
 * `omp.modelCycle` stores ordered `provider/modelId` quick-switch values;
 * `omp.modelFallbackChain` stores the fallback chain as newline-delimited text.
 */
function loadObject<T>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "");
    return value !== null && typeof value === "object"
      ? (value as T)
      : fallback;
  } catch {
    return fallback;
  }
}
function keyFor(model: {
  provider: string;
  id?: string;
  modelId?: string;
}): string {
  return `${model.provider}/${model.id ?? model.modelId ?? ""}`;
}

export interface ModelHubProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  modelList: Model[];
  currentModel: { provider: string; modelId: string } | null;
  modelRoles: Record<
    string,
    { provider: string; modelId: string; thinkingLevel?: string }
  >;
  modelThinkingLevelMaps?: Record<string, Record<string, string | null>>;
  currentModeId?: string | null;
  onModelChanged?: (provider: string, modelId: string) => void;
}

export function ModelHub({
  open,
  onClose,
  sessionId,
  modelList,
  currentModel,
  modelRoles,
  modelThinkingLevelMaps,
  currentModeId,
  onModelChanged,
}: ModelHubProps) {
  const [assignments, setAssignments] = useState<Assignments>({
    default: null,
    fast: null,
    plan: null,
    advisor: null,
  });
  const [recent, setRecent] = useState<
    Array<{ provider: string; modelId: string }>
  >(() => loadObject(MRU_KEY, []));
  const [cycle, setCycle] = useState<string[]>(() => loadObject(CYCLE_KEY, []));
  const [fallback, setFallback] = useState(
    () => localStorage.getItem(FALLBACK_KEY) ?? ""
  );
  const dragIndex = useRef<number | null>(null);
  const byKey = useMemo(
    () => new Map(modelList.map((model) => [keyFor(model), model])),
    [modelList]
  );
  const groups = useMemo(() => {
    const result = new Map<string, Model[]>();
    for (const model of modelList)
      result.set(model.provider, [
        ...(result.get(model.provider) ?? []),
        model,
      ]);
    return [...result.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }, [modelList]);

  useEffect(() => {
    if (!open) return;
    const saved = loadObject<Assignment[]>(ROLE_KEY, []);
    const next = {} as Assignments;
    for (const role of ROLES) {
      const host = modelRoles[role];
      next[role] =
        saved.find((item) => item.role === role) ??
        (host ? { role, ...host } : null);
    }
    setAssignments(next);
  }, [modelRoles, open]);
  if (!open) return null;

  const persistAssignments = (next: Assignments): void => {
    setAssignments(next);
    localStorage.setItem(
      ROLE_KEY,
      JSON.stringify(ROLES.flatMap((role) => (next[role] ? [next[role]] : [])))
    );
  };
  const choose = async (model: Model, role?: Role): Promise<void> => {
    const updatedRecent = [
      { provider: model.provider, modelId: model.id },
      ...recent.filter((entry) => keyFor(entry) !== keyFor(model)),
    ].slice(0, 10);
    setRecent(updatedRecent);
    localStorage.setItem(MRU_KEY, JSON.stringify(updatedRecent));
    if (role)
      persistAssignments({
        ...assignments,
        [role]: {
          role,
          provider: model.provider,
          modelId: model.id,
          thinkingLevel: assignments[role]?.thinkingLevel,
        },
      });
    if ((role === "default" || !role) && sessionId) {
      await acpRequest({
        type: "acp/setConfigOption",
        sessionId,
        configId: "model",
        value: keyFor(model),
      });
      onModelChanged?.(model.provider, model.id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label="Model Hub"
    >
      <header className="flex h-12 items-center justify-between border-b border-[var(--border)] px-5">
        <div>
          <h2 className="text-sm font-semibold">Model Hub</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Configure model roles and quick switching
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close Model Hub"
        >
          <X size={16} />
        </Button>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-3">
        <section className="rounded-lg border border-[var(--border)] p-3">
          <h3 className="mb-3 text-xs font-semibold text-[var(--text-muted)] uppercase">
            Roles
          </h3>
          {ROLES.map((role) => (
            <div key={role} className="mb-3">
              <label
                className="block text-xs capitalize"
                htmlFor={`role-${role}`}
              >
                {role}
              </label>
              <select
                id={`role-${role}`}
                className="mt-1 h-8 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
                value={assignments[role] ? keyFor(assignments[role] ?? {}) : ""}
                onChange={(event) => {
                  const selected = byKey.get(event.target.value);
                  if (selected) void choose(selected, role);
                }}
              >
                <option value="">No model assigned</option>
                {modelList.map((model) => (
                  <option key={keyFor(model)} value={keyFor(model)}>
                    {model.provider} / {model.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${role} thinking level`}
                className="mt-1 h-7 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
                value={assignments[role]?.thinkingLevel ?? "auto"}
                onChange={(event) => {
                  const current = assignments[role];
                  if (current)
                    persistAssignments({
                      ...assignments,
                      [role]: {
                        ...current,
                        thinkingLevel:
                          event.target.value === "auto"
                            ? undefined
                            : event.target.value,
                      },
                    });
                }}
              >
                {LEVELS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </div>
          ))}
        </section>
        <section className="rounded-lg border border-[var(--border)] p-3">
          <h3 className="mb-3 text-xs font-semibold text-[var(--text-muted)] uppercase">
            Recent models
          </h3>
          {recent.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              Recent selections appear here.
            </p>
          ) : (
            recent.map((item) => {
              const model = byKey.get(keyFor(item));
              return (
                <button
                  type="button"
                  key={keyFor(item)}
                  onClick={() => model && void choose(model)}
                  className="flex w-full justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
                >
                  <span>{model?.name ?? item.modelId}</span>
                  <span className="text-[var(--text-muted)]">
                    {item.provider}
                  </span>
                </button>
              );
            })
          )}
        </section>
        <section className="rounded-lg border border-[var(--border)] p-3">
          <h3 className="mb-3 text-xs font-semibold text-[var(--text-muted)] uppercase">
            All models
          </h3>
          {groups.map(([provider, models]) => (
            <div key={provider} className="mb-3">
              <p className="text-[11px] font-semibold text-[var(--text-muted)]">
                {provider}
              </p>
              {models.map((model) => {
                const active =
                  currentModel?.provider === model.provider &&
                  currentModel.modelId === model.id;
                const recommendations = Object.values(
                  modelThinkingLevelMaps?.[`${model.provider}:${model.id}`] ??
                    {}
                ).filter(
                  (value): value is string =>
                    typeof value === "string" && value.length > 0
                );
                return (
                  <button
                    type="button"
                    key={keyFor(model)}
                    onClick={() => void choose(model)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-[var(--text-dim)]"}`}
                      title={active ? "Available and active" : "Available"}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {model.name}
                    </span>
                    {model.contextWindow ? (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {Math.round(model.contextWindow / 1000)}k
                      </span>
                    ) : null}
                    {recommendations.length > 0 ? (
                      <span className="text-[10px]">
                        {recommendations.join("–")}
                      </span>
                    ) : null}
                    {active || currentModeId?.includes("fast") ? (
                      <Check size={12} className="text-[var(--accent)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </section>
        <section className="rounded-lg border border-[var(--border)] p-3 lg:col-span-2">
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase">
            Quick-switch cycle
          </h3>
          <p className="mb-2 text-xs text-[var(--text-muted)]">
            Drag to reorder.
          </p>
          {cycle.map((value, index) => (
            <div
              key={value}
              draggable
              onDragStart={() => {
                dragIndex.current = index;
              }}
              onDragEnter={() => {
                const source = dragIndex.current;
                if (source === null || source === index) return;
                const next = [...cycle];
                const [item] = next.splice(source, 1);
                if (item) next.splice(index, 0, item);
                dragIndex.current = index;
                setCycle(next);
                localStorage.setItem(CYCLE_KEY, JSON.stringify(next));
              }}
              className="flex gap-2 rounded border border-[var(--border)] px-2 py-1 text-xs"
            >
              <GripVertical size={13} />
              {byKey.get(value)?.name ?? value}
            </div>
          ))}
          <Input
            aria-label="Add model to quick switch cycle"
            className="mt-2"
            placeholder="provider/model"
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                !byKey.has(event.currentTarget.value) ||
                cycle.includes(event.currentTarget.value)
              )
                return;
              const next = [...cycle, event.currentTarget.value];
              setCycle(next);
              localStorage.setItem(CYCLE_KEY, JSON.stringify(next));
              event.currentTarget.value = "";
            }}
          />
        </section>
        <section className="rounded-lg border border-[var(--border)] p-3">
          <label
            htmlFor="model-fallback"
            className="text-xs font-semibold text-[var(--text-muted)] uppercase"
          >
            Fallback chain
          </label>
          <textarea
            id="model-fallback"
            value={fallback}
            onChange={(event) => {
              setFallback(event.target.value);
              localStorage.setItem(FALLBACK_KEY, event.target.value);
            }}
            className="mt-2 h-28 w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-xs"
            placeholder="provider/model"
          />
        </section>
      </main>
    </div>
  );
}
