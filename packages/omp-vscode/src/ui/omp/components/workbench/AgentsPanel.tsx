"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import { hostCall } from "../../../bridge";
import type { AgentDefinition, AgentDefinitionSummary } from "../../../../core/host/protocol";

type AgentRecord = Record<string, unknown>;
type AgentDraft = {
  name: string;
  description: string;
  model: string;
  tools: string;
  isolated: "no" | "worktree" | "copy";
};

const inputStyle = {
  width: "100%",
  padding: "4px 8px",
  border: "1px solid var(--vscode-input-border, var(--border))",
  borderRadius: 2,
  background: "var(--vscode-input-background, var(--bg))",
  color: "var(--vscode-input-foreground, var(--text))",
  fontFamily: "var(--vscode-font-family)",
  fontSize: 13,
  boxSizing: "border-box",
} as const;

const selectStyle = {
  ...inputStyle,
  border: "1px solid var(--vscode-dropdown-border, var(--border))",
  background: "var(--vscode-dropdown-background, var(--bg))",
  color: "var(--vscode-dropdown-foreground, var(--text))",
} as const;

function asRecord(value: unknown): AgentRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as AgentRecord)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolsValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tool): tool is string => typeof tool === "string") : [];
}

function draftFor(agent?: AgentDefinitionSummary): AgentDraft {
  const definition = asRecord(agent?.definition);
  const model = asRecord(definition.model);
  const isolated = definition.isolated;
  return {
    name: agent?.name ?? "",
    description: stringValue(definition.description),
    model: stringValue(model.default),
    tools: toolsValue(definition.tools).join(", "),
    isolated: isolated === "worktree" || isolated === "copy" ? isolated : "no",
  };
}

function definitionFor(base: unknown, draft: AgentDraft): AgentDefinition {
  const definition: AgentRecord = { ...asRecord(base) };
  definition.description = draft.description;
  definition.model = { ...asRecord(definition.model), default: draft.model.trim() };
  definition.tools = draft.tools
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  definition.isolated = draft.isolated;
  return definition as AgentDefinition;
}

function pathLabel(path: string): JSX.Element {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const isUserAgent = segments.includes("agent") && segments.includes("agents");
  return isUserAgent ? (
    <span style={{ padding: "1px 5px", borderRadius: 8, background: "var(--vscode-badge-background, var(--bg-hover))", color: "var(--vscode-badge-foreground, var(--text-muted))", fontSize: 10 }}>user</span>
  ) : (
    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontFamily: "var(--vscode-editor-font-family, ui-monospace)", fontSize: 10 }}>{path}</span>
  );
}

function AgentEditor({ draft, isNew, saving, onChange, onSave, onCancel }: {
  draft: AgentDraft;
  isNew: boolean;
  saving: boolean;
  onChange: (draft: AgentDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}): JSX.Element {
  const field = (key: keyof AgentDraft, value: string): void => onChange({ ...draft, [key]: value });
  return (
    <div onClick={(event) => event.stopPropagation()} style={{ display: "grid", gap: 10, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--vscode-settings-headerBorder, var(--border))" }}>
      {isNew ? <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>Name<input autoFocus value={draft.name} onChange={(event) => field("name", event.target.value)} style={inputStyle} /></label> : null}
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>Description<textarea value={draft.description} onChange={(event) => field("description", event.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></label>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>Model default<input value={draft.model} onChange={(event) => field("model", event.target.value)} placeholder="(inherit)" style={inputStyle} /></label>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>Tools <span style={{ fontSize: 11 }}>(comma-separated)</span><input value={draft.tools} onChange={(event) => field("tools", event.target.value)} style={inputStyle} /></label>
      <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>Isolation<select value={draft.isolated} onChange={(event) => field("isolated", event.target.value)} style={selectStyle}><option value="no">no</option><option value="worktree">worktree</option><option value="copy">copy</option></select></label>
      <div style={{ display: "flex", gap: 8 }}><button type="button" onClick={onSave} disabled={saving} style={{ padding: "5px 10px", border: "1px solid var(--vscode-button-border, transparent)", borderRadius: 2, background: "var(--vscode-button-background, var(--accent))", color: "var(--vscode-button-foreground, white)", cursor: saving ? "wait" : "pointer" }}>{saving ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel} disabled={saving} style={{ padding: "5px 10px", border: "1px solid var(--vscode-button-secondaryBorder, var(--border))", borderRadius: 2, background: "var(--vscode-button-secondaryBackground, transparent)", color: "var(--vscode-button-secondaryForeground, var(--text))", cursor: "pointer" }}>Cancel</button></div>
    </div>
  );
}

export function AgentsPanel({ cwd: _cwd }: { cwd: string }): JSX.Element {
  const [agents, setAgents] = useState<AgentDefinitionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [newAgent, setNewAgent] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const response = await hostCall("agentsList", {});
      setAgents(response.agents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load custom agents");
      setAgents([]);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const closeEditor = (): void => { setSelectedName(null); setNewAgent(false); setDraft(null); };
  const openNew = (): void => { setSelectedName(null); setNewAgent(true); setDraft(draftFor()); setError(null); };
  const save = async (agent?: AgentDefinitionSummary): Promise<void> => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { setError("An agent name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      await hostCall("agentSave", { name, definition: definitionFor(agent?.definition, draft) });
      closeEditor();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save agent definition");
    } finally { setSaving(false); }
  };

  return <section aria-label="Custom agents" style={{ width: "100%", height: "100%", boxSizing: "border-box", overflow: "auto", padding: 20, color: "var(--text)" }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}><div><h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Custom agents</h2><p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-dim)" }}>Agent YAML definitions available to OMP.</p></div><button type="button" onClick={() => void reload()} aria-label="Reload agents" title="Reload agents" style={{ padding: "3px 7px", border: "1px solid var(--vscode-button-secondaryBorder, var(--border))", borderRadius: 2, background: "var(--vscode-button-secondaryBackground, transparent)", color: "var(--vscode-button-secondaryForeground, var(--text))", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>↻</button></header>
    {error ? <p role="alert" style={{ margin: "0 0 12px", color: "var(--vscode-errorForeground, #f48771)", fontSize: 12 }}>{error}</p> : null}
    {agents === null ? <p style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading…</p> : null}
    {agents?.length === 0 ? <div style={{ padding: 16, border: "1px solid var(--vscode-settings-headerBorder, var(--border))", color: "var(--text-muted)" }}><strong style={{ display: "block", color: "var(--text)", fontSize: 13 }}>No custom agents</strong><p style={{ margin: "6px 0 12px", fontSize: 12, lineHeight: 1.5 }}>Agent YAMLs live at <code>~/.omp/agent/agents/*.yml</code>. Create one here to add it to OMP.</p><button type="button" onClick={openNew} style={{ padding: "5px 10px", border: "1px solid var(--vscode-button-border, transparent)", borderRadius: 2, background: "var(--vscode-button-background, var(--accent))", color: "var(--vscode-button-foreground, white)", cursor: "pointer" }}>Copy example template</button></div> : null}
    <div style={{ display: "grid", gap: 8 }}>{agents?.map((agent) => { const definition = asRecord(agent.definition); const model = asRecord(definition.model); const expanded = selectedName === agent.name && !newAgent; return <article key={agent.path} style={{ padding: "12px 14px", border: "1px solid var(--vscode-settings-headerBorder, var(--border))", background: "var(--vscode-settings-dropdownBackground, var(--bg-panel))", borderRadius: 2 }}><button type="button" onClick={() => { if (expanded) closeEditor(); else { setSelectedName(agent.name); setNewAgent(false); setDraft(draftFor(agent)); setError(null); } }} aria-expanded={expanded} style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left" }}><div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><strong style={{ fontSize: 13 }}>{agent.name}</strong>{pathLabel(agent.path)}</div>{stringValue(definition.description) ? <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{stringValue(definition.description)}</p> : null}<p style={{ margin: "7px 0 0", fontSize: 12, color: "var(--text-dim)" }}>model = {stringValue(model.default) || "(inherit)"} · tools = {toolsValue(definition.tools).length} · isolation = {definition.isolated === "worktree" || definition.isolated === "copy" ? definition.isolated : "no"}</p></button>{expanded && draft ? <AgentEditor draft={draft} isNew={false} saving={saving} onChange={setDraft} onSave={() => void save(agent)} onCancel={closeEditor} /> : null}</article>; })}</div>
    <div style={{ marginTop: 12 }}>{newAgent && draft ? <article style={{ padding: "12px 14px", border: "1px solid var(--vscode-settings-headerBorder, var(--border))", background: "var(--vscode-settings-dropdownBackground, var(--bg-panel))", borderRadius: 2 }}><strong style={{ fontSize: 13 }}>New agent</strong><AgentEditor draft={draft} isNew saving={saving} onChange={setDraft} onSave={() => void save()} onCancel={closeEditor} /></article> : <button type="button" onClick={openNew} style={{ padding: "5px 10px", border: "1px solid var(--vscode-button-secondaryBorder, var(--border))", borderRadius: 2, background: "var(--vscode-button-secondaryBackground, transparent)", color: "var(--vscode-button-secondaryForeground, var(--text))", cursor: "pointer" }}>New agent</button>}</div>
  </section>;
}
