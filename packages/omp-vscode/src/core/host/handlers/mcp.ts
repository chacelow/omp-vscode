import { spawn } from "child_process";
import { once } from "events";
import { resolveOmpBinary } from "../../omp-binary";

export type McpAddParams = {
  name: string;
  scope: "user" | "project";
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
};
type McpResult = { ok: boolean; output?: string; error?: string };

async function runOmp(args: string[]): Promise<McpResult> {
  let output = "";
  let error = "";
  const child = spawn(resolveOmpBinary(), args, { shell: false });
  child.stdout.on("data", (chunk: Buffer) => { output += String(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { error += String(chunk); });
  try {
    const [code] = await once(child, "close") as [number | null];
    if (code === 0) return { ok: true, output: output.trim() };
    return { ok: false, output: output.trim() || undefined, error: error.trim() || `omp exited with code ${code ?? "unknown"}` };
  } catch (spawnError: unknown) {
    return { ok: false, error: spawnError instanceof Error ? spawnError.message : "Unable to start omp" };
  }
}

export function mcpAddHandler(params: McpAddParams): Promise<McpResult> | McpResult {
  const args = ["mcp", "add", params.name, "--scope", params.scope];
  if (params.transport === "stdio") {
    if (!params.command) return { ok: false, error: "A command is required for stdio servers" };
    args.push("--", params.command, ...(params.args ?? []));
  } else {
    if (!params.url) return { ok: false, error: "A URL is required for HTTP and SSE servers" };
    args.push("--url", params.url, "--transport", params.transport);
  }
  return runOmp(args);
}

export function mcpTestHandler(params: { name: string; scope?: "user" | "project" }): Promise<McpResult> {
  return runOmp(["mcp", "test", params.name, ...(params.scope ? ["--scope", params.scope] : [])]);
}

export function mcpRemoveHandler(params: { name: string; scope?: "user" | "project" }): Promise<McpResult> {
  return runOmp(["mcp", "remove", params.name, ...(params.scope ? ["--scope", params.scope] : [])]);
}
