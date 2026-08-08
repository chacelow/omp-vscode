import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentMessage, SessionInfo } from "./types";

// ============================================================================
// OMP session files (extended-host edition)
//
// Reads ~/.omp/agent/sessions — the same .jsonl files the omp CLI writes:
//   <agentDir>/sessions/--<cwd-with-dashes>--/<timestamp>_<uuid>.jsonl
//
// Entry types: session (header), title, session_info, model_change,
// thinking_level_change, message, compaction, branch_summary, ...
// Only the header/title/messages are needed here — branch trees are not
// surfaced (the RPC backend has no navigate_tree), so messages are parsed
// linearly along the active branch.
// ============================================================================

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function getOmpAgentDir(): string {
  return process.env.OMP_CODING_AGENT_DIR
    || process.env.PI_CODING_AGENT_DIR
    || join(homedir(), ".omp", "agent");
}

export function getSessionsDir(): string {
  return join(getOmpAgentDir(), "sessions");
}

// ---------------------------------------------------------------------------
// Header / list
// ---------------------------------------------------------------------------

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp?: string;
  cwd?: string;
  parentSession?: string;
  name?: string;
  title?: string;
}

/** Read the session header + OMP title entry (first ~64KB). */
export function readSessionHeader(filePath: string): SessionHeader | null {
  try {
    const text = readFileSync(filePath, "utf8").slice(0, 64 * 1024);
    let header: SessionHeader | null = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "session" && !header) {
          header = entry as unknown as SessionHeader;
        } else if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim() && header) {
          header.name = entry.name.trim();
          header.title = entry.name.trim();
        } else if (entry.type === "title" && header && !header.title) {
          const title = (entry as Record<string, unknown>).title;
          if (typeof title === "string" && title.trim()) {
            header.name = title.trim();
            header.title = title.trim();
          }
        }
      } catch {
        // skip unparsable lines
      }
    }
    return header;
  } catch {
    return null;
  }
}

/** First user message text (fallback when the async title is not written). */
function readFirstUserMessageText(filePath: string): string {
  try {
    const text = readFileSync(filePath, "utf8").slice(0, 256 * 1024);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type !== "message") continue;
        const m = entry.message as Record<string, unknown> | undefined;
        if (m?.role !== "user") continue;
        const content = m.content;
        if (typeof content === "string" && content.trim()) return content.trim().slice(0, 120);
        if (Array.isArray(content)) {
          const textPart = content
            .filter((b): b is { type: "text"; text: string } =>
              typeof b === "object" && b !== null
              && (b as { type?: string }).type === "text"
              && typeof (b as { text?: unknown }).text === "string")
            .map((b) => b.text)
            .join(" ")
            .trim();
          if (textPart) return textPart.slice(0, 120);
        }
        break;
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }
  return "";
}

/** Session summary for the sidebar list (all sessions under the agent dir). */
export function listAllSessions(): SessionInfo[] {
  const sessionsDir = getSessionsDir();
  if (!existsSync(sessionsDir)) return [];
  const result: SessionInfo[] = [];
  try {
    for (const sub of readdirSync(sessionsDir)) {
      const dirPath = join(sessionsDir, sub);
      if (!statSync(dirPath).isDirectory()) continue;
      for (const file of readdirSync(dirPath)) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = join(dirPath, file);
        const header = readSessionHeader(filePath);
        if (!header?.id) continue;
        const stat = statSync(filePath);
        const fallback = readFirstUserMessageText(filePath);
        result.push({
          path: filePath,
          id: header.id,
          cwd: header.cwd || "",
          name: header.name || header.title || fallback || undefined,
          created: header.timestamp ? new Date(header.timestamp).toISOString() : stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString(),
          messageCount: 1,
          firstMessage: header.title || fallback || "(session)",
          parentSessionId: header.parentSession,
        });
      }
    }
  } catch {
    // ignore scan errors
  }
  return result;
}

// ---------------------------------------------------------------------------
// Message context (active-branch linear parse)
// ---------------------------------------------------------------------------

export interface SessionContext {
  messages: AgentMessage[];
  entryIds: string[];
  leafId: string | null;
  thinkingLevel?: string;
  model?: { provider: string; modelId: string } | null;
}

const ROOT = "/"; // placeholder root for parentId when absent

function messageEntryToUiMessage(entry: Record<string, unknown>): AgentMessage | null {
  const msg = entry.message as AgentMessage | undefined;
  if (!msg || typeof msg !== "object") return null;
  if (!["user", "assistant", "toolResult", "custom", "bashExecution"].includes(msg.role as string)) return null;
  return msg;
}

/** Parse a session file into a linear message list + metadata. */
export function loadSessionContext(filePath: string): SessionContext {
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  let leafId: string | null = null;
  let thinkingLevel: string | undefined;
  let model: { provider: string; modelId: string } | null = null;
  try {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      switch (entry.type) {
        case "message": {
          const ui = messageEntryToUiMessage(entry);
          if (!ui) break;
          if (typeof entry.id === "string") entryIds.push(entry.id);
          leafId = typeof entry.id === "string" ? entry.id : leafId;
          messages.push(ui);
          break;
        }
        case "model_change": {
          if (typeof entry.provider === "string" && typeof entry.modelId === "string") {
            model = { provider: entry.provider, modelId: entry.modelId };
          }
          break;
        }
        case "thinking_level_change": {
          if (typeof entry.level === "string") thinkingLevel = entry.level;
          break;
        }
      }
    }
  } catch {
    // unreadable file — return empty
  }
  return { messages, entryIds, leafId, thinkingLevel, model };
}

/** True if the entry carries conversation context (messages). */
export function hasSessionContent(filePath: string): boolean {
  try {
    const text = readFileSync(filePath, "utf8").slice(0, 512 * 1024);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if (e.type === "message" && e.message) return true;
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }
  return false;
}

// ---------------------------------------------------------------------------
// Path/id caches (used by the session manager for resolve-by-id)
// ---------------------------------------------------------------------------

const pathCache = new Map<string, string>();
const idToPath = new Map<string, string>();

export function cacheSessionPath(sessionId: string, filePath: string): void {
  pathCache.set(filePath, sessionId);
  idToPath.set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const p = idToPath.get(sessionId);
  if (p) pathCache.delete(p);
  idToPath.delete(sessionId);
}

export function resolveSessionPath(sessionId: string): string | null {
  const cached = idToPath.get(sessionId);
  if (cached && existsSync(cached)) return cached;
  // Fall back to a full scan (cache is a fast path only).
  for (const s of listAllSessions()) {
    if (s.id === sessionId) {
      cacheSessionPath(sessionId, s.path);
      return s.path;
    }
  }
  return null;
}

// List cache invalidation (mirrors the omp-web service semantics; the host
// version scans on demand, so invalidation is mostly a no-op placeholder).
export function invalidateSessionListCache(): void {
  // no-op: listAllSessions() always rescans
}

export { ROOT };
