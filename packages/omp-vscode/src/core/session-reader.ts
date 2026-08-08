import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
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
function readFirstUserMessageText(filePath: string): string {  try {
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

/** Count conversation messages in a session file (line scan, no full parse). */
function countMessageEntries(filePath: string): number {
  try {
    const text = readFileSync(filePath, "utf8");
    let count = 0;
    for (const line of text.split("\n")) {
      if (line.includes('"type":"message"') || line.includes('"type": "message"')) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
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
          messageCount: countMessageEntries(filePath),
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

export interface SessionTreeNode {
  id: string;
  parentId: string | null;
  type: string;
  role: string;
  summary: string;
  hasImages: boolean;
  timestamp?: string;
  children: SessionTreeNode[];
}

/** Parse a session file into its real message tree (entry parentId links,
 * not the linear active-branch view). Branch points show as fork nodes. */
export function loadSessionTree(filePath: string): { roots: SessionTreeNode[]; byId: Map<string, SessionTreeNode> } {
  const byId = new Map<string, SessionTreeNode>();
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
      if (entry.type !== "message") continue;
      if (typeof entry.id !== "string") continue;
      const msg = entry.message as AgentMessage | undefined;
      if (!msg || typeof msg !== "object") continue;
      let summary = "";
      let hasImages = false;
      const blocks = "content" in msg && Array.isArray(msg.content) ? msg.content : [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          if (!summary) summary = block.text.replace(/\s+/g, " ").trim();
          else summary += " " + block.text.replace(/\s+/g, " ").trim();
        } else if (block.type === "image") {
          hasImages = true;
        }
        if (summary.length >= 120) { summary = summary.slice(0, 120) + "…"; break; }
      }
      byId.set(entry.id, {
        id: entry.id,
        parentId: typeof entry.parentId === "string" ? entry.parentId : null,
        type: "message",
        role: msg.role,
        summary,
        hasImages,
        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
        children: [],
      });
    }
  } catch {
    // unreadable — empty tree
  }
  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return { roots, byId };
}

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

/** Parse a session file into the ACTIVE-branch message list: omp's leaf is
 * the file's last entry, and the branch is its parentId chain across ALL
 * entry types (model/thinking anchors are tree nodes too — the first user
 * message's parent is a thinking entry). Old branches stay in the file (full
 * tree, never deleted) but are not shown. */
export function loadSessionContext(filePath: string): SessionContext {
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  const byId = new Map<string, { parentId: string | null; message?: AgentMessage }>();
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
      const id = typeof entry.id === "string" ? entry.id : "";
      const parentId = typeof entry.parentId === "string" ? entry.parentId : null;
      if (id) {
        // Track EVERY entry id for chain traversal (thinking_level_change /
        // model_change anchors are tree nodes); only messages carry content.
        byId.set(id, {
          parentId,
          message: entry.type === "message" ? (messageEntryToUiMessage(entry) ?? undefined) : undefined,
        });
        // Last entry in file order = the runtime leaf (omp's
        // SessionEntryIndex.insert sets leaf = entry.id).
        leafId = id;
      }
      switch (entry.type) {
        case "model_change": {
          // TUI writes a single `model` string ("provider/path/modelId").
          if (typeof entry.model === "string") {
            const slash = entry.model.indexOf("/");
            if (slash > 0) {
              model = { provider: entry.model.slice(0, slash), modelId: entry.model.slice(slash + 1) };
            } else if (entry.model) {
              model = { provider: "unknown", modelId: entry.model };
            }
          } else if (typeof entry.provider === "string" && typeof entry.modelId === "string") {
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
    // Active branch = leaf's parentId chain (root → leaf), in order. Only
    // messages are emitted; anchor/non-message entries only guide traversal.
    if (leafId) {
      const chain: Array<{ id: string; message: AgentMessage }> = [];
      const seen = new Set<string>();
      let cur: string | null = leafId;
      while (cur && byId.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        const node: { parentId: string | null; message?: AgentMessage } = byId.get(cur)!;
        if (node.message) chain.push({ id: cur, message: node.message });
        cur = node.parentId;
      }
      chain.reverse();
      for (const node of chain) {
        messages.push(node.message);
        entryIds.push(node.id);
      }
    }
  } catch {
    // unreadable file — return empty
  }
  return { messages, entryIds, leafId, thinkingLevel, model };
}

/** True if the entry carries conversation context (messages). */
export function hasSessionContent(filePath: string): boolean {
  try {    const text = readFileSync(filePath, "utf8").slice(0, 512 * 1024);
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

/**
 * Rewind / branch switch, copying omp's appendMessageToBranch mechanism: the
 * session file is a full tree (append-only, never deleted) and the active
 * branch (leaf) is the file's LAST entry after a resume. Instead of reordering
 * lines (which corrupted real sessions by fighting omp's own writes), we
 * APPEND a non-message anchor entry (thinking_level_change, omp id convention:
 * 8-hex) whose parentId is the edit point's parent. On resume the leaf is that
 * anchor, so the next prompt appends the edited message as a NEW BRANCH under
 * the edit point — same file, same session id, nothing reordered, nothing
 * deleted, history intact. Returns true on success.
 */
export function anchorSessionAt(filePath: string, entryId: string): boolean {
  let lines: string[];
  try {
    lines = readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return false;
  }
  const ids = new Set<string>();
  let targetParent: string | null | undefined;
  let found = false;
  for (const line of lines) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof e.id === "string") ids.add(e.id);
    if (!found && e.type === "message" && e.id === entryId) {
      const msg = e.message as { role?: string } | undefined;
      if (!msg || msg.role !== "user") return false;
      targetParent = typeof e.parentId === "string" ? e.parentId : null;
      found = true;
    }
  }
  if (!found || targetParent === undefined) return false;
  // omp id convention: 8-hex (crypto.randomUUID().slice(-8)), collision-checked.
  let id = "";
  for (let i = 0; i < 100; i++) {
    const candidate = crypto.randomUUID().slice(-8);
    if (!ids.has(candidate)) { id = candidate; break; }
  }
  if (!id) return false;
  const anchor = {
    type: "thinking_level_change",
    id,
    parentId: targetParent,
    timestamp: new Date().toISOString(),
    thinkingLevel: "off",
  };
  try {
    writeFileSync(filePath, readFileSync(filePath, "utf8").trimEnd() + "\n" + JSON.stringify(anchor) + "\n", "utf8");
  } catch {
    return false;
  }
  return true;
}

/** True if the entry carries conversation context (messages). */
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
