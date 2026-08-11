import { useCallback, useEffect, useState, type JSX } from "react";
import { hostCall } from "../../../bridge";
import { ompExtensions } from "@/lib/ext-methods";
import { McpAddWizard } from "../panels/McpAddWizard";

type McpScope = "user" | "project";

type McpServer = {
  name: string;
  description?: string;
  transport: string;
  provider: string;
  level: "user" | "project" | "native";
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseMcpServer(extension: unknown): McpServer | null {
  if (!extension || typeof extension !== "object") return null;
  const value = extension as Record<string, unknown>;
  if (value.kind !== "mcp") return null;

  const source = value.source;
  if (!source || typeof source !== "object") return null;
  const sourceValue = source as Record<string, unknown>;
  const level = sourceValue.level;
  if (level !== "user" && level !== "project" && level !== "native") return null;

  const raw = value.raw;
  const rawValue = raw && typeof raw === "object" ? raw as Record<string, unknown> : undefined;
  const transport = rawValue && "transport" in rawValue
    ? readString(rawValue.transport) ?? "(unknown transport)"
    : "(unknown transport)";
  const description = rawValue && "description" in rawValue
    ? readString(rawValue.description)
    : undefined;

  return {
    name: readString(value.name) ?? readString(value.displayName) ?? "(unnamed server)",
    description,
    transport,
    provider: readString(sourceValue.providerName) ?? readString(sourceValue.provider) ?? "MCP",
    level,
  };
}

const actionButtonStyle = {
  border: "1px solid var(--vscode-button-border, var(--border))",
  borderRadius: 2,
  background: "var(--vscode-button-secondaryBackground, var(--bg))",
  color: "var(--vscode-button-secondaryForeground, var(--text))",
  cursor: "pointer",
  fontSize: 12,
  padding: "5px 10px",
} as const;

function ServerRow({
  server,
  status,
  testing,
  removing,
  onTest,
  onRemove,
}: {
  server: McpServer;
  status?: string;
  testing: boolean;
  removing: boolean;
  onTest: () => void;
  onRemove: () => void;
}): JSX.Element {
  const scope = server.level as McpScope;
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 20,
        padding: "16px 0",
        borderBottom: "1px solid var(--vscode-settings-headerBorder, var(--border))",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <strong style={{ fontSize: 13, color: "var(--text)" }}>{server.name}</strong>
          <span
            style={{
              border: "1px solid var(--vscode-settings-headerBorder, var(--border))",
              borderRadius: 10,
              color: "var(--text-dim)",
              fontSize: 10,
              lineHeight: "18px",
              padding: "0 7px",
            }}
          >
            {scope}
          </span>
        </div>
        {server.description ? (
          <p style={{ margin: "3px 0 0", color: "var(--text-dim)", fontSize: 12, lineHeight: 1.45 }}>
            {server.description}
          </p>
        ) : null}
        <p style={{ margin: "4px 0 0", color: "var(--text-dim)", fontSize: 11 }}>
          {server.provider} · {server.transport}
        </p>
        {status ? (
          <p role="status" style={{ margin: "7px 0 0", color: "var(--text-dim)", fontSize: 12, whiteSpace: "pre-wrap" }}>
            {status}
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" disabled={testing || removing} onClick={onTest} style={actionButtonStyle}>
          {testing ? "Testing…" : "Test"}
        </button>
        <button type="button" disabled={testing || removing} onClick={onRemove} style={actionButtonStyle}>
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>
    </section>
  );
}

export function McpPanel({ cwd }: { cwd: string }): JSX.Element {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusByServer, setStatusByServer] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ompExtensions(cwd);
      setServers(result.extensions.map(parseMcpServer).filter((server): server is McpServer => server !== null));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load MCP servers.");
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { void reload(); }, [reload]);

  const showStatus = (server: McpServer, message: string) => {
    setStatusByServer((current) => ({ ...current, [`${server.level}:${server.name}`]: message }));
  };

  const testServer = async (server: McpServer) => {
    const key = `${server.level}:${server.name}`;
    const scope = server.level as McpScope;
    setTesting(key);
    showStatus(server, "Testing connection…");
    try {
      const result = await hostCall("mcpTest", { name: server.name, scope });
      showStatus(server, result.ok ? result.output ?? "Connection succeeded." : result.error ?? "Connection failed.");
    } catch (reason) {
      showStatus(server, reason instanceof Error ? reason.message : "Connection test failed.");
    } finally {
      setTesting(null);
    }
  };

  const removeServer = async (server: McpServer) => {
    const scope = server.level as McpScope;
    if (!window.confirm(`Remove MCP server “${server.name}” from ${scope} configuration?`)) return;

    const key = `${server.level}:${server.name}`;
    setRemoving(key);
    try {
      const result = await hostCall("mcpRemove", { name: server.name, scope });
      if (result.ok) {
        await reload();
      } else {
        showStatus(server, result.error ?? "Unable to remove MCP server.");
      }
    } catch (reason) {
      showStatus(server, reason instanceof Error ? reason.message : "Unable to remove MCP server.");
    } finally {
      setRemoving(null);
    }
  };

  if (adding) {
    return (
      <div style={{ height: "100%", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px", maxWidth: 920, margin: "0 auto" }}>
          <button type="button" onClick={() => { setAdding(false); void reload(); }} style={actionButtonStyle}>Back to servers</button>
        </div>
        <McpAddWizard cwd={cwd} embedded onClose={() => { setAdding(false); void reload(); }} />
      </div>
    );
  }

  const userServers = servers.filter((server) => server.level === "user");
  const projectServers = servers.filter((server) => server.level === "project");
  const hasConfiguredServers = userServers.length > 0 || projectServers.length > 0;

  const renderSection = (title: string, sectionServers: McpServer[]) => sectionServers.length > 0 ? (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ margin: "0 0 2px", color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{title}</h2>
      {sectionServers.map((server) => {
        const key = `${server.level}:${server.name}`;
        return <ServerRow key={key} server={server} status={statusByServer[key]} testing={testing === key} removing={removing === key} onTest={() => void testServer(server)} onRemove={() => void removeServer(server)} />;
      })}
    </section>
  ) : null;

  return (
    <div style={{ height: "100%", overflow: "auto", width: "100%", color: "var(--text)" }}>
      <main style={{ boxSizing: "border-box", margin: "0 auto", maxWidth: 920, padding: "20px 24px 32px" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>MCP servers</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-dim)", fontSize: 12 }}>Manage Model Context Protocol server connections.</p>
          </div>
          <button type="button" title="Reload MCP servers" aria-label="Reload MCP servers" disabled={loading} onClick={() => void reload()} style={actionButtonStyle}>↻</button>
        </header>

        {loading ? <p role="status" style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 24 }}>Loading MCP servers…</p> : null}
        {error ? <p role="alert" style={{ color: "var(--vscode-errorForeground, #f48771)", fontSize: 12, marginTop: 16 }}>{error}</p> : null}
        {!loading && !error && !hasConfiguredServers ? <p style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 24 }}>No MCP servers configured. Click “Add Server” to configure one.</p> : null}
        {!loading && !error ? <>{renderSection("User servers", userServers)}{renderSection("Project servers", projectServers)}</> : null}

        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{
            marginTop: 24,
            border: "1px solid var(--vscode-button-border, transparent)",
            borderRadius: 2,
            background: "var(--vscode-button-background, var(--accent))",
            color: "var(--vscode-button-foreground, #fff)",
            cursor: "pointer",
            fontSize: 12,
            padding: "7px 12px",
          }}
        >
          Add MCP server
        </button>
      </main>
    </div>
  );
}
