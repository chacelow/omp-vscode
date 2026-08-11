"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import { acpRequest, hostCall } from "../../../bridge";
import {
  MODEL_ROLES,
  MODEL_ROLE_IDS,
  THINKING_LEVELS,
  type ModelRole,
} from "../../lib/model-roles";

type Assignment = { model: string; thinking: string };
type ModelOption = { provider: string; id: string; label: string };

function parseAssignment(value: unknown): Assignment {
  if (typeof value === "object" && value !== null && "provider" in value && "modelId" in value) {
    const assignment = value as { provider: unknown; modelId: unknown; thinkingLevel?: unknown };
    if (typeof assignment.provider === "string" && typeof assignment.modelId === "string") {
      return {
        model: `${assignment.provider}/${assignment.modelId}`,
        thinking: typeof assignment.thinkingLevel === "string" ? assignment.thinkingLevel : "auto",
      };
    }
  }

  if (typeof value !== "string") return { model: "", thinking: "auto" };
  const separator = value.lastIndexOf(":");
  const possibleLevel = separator === -1 ? "" : value.slice(separator + 1);
  if (THINKING_LEVELS.some((level) => level.value === possibleLevel)) {
    return { model: value.slice(0, separator), thinking: possibleLevel };
  }
  return { model: value, thinking: "auto" };
}

function toModelOptions(modelList: unknown): ModelOption[] {
  if (Array.isArray(modelList)) {
    return modelList.flatMap((entry): ModelOption[] => {
      if (!entry || typeof entry !== "object") return [];
      const model = entry as { provider?: unknown; id?: unknown; name?: unknown };
      if (typeof model.provider !== "string" || typeof model.id !== "string") return [];
      return [{ provider: model.provider, id: model.id, label: typeof model.name === "string" ? model.name : model.id }];
    });
  }

  if (!modelList || typeof modelList !== "object") return [];
  return Object.entries(modelList as Record<string, unknown>).flatMap(([selector, label]): ModelOption[] => {
    const slash = selector.indexOf("/");
    if (slash < 1 || slash === selector.length - 1) return [];
    return [{ provider: selector.slice(0, slash), id: selector.slice(slash + 1), label: typeof label === "string" ? label : selector.slice(slash + 1) }];
  });
}

export function ModelRolesPanel({ cwd, sessionId }: { cwd: string; sessionId?: string | null }): JSX.Element {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [assignments, setAssignments] = useState<Record<ModelRole, Assignment>>(() => Object.fromEntries(
    MODEL_ROLE_IDS.map((role) => [role, { model: "", thinking: "auto" }]),
  ) as Record<ModelRole, Assignment>);

  useEffect(() => {
    let mounted = true;
    void Promise.all([hostCall("modelsGet", { cwd }), hostCall("settingsList" as never, {} as never) as Promise<{ values: Record<string, unknown> }>])
      .then(([modelsResult, settingsResult]) => {
        if (!mounted) return;
        setModels(toModelOptions(modelsResult.modelList));
        setAssignments(Object.fromEntries(MODEL_ROLE_IDS.map((role) => {
          const hostAssignment = modelsResult.modelRoles[role];
          const fallback = settingsResult.values[`modelRoles.${role}`];
          return [role, parseAssignment(hostAssignment ?? fallback)];
        })) as Record<ModelRole, Assignment>);
      })
      .catch(() => {
        if (!mounted) return;
        setModels([]);
      });
    return () => { mounted = false; };
  }, [cwd]);

  const modelGroups = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [models]);

  const save = (role: ModelRole, next: Assignment) => {
    setAssignments((previous) => ({ ...previous, [role]: next }));
    if (!next.model) return;
    const value = `${next.model}${next.thinking !== "auto" ? `:${next.thinking}` : ""}`;
    if (role === "default" && sessionId) {
      void acpRequest({ type: "acp/setConfigOption", sessionId, configId: "model", value });
      return;
    }
    void hostCall("settingsSet", { category: "modelRoles", key: role, value });
  };

  if (models.length === 0) {
    return <p style={{ margin: 0, padding: 16, color: "var(--text-dim)", fontSize: 13 }}>Configure a provider first.</p>;
  }

  return <div style={{ color: "var(--text)", background: "var(--bg)", width: "100%" }}>
    {MODEL_ROLE_IDS.map((role) => {
      const info = MODEL_ROLES[role];
      const assignment = assignments[role];
      return <div key={role} style={{ display: "grid", gridTemplateColumns: "minmax(130px, 1fr) minmax(180px, 2fr) minmax(120px, 1fr)", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
        <div><span style={{ display: "block", color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>{info.tag}</span><strong style={{ fontSize: 13 }}>{info.name}</strong></div>
        <select aria-label={`${info.name} model`} value={assignment.model} onChange={(event) => save(role, { ...assignment, model: event.target.value })} style={{ minWidth: 0, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)" }}>
          <option value="">Select a model</option>
          {modelGroups.map(([provider, providerModels]) => <optgroup key={provider} label={provider}>{providerModels.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.label}</option>)}</optgroup>)}
        </select>
        <select aria-label={`${info.name} thinking level`} value={assignment.thinking} onChange={(event) => save(role, { ...assignment, thinking: event.target.value })} style={{ minWidth: 0, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)" }}>
          {THINKING_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
        </select>
      </div>;
    })}
  </div>;
}
