"use client";

import {
  useCallback,
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SettingsPanel } from "./SettingsSelector";
import { McpAddWizard } from "./panels/McpAddWizard";
import { OAuthLoginDialog } from "./panels/OAuthLoginDialog";
import { ResetUsageSelector } from "./panels/ResetUsageSelector";
import { AgentDashboard } from "./agent-hub/AgentDashboard";
import { PreferencesProvider } from "@/hooks/usePreferences";
import { ompUsage } from "@/lib/ext-methods";
import { hostCall } from "../../bridge";
import type { AgentDefinitionSummary } from "../../../core/host/protocol";

// Unified OMP Workbench. Horizontal-tab TUI shell that mirrors the omp
// terminal Settings selector: bordered frame · title · tab strip · body ·
// footer hint. Each tab renders its embedded panel inline in the body slot.

type WorkbenchTab =
  | "settings"
  | "models"
  | "skills"
  | "plugins"
  | "mcp"
  | "agents"
  | "usage"
  | "auth";

const TABS: { id: WorkbenchTab; label: string; hint: string }[] = [
  { id: "settings", label: "Settings", hint: "General preferences" },
  { id: "models", label: "Models", hint: "Providers and role assignments" },
  { id: "skills", label: "Skills", hint: "Installed skills" },
  { id: "plugins", label: "Plugins", hint: "Extension modules" },
  { id: "mcp", label: "MCP", hint: "Model Context Protocol servers" },
  { id: "agents", label: "Agents", hint: "Custom agent definitions" },
  { id: "usage", label: "Usage", hint: "Token spend and provider usage" },
  { id: "auth", label: "Auth", hint: "Provider credentials" },
];

function UsagePane({ onOpenReset }: { onOpenReset: () => void }): JSX.Element {
  const [reports, setReports] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void ompUsage()
      .then((data) => {
        if (active) setReports(data.reports);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div
      style={{
        padding: 20,
        color: "var(--text)",
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <p style={{ color: "var(--text-dim)", fontSize: 12, margin: 0 }}>
          Provider usage reports from <code>_omp/usage</code>.
        </p>
        <button
          type="button"
          onClick={onOpenReset}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "transparent",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          Reset credit…
        </button>
      </div>
      <div style={{ marginTop: 16 }}>
        {error ? (
          <p style={{ color: "var(--vscode-errorForeground, #f48771)" }}>
            Error: {error}
          </p>
        ) : null}
        {reports === null && !error ? (
          <p style={{ color: "var(--text-dim)" }}>Loading…</p>
        ) : null}
        {reports !== null && reports.length === 0 ? (
          <p style={{ color: "var(--text-dim)" }}>
            No usage data available yet.
          </p>
        ) : null}
        {reports !== null && reports.length > 0 ? (
          <pre
            style={{
              background: "var(--bg-panel)",
              padding: 12,
              borderRadius: 6,
              fontSize: 11,
              overflow: "auto",
            }}
          >
            {JSON.stringify(reports, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function AgentsPane({ cwd }: { cwd: string }): JSX.Element {
  const [agents, setAgents] = useState<AgentDefinitionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async (): Promise<void> => {
    try {
      const response = await hostCall("agentsList", {});
      setAgents(response.agents);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <div
      style={{
        padding: 20,
        color: "var(--text)",
        height: "100%",
        overflow: "auto",
      }}
    >
      <p style={{ color: "var(--text-dim)", fontSize: 12, margin: 0 }}>
        Configure agent definitions in <code>~/.omp/agent/agents/*.yml</code>.
      </p>
      <div style={{ marginTop: 12 }}>
        <AgentDashboard
          cwd={cwd}
          sessionId={null}
          agents={agents}
          definitionsLoaded={loaded}
          onDefinitionsChanged={reload}
        />
      </div>
    </div>
  );
}

function AuthPane(): JSX.Element {
  const [provider, setProvider] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [url, setUrl] = useState("");
  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <p style={{ color: "var(--text-dim)", fontSize: 12, margin: 0 }}>
        Manage provider credentials. OAuth flow requires an external browser;
        paste the returned code below.
      </p>
      <div style={{ marginTop: 16, display: "grid", gap: 8, maxWidth: 520 }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Provider identifier
          <input
            aria-label="Provider identifier"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="anthropic / openai / …"
            style={{
              marginTop: 4,
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              color: "var(--text)",
            }}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Authorization URL (optional)
          <input
            aria-label="Authorization URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…/authorize?…"
            style={{
              marginTop: 4,
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              color: "var(--text)",
            }}
          />
        </label>
        <button
          type="button"
          disabled={!provider}
          onClick={() => setDialogOpen(true)}
          style={{
            justifySelf: "start",
            padding: "6px 12px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--accent)",
            color: "var(--vscode-button-foreground, #fff)",
            cursor: provider ? "pointer" : "not-allowed",
            opacity: provider ? 1 : 0.5,
          }}
        >
          Start login…
        </button>
      </div>
      {dialogOpen ? (
        <OAuthLoginDialog
          provider={provider}
          authorizationUrl={url}
          onClose={() => setDialogOpen(false)}
          onSuccess={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

const TAB_SUBTITLE: Record<WorkbenchTab, string> = {
  settings: "General preferences · saved automatically",
  models: "Providers and models · ~/.omp/agent/models.yml",
  skills: "Installed skills and sources",
  plugins: "Extension modules",
  mcp: "Model Context Protocol servers",
  agents: "Custom agent definitions",
  usage: "Token spend and provider usage",
  auth: "Provider credentials",
};

export function WorkbenchShell(): JSX.Element {
  const [tab, setTab] = useState<WorkbenchTab>("settings");
  const [cwd, setCwd] = useState<string>(
    () => document.getElementById("app")?.getAttribute("data-cwd") ?? ""
  );
  const isMobile = useIsMobile();
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    if (cwd) return;
    void hostCall("defaultCwd", {})
      .then((response) => {
        if (typeof response?.cwd === "string") setCwd(response.cwd);
      })
      .catch(() => {
        /* keep empty */
      });
  }, [cwd]);

  const renderBody = (): ReactNode => {
    switch (tab) {
      case "settings":
        return <SettingsPanel embedded />;
      case "models":
        return <ModelsConfig embedded />;
      case "skills":
        return <SkillsConfig embedded cwd={cwd} />;
      case "plugins":
        return (
          <PluginsConfig
            embedded
            cwd={cwd}
            sessionId={null}
            onReloaded={() => {}}
          />
        );
      case "mcp":
        return <McpAddWizard embedded cwd={cwd} />;
      case "agents":
        return <AgentsPane cwd={cwd} />;
      case "usage":
        return <UsagePane onOpenReset={() => setResetOpen(true)} />;
      case "auth":
        return <AuthPane />;
    }
  };

  const body = renderBody();

  return (
    <PreferencesProvider>
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          height: "100vh",
          width: "100vw",
          overflow: "hidden",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "var(--vscode-font-family)",
        }}
      >
        <aside
          style={{
            width: isMobile ? "100%" : 190,
            maxHeight: isMobile ? 58 : undefined,
            flexShrink: 0,
            padding: isMobile ? "8px 10px" : "16px 10px",
            borderRight: isMobile ? "none" : "1px solid var(--border)",
            borderBottom: isMobile ? "1px solid var(--border)" : "none",
            background: "var(--bg-panel)",
            overflowX: isMobile ? "auto" : "hidden",
            overflowY: isMobile ? "hidden" : "auto",
          }}
        >
          {!isMobile ? (
            <div style={{ padding: "0 10px 14px" }}>
              <div
                style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}
              >
                OMP
              </div>
              <div
                style={{ marginTop: 2, fontSize: 10, color: "var(--text-dim)" }}
              >
                Workbench
              </div>
            </div>
          ) : null}
          <nav
            aria-label="Workbench sections"
            style={{
              display: "flex",
              flexDirection: isMobile ? "row" : "column",
              gap: 3,
              minWidth: "max-content",
            }}
          >
            {TABS.map((definition) => {
              const active = tab === definition.id;
              return (
                <button
                  key={definition.id}
                  type="button"
                  onClick={() => setTab(definition.id)}
                  title={definition.hint}
                  aria-current={active ? "page" : undefined}
                  style={{
                    minHeight: isMobile ? 36 : 38,
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 7,
                    background: active ? "var(--bg-selected)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    transition: "background-color 120ms ease, color 120ms ease",
                  }}
                >
                  {definition.label}
                </button>
              );
            })}
          </nav>
        </aside>
        <main
          style={{
            minWidth: 0,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <header
            style={{
              minHeight: 58,
              display: "flex",
              alignItems: "center",
              padding: isMobile ? "8px 16px" : "10px 24px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  color: "var(--text)",
                  fontSize: 15,
                  fontWeight: 650,
                  textWrap: "balance",
                }}
              >
                {TABS.find((definition) => definition.id === tab)?.label}
              </h1>
              <p
                style={{
                  margin: "3px 0 0",
                  color: "var(--text-dim)",
                  fontSize: 10,
                  textWrap: "pretty",
                }}
              >
                {TAB_SUBTITLE[tab]}
              </p>
            </div>
          </header>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {body}
          </div>
        </main>
      </div>
      {resetOpen ? (
        <ResetUsageSelector onClose={() => setResetOpen(false)} />
      ) : null}
    </PreferencesProvider>
  );
}
