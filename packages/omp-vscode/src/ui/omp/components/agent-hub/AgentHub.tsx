import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { hostCall } from "../../../bridge";
import { ompExtensions, ompSessionsListAll, type OmpSessionSummary } from "@/lib/ext-methods";
import { AgentDashboard } from "./AgentDashboard";
import { AgentTranscriptViewer } from "./AgentTranscriptViewer";
import type { AgentDefinition, AgentDefinitionSummary } from "../../../../core/host/protocol";
interface HubSession {
  id: string;
  label: string;
  cwd: string;
  origin: "stored" | "live";
}

interface Props {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
}

function sessionFromNative(value: OmpSessionSummary): HubSession {
  return {
    id: value.sessionId,
    label: value.title ?? value.sessionId,
    cwd: value.cwd,
    origin: "live",
  };
}

function extensionAgent(value: unknown): AgentDefinitionSummary | null {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "agent" || !("name" in value) || typeof value.name !== "string") return null;
  const description = "description" in value && typeof value.description === "string" ? value.description : "";
  const path = "path" in value && typeof value.path === "string" ? value.path : `extension:${value.name}`;
  const definition: AgentDefinition = description ? { instructions: description } : {};
  return { name: value.name, definition, path };
}

export function AgentHub({ cwd, sessionId, onClose }: Props) {
  const [stored, setStored] = useState<HubSession[]>([]);
  const [live, setLive] = useState<HubSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinitionSummary[]>([]);
  const [definitionsLoaded, setDefinitionsLoaded] = useState(false);
  const [metrics, setMetrics] = useState({ messages: 0, inputTokens: 0, outputTokens: 0, cost: 0 });

  const loadAgentDefinitions = useCallback(async () => {
    const [disk, extensions] = await Promise.allSettled([hostCall("agentsList", {}), ompExtensions(cwd)]);
    const diskAgents = disk.status === "fulfilled" ? disk.value.agents : [];
    const extensionAgents = extensions.status === "fulfilled"
      ? extensions.value.extensions.map(extensionAgent).filter((agent): agent is AgentDefinitionSummary => agent !== null)
      : [];
    const paths = new Set(diskAgents.map((agent) => agent.path));
    setAgentDefinitions([...diskAgents, ...extensionAgents.filter((agent) => !paths.has(agent.path))]);
    setDefinitionsLoaded(true);
  }, [cwd]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [disk, native] = await Promise.allSettled([hostCall("sessionsList", {}), ompSessionsListAll(100)]);
      if (!active) return;
      if (disk.status === "fulfilled") {
        setStored(disk.value.sessions.map((entry) => ({ id: entry.id, label: entry.name || entry.id, cwd: entry.cwd, origin: "stored" })));
      }
      if (native.status === "fulfilled") {
        setLive(native.value.sessions.map(sessionFromNative));
      }
      if (disk.status === "rejected" && native.status === "rejected") setError("Unable to load agent sessions.");
    };
    void load();
    void loadAgentDefinitions();
    return () => { active = false; };
  }, [loadAgentDefinitions]);

  const sessions = useMemo(() => {
    const seen = new Set<string>();
    return [...live, ...stored].filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    });
  }, [live, stored]);

  const selected = selectedId ?? sessionId ?? sessions[0]?.id ?? null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Agent Hub" className="fixed inset-0 z-50 flex bg-[var(--bg)]">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2"><strong className="text-sm">Agent Hub</strong><button type="button" onClick={onClose} aria-label="Close Agent Hub" className="rounded p-1 hover:bg-[var(--bg-hover)]"><X size={16} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.map((session) => <button key={session.id} type="button" onClick={() => setSelectedId(session.id)} className={`block w-full border-b border-[var(--border)] px-3 py-2 text-left text-xs hover:bg-[var(--bg-hover)] ${selected === session.id ? "bg-[var(--bg-hover)]" : ""}`}><span className="block truncate font-medium">{session.label}</span><span className="block truncate text-[10px] text-[var(--text-muted)]">{session.origin === "live" ? "LIVE · " : ""}{session.cwd || session.id}</span></button>)}
          {sessions.length === 0 && <p className="p-3 text-xs text-[var(--text-muted)]">No stored or live agent sessions.</p>}
        </div>
      </aside>
      <main className="min-w-0 flex-1"><AgentTranscriptViewer focused sessionId={selected} onMetrics={setMetrics} /></main>
      <aside className="flex w-[min(40vw,440px)] min-w-80 flex-col border-l border-[var(--border)]">
        <section className="grid grid-cols-2 gap-2 border-b border-[var(--border)] p-3 text-xs" aria-label="Agent metrics">
          <span>Messages <strong className="block">{metrics.messages}</strong></span>
          <span>Input <strong className="block">{metrics.inputTokens.toLocaleString()}</strong></span>
          <span>Output <strong className="block">{metrics.outputTokens.toLocaleString()}</strong></span>
          <span>Cost <strong className="block">${metrics.cost.toFixed(4)}</strong></span>
        </section>
        <div className="min-h-0 flex-1"><AgentDashboard cwd={cwd} sessionId={sessionId} agents={agentDefinitions} definitionsLoaded={definitionsLoaded} onDefinitionsChanged={loadAgentDefinitions} /></div>
      </aside>
    </div>
  );
}
