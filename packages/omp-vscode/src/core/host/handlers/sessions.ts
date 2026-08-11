import { readFileSync, statSync } from "fs";
import type { Handler } from "./index";
import type { SessionTreeNode as ReaderSessionTreeNode } from "../../session-reader";
import {
  anchorSessionAt,
  appendSessionSummary,
  deleteSession as fileDeleteSession,
  invalidateSessionPathCache,
  listAllSessions,
  loadSessionContext,
  loadSessionTree,
  readEntryThinking,
  readSessionHeader,
  renameSession as fileRenameSession,
  renameSessionEntry,
  resolveSessionPath,
  resumeSessionAt,
} from "../../session-reader";

const MAX_BASH_OUTPUT_BYTES = 8 * 1024 * 1024;

export const sessionsListHandler: Handler<"sessionsList"> = () => ({
  sessions: listAllSessions(),
  runningSessionIds: [],
});

export const sessionsListAllHandler: Handler<"sessionsListAll"> = () => ({
  sessions: listAllSessions(),
  runningSessionIds: [],
});

export const sessionDetailHandler: Handler<"sessionDetail"> = ({ sessionId }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath) return null;
  const ctx = loadSessionContext(filePath);
  const header = readSessionHeader(filePath);
  const treeInfo = loadSessionTree(filePath);
  const toUiTree = (node: ReaderSessionTreeNode): Record<string, unknown> => ({
    entry: {
      type: "message",
      id: node.id,
      parentId: node.parentId,
      timestamp: node.timestamp ?? new Date().toISOString(),
      message: {
        role: node.role,
        content: node.summary ? [{ type: "text", text: node.summary }] : [],
      },
    },
    label: treeInfo.labels.get(node.id),
    children: node.children.map(toUiTree),
  });
  return {
    sessionId,
    filePath,
    tree: treeInfo.roots.map(toUiTree),
    leafId: ctx.leafId,
    context: {
      messages: ctx.messages,
      entryIds: ctx.entryIds,
      thinkingLevel: ctx.thinkingLevel ?? "off",
      model: ctx.model ?? null,
    },
    cwd: header?.cwd ?? "",
  };
};

export const sessionRewindHandler: Handler<"sessionRewind"> = ({ sessionId, entryId }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath) throw new Error("Session not found");
  if (!anchorSessionAt(filePath, entryId)) {
    throw new Error("Entry not found or not a user message");
  }
  return { success: true };
};

export const sessionNavigateLeafHandler: Handler<"sessionNavigateLeaf"> = ({ sessionId, entryId }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath) throw new Error("Session not found");
  if (!resumeSessionAt(filePath, entryId)) throw new Error("Entry not found");
  return { success: true };
};

export const sessionRenameHandler: Handler<"sessionRename"> = ({ sessionId, name }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath) throw new Error("Session not found");
  if (!fileRenameSession(filePath, name)) throw new Error("Failed to write rename entry");
  return { success: true };
};

export const sessionRenameEntryHandler: Handler<"sessionRenameEntry"> = ({ sessionId, entryId, label }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath || !renameSessionEntry(filePath, entryId, label.trim())) throw new Error("Unable to save entry label");
  return { success: true, path: filePath };
};

export const sessionAppendSummaryHandler: Handler<"sessionAppendSummary"> = ({ sessionId, entryId, summary }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath || !appendSessionSummary(filePath, entryId, summary.trim())) throw new Error("Unable to save branch summary");
  return { success: true, path: filePath };
};

export const sessionDeleteHandler: Handler<"sessionDelete"> = ({ sessionId }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath) return { success: true }; // already gone
  fileDeleteSession(filePath);
  invalidateSessionPathCache(sessionId);
  return { success: true };
};

export const sessionEntryThinkingHandler: Handler<"sessionEntryThinking"> = ({ sessionId, entryId, blockIndex }) => {
  const filePath = resolveSessionPath(sessionId);
  if (!filePath) return { thinking: null };
  return { thinking: readEntryThinking(filePath, entryId, blockIndex) };
};

export const sessionBashOutputHandler: Handler<"sessionBashOutput"> = ({ path }) => {
  try {
    const stats = statSync(path);
    if (stats.size > MAX_BASH_OUTPUT_BYTES) {
      return { success: false, error: `Output too large (${stats.size} bytes)` };
    }
    const output = readFileSync(path, "utf8");
    return { success: true, data: { output } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};
