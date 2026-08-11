"use client";

import {
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SettingsPanel } from "./SettingsSelector";
import { ResetUsageSelector } from "./panels/ResetUsageSelector";
import { McpPanel } from "./workbench/McpPanel";
import { AgentsPanel } from "./workbench/AgentsPanel";
import { UsagePanel } from "./workbench/UsagePanel";
import { AuthPanel } from "./workbench/AuthPanel";
import { PreferencesProvider } from "@/hooks/usePreferences";
import { hostCall } from "../../bridge";

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

type WorkbenchTabDefinition = {
  id: WorkbenchTab;
  label: string;
  hint: string;
};

export function WorkbenchShell(): JSX.Element {
  const { t } = useI18n();
  const TABS = useMemo<WorkbenchTabDefinition[]>(
    () => [
      {
        id: "settings",
        label: t("workbench.tab.settings"),
        hint: t("workbench.tab.settings.hint"),
      },
      {
        id: "models",
        label: t("workbench.tab.models"),
        hint: t("workbench.tab.models.hint"),
      },
      {
        id: "skills",
        label: t("workbench.tab.skills"),
        hint: t("workbench.tab.skills.hint"),
      },
      {
        id: "plugins",
        label: t("workbench.tab.plugins"),
        hint: t("workbench.tab.plugins.hint"),
      },
      {
        id: "mcp",
        label: t("workbench.tab.mcp"),
        hint: t("workbench.tab.mcp.hint"),
      },
      {
        id: "agents",
        label: t("workbench.tab.agents"),
        hint: t("workbench.tab.agents.hint"),
      },
      {
        id: "usage",
        label: t("workbench.tab.usage"),
        hint: t("workbench.tab.usage.hint"),
      },
      {
        id: "auth",
        label: t("workbench.tab.auth"),
        hint: t("workbench.tab.auth.hint"),
      },
    ],
    [t]
  );
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
        return <McpPanel cwd={cwd} />;
      case "agents":
        return <AgentsPanel cwd={cwd} />;
      case "usage":
        return <UsagePanel onOpenReset={() => setResetOpen(true)} />;
      case "auth":
        return <AuthPanel />;
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
                {t("workbench.title")}
              </div>
              <div
                style={{ marginTop: 2, fontSize: 10, color: "var(--text-dim)" }}
              >
                {t("workbench.subtitle")}
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
                {t(`workbench.tab.${tab}.hint`)}
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
