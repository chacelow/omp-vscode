import { useMemo, useState } from "react";
import { hostCall } from "../../../bridge";

type Scope = "user" | "project";
type Transport = "stdio" | "http" | "sse";
type Step = "name" | "scope" | "transport" | "connection" | "oauth" | "test";

interface McpAddWizardProps { cwd?: string; onClose?: () => void; embedded?: boolean; }
const STEPS: Step[] = ["name", "scope", "transport", "connection", "oauth", "test"];

function parsePairs(source: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) pairs[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return pairs;
}

export function McpAddWizard({ cwd, onClose, embedded }: McpAddWizardProps) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("project");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [env, setEnv] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const index = STEPS.indexOf(step);
  const connectionValid = transport === "stdio" ? command.trim().length > 0 : url.trim().length > 0;
  const commandParts = useMemo(() => command.trim().split(/\s+/).filter(Boolean), [command]);

  const addServer = async () => {
    setStatus("Adding server…");
    const result = await hostCall("mcpAdd", {
      name: name.trim(), scope, transport,
      ...(transport === "stdio" ? { command: commandParts[0], args: commandParts.slice(1) } : { url: url.trim(), headers: parsePairs(headers), env: parsePairs(env) }),
    });
    if (!result.ok) { setStatus(result.error ?? "Unable to add MCP server"); return; }
    setStatus(result.output || "Server added. Test its connection before closing.");
    setStep("test");
  };

  const testServer = async () => {
    setStatus("Testing connection…");
    const result = await hostCall("mcpTest", { name: name.trim(), scope });
    setStatus(result.ok ? result.output || "Connection succeeded." : result.error ?? "Connection failed.");
  };

  const next = () => {
    if (step === "name" && !name.trim()) { setStatus("A server name is required."); return; }
    if (step === "connection" && !connectionValid) { setStatus(transport === "stdio" ? "Enter a command." : "Enter a URL."); return; }
    if (step === "oauth") { void addServer(); return; }
    const nextStep = STEPS[index + 1]; if (nextStep) setStep(nextStep);
  };

  return <div
    className={embedded ? undefined : "absolute inset-0 z-[95] flex items-center justify-center bg-black/30 p-5"}
    style={embedded ? { display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "var(--bg)", color: "var(--text)" } : undefined}
  ><section role="dialog" aria-modal={embedded ? undefined : true} aria-label="Add MCP server" className="w-full max-w-xl rounded-lg border border-border bg-background shadow-xl" style={embedded ? { display: "flex", flexDirection: "column", height: "100%", width: "100%", maxWidth: "none", background: "var(--bg)", color: "var(--text)" } : undefined}><header className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Add MCP server</h2><p className="mt-1 text-xs text-muted-foreground">Step {index + 1} of {STEPS.length}: {step}</p></header><main className="min-h-56 p-4">
    {step === "name" && <label className="grid gap-2 text-sm">Server name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="filesystem" className="min-h-10 rounded border border-border bg-muted px-3" /></label>}
    {step === "scope" && <fieldset className="grid gap-2 text-sm"><legend className="mb-2">Where should this server be configured?</legend>{(["project", "user"] as Scope[]).map((value) => <label key={value} className="flex items-center gap-2 rounded border border-border p-3"><input checked={scope === value} onChange={() => setScope(value)} type="radio" name="mcp-scope" />{value === "project" ? `Project (${cwd ?? "current workspace"})` : "User"}</label>)}</fieldset>}
    {step === "transport" && <fieldset className="grid gap-2 text-sm"><legend className="mb-2">Transport</legend>{(["stdio", "http", "sse"] as Transport[]).map((value) => <label key={value} className="flex items-center gap-2 rounded border border-border p-3"><input checked={transport === value} onChange={() => setTransport(value)} type="radio" name="mcp-transport" />{value.toUpperCase()}</label>)}</fieldset>}
    {step === "connection" && <div className="grid gap-3 text-sm">{transport === "stdio" ? <label className="grid gap-1">Command and arguments<input autoFocus value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem" className="min-h-10 rounded border border-border bg-muted px-3" /></label> : <><label className="grid gap-1">Server URL<input autoFocus type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" className="min-h-10 rounded border border-border bg-muted px-3" /></label><label className="grid gap-1">Headers (KEY=VALUE, one per line)<textarea value={headers} onChange={(event) => setHeaders(event.target.value)} className="min-h-20 rounded border border-border bg-muted px-3 py-2" /></label>{transport === "http" && <label className="grid gap-1">Environment (KEY=VALUE, one per line)<textarea value={env} onChange={(event) => setEnv(event.target.value)} className="min-h-20 rounded border border-border bg-muted px-3 py-2" /></label>}</>}</div>}
    {step === "oauth" && <div className="space-y-2 text-sm"><p>OAuth credentials are requested by the MCP server during connection. Continue to add the server, then use the authentication prompt if one appears.</p><p className="text-xs text-muted-foreground">The existing interaction dialog handles the server-provided OAuth schema.</p></div>}
    {step === "test" && <div className="space-y-3 text-sm"><p>Server configuration is saved. Run a connection test now.</p><button type="button" onClick={() => void testServer()} className="rounded border border-border px-3 py-2 hover:bg-muted">Test connection</button></div>}
    {status && <p role="status" className="mt-4 whitespace-pre-wrap rounded border border-border bg-muted p-2 text-xs">{status}</p>}
  </main><footer className="flex justify-between border-t border-border p-3">{!embedded && <button type="button" onClick={() => onClose?.()} className="rounded border border-border px-3 py-2 text-sm">{step === "test" ? "Close" : "Cancel"}</button>}<div className="flex gap-2" style={embedded ? { marginLeft: "auto" } : undefined}>{index > 0 && step !== "test" && <button type="button" onClick={() => setStep(STEPS[index - 1])} className="rounded border border-border px-3 py-2 text-sm">Back</button>}{step !== "test" && <button type="button" onClick={next} className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{step === "oauth" ? "Add server" : "Next"}</button>}</div></footer></section></div>;
}
