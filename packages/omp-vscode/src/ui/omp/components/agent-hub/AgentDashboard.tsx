import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { acpRequest, hostCall } from "../../../bridge";
import type {
  AgentDefinition,
  AgentDefinitionSummary,
} from "../../../../core/host/protocol";

interface Props {
  cwd: string;
  sessionId: string | null;
  agents: AgentDefinitionSummary[];
  definitionsLoaded: boolean;
  onDefinitionsChanged: () => Promise<void>;
}

function editableDefinition(definition: AgentDefinition): {
  model: string;
  tools: string;
  instructions: string;
} {
  return {
    model: typeof definition.model === "string" ? definition.model : "",
    tools: Array.isArray(definition.tools)
      ? definition.tools
          .filter((tool): tool is string => typeof tool === "string")
          .join(", ")
      : "",
    instructions:
      typeof definition.instructions === "string"
        ? definition.instructions
        : "",
  };
}

export function AgentDashboard({
  cwd,
  sessionId,
  agents,
  definitionsLoaded,
  onDefinitionsChanged,
}: Props) {
  const [selected, setSelected] = useState<AgentDefinitionSummary | null>(null);
  const [draft, setDraft] = useState({
    model: "",
    tools: "",
    instructions: "",
  });
  const [name, setName] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);

  const select = (agent: AgentDefinitionSummary) => {
    setSelected(agent);
    setName(agent.name);
    setDraft(editableDefinition(agent.definition));
    setSavedPath(null);
  };

  const save = async () => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("An agent name is required.");
      return;
    }
    try {
      const definition: AgentDefinition = {
        ...selected?.definition,
        ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
        tools: draft.tools
          .split(",")
          .map((tool) => tool.trim())
          .filter((tool) => tool.length > 0),
        instructions: draft.instructions,
      };
      const result = await hostCall("agentSave", {
        name: normalizedName,
        definition,
      });
      setSavedPath(result.path);
      setError(null);
      await onDefinitionsChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save agent definition"
      );
    }
  };

  const generate = async () => {
    if (!sessionId || !brief.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      await acpRequest({
        type: "acp/prompt",
        sessionId,
        prompt: [
          {
            type: "text",
            text: `Design an agent definition for: ${brief.trim()}. Reply as YAML.`,
          },
        ],
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to request an agent definition"
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col border-t border-[var(--border)] bg-[var(--bg-panel)]"
      aria-label="Agent dashboard"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-xs font-semibold">Agent definitions</span>
        <button
          type="button"
          className="rounded p-1 hover:bg-[var(--bg-hover)]"
          aria-label="Create agent definition"
          onClick={() => {
            setSelected(null);
            setName("");
            setDraft({ model: "", tools: "", instructions: "" });
            setSavedPath(null);
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[120px_minmax(0,1fr)]">
        <div className="overflow-y-auto border-r border-[var(--border)]">
          {agents.map((agent) => (
            <button
              key={agent.path}
              type="button"
              onClick={() => select(agent)}
              className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-[var(--bg-hover)]"
            >
              {agent.name}
            </button>
          ))}
          {definitionsLoaded && agents.length === 0 && (
            <p className="p-3 text-xs text-[var(--text-muted)]">
              No agent definitions found. Create YAML files in
              ~/.omp/agent/agents/.
            </p>
          )}
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-3 text-xs">
          <label className="block">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
            />
          </label>
          <label className="block">
            Model
            <input
              value={draft.model}
              onChange={(event) =>
                setDraft((value) => ({ ...value, model: event.target.value }))
              }
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
            />
          </label>
          <label className="block">
            Tools{" "}
            <span className="text-[var(--text-muted)]">(comma-separated)</span>
            <input
              value={draft.tools}
              onChange={(event) =>
                setDraft((value) => ({ ...value, tools: event.target.value }))
              }
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
            />
          </label>
          <label className="block">
            Instructions
            <textarea
              value={draft.instructions}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  instructions: event.target.value,
                }))
              }
              className="mt-1 min-h-24 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
            />
          </label>
          <button
            type="button"
            onClick={() => void save()}
            className="flex items-center gap-1 rounded bg-[var(--accent)] px-2 py-1 text-xs text-white"
          >
            <Save size={12} />
            Save
          </button>
          {savedPath && (
            <p className="break-all text-[var(--text-muted)]">
              Saved: {savedPath}
            </p>
          )}
          <div className="border-t border-[var(--border)] pt-3">
            <label className="block">
              Generate new
              <textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="Describe the agent you need"
                className="mt-1 min-h-14 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1"
              />
            </label>
            <button
              type="button"
              disabled={!sessionId || generating || !brief.trim()}
              onClick={() => void generate()}
              className="mt-2 rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
            >
              {generating ? "Requesting…" : "Generate in chat"}
            </button>
            <p className="mt-1 text-[var(--text-muted)]">
              The YAML reply appears in the selected session; paste its fields
              above, then Save.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-red-500">
              {error}
            </p>
          )}
          <p className="text-[var(--text-muted)]">Project: {cwd}</p>
        </div>
      </div>
    </section>
  );
}
