import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { parse, stringify } from "yaml";
import type { Handler } from "./index";
import { getOmpAgentDir, resolveSessionPath } from "../../session-reader";
import type { AgentDefinition, AgentDefinitionSummary, SessionTailEntry } from "../protocol";

function isAgentMessage(value: unknown): value is SessionTailEntry["message"] {
  if (typeof value !== "object" || value === null || !("role" in value)) return false;
  return value.role === "user" || value.role === "assistant" || value.role === "toolResult" || value.role === "custom" || value.role === "bashExecution";
}

export const sessionTailHandler: Handler<"sessionTail"> = ({ sessionId, sinceRevision }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath) return null;
  const lines = readFileSync(filePath, "utf8").split("\n").filter((line) => line.trim().length > 0);
  const start = sinceRevision === null ? 0 : Math.max(0, Math.min(sinceRevision, lines.length));
  const entries: SessionTailEntry[] = [];
  for (const line of lines.slice(start)) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "message" || !("id" in value) || typeof value.id !== "string" || !("message" in value) || !isAgentMessage(value.message)) continue;
      entries.push({ id: value.id, message: value.message });
    } catch {
      // An in-flight JSONL write is retried on the next polling interval.
    }
  }
  return { revision: lines.length, entries };
};

export const agentsListHandler: Handler<"agentsList"> = () => {
  const directory = `${getOmpAgentDir()}/agents`;
  if (!existsSync(directory)) return { agents: [] };

  const agents: AgentDefinitionSummary[] = [];
  for (const fileName of readdirSync(directory)) {
    if (!fileName.endsWith(".yml") && !fileName.endsWith(".yaml")) continue;
    const filePath = `${directory}/${fileName}`;
    try {
      const parsed: unknown = parse(readFileSync(filePath, "utf8"));
      const definition: AgentDefinition = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
      agents.push({ name: fileName.replace(/\.ya?ml$/, ""), definition, path: filePath });
    } catch {
      // A malformed or concurrently removed definition must not prevent the hub opening.
    }
  }
  return { agents: agents.sort((left, right) => left.name.localeCompare(right.name)) };
};

export const agentSaveHandler: Handler<"agentSave"> = ({ name, definition }) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Agent names may only contain letters, numbers, underscores, and hyphens");
  const directory = `${getOmpAgentDir()}/agents`;
  mkdirSync(directory, { recursive: true });
  const filePath = `${directory}/${name}.yml`;
  writeFileSync(filePath, stringify(definition), "utf8");
  return { success: true, path: filePath };
};
