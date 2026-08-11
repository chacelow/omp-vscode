import * as vscode from "vscode";
import { existsSync, readdirSync, statSync, mkdirSync, readFileSync, writeFileSync, type Dirent } from "fs";
import { homedir } from "os";
import { join, relative, resolve, dirname } from "path";
import { load, dump } from "js-yaml";
import type { Handler } from "./index";
import { getOmpAgentDir } from "../../session-reader";

function asSettingsRecord(value: unknown): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return record;
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

function readOmpConfig(): Record<string, unknown> {
  const path = configPath();
  if (!existsSync(path)) return {};
  return asSettingsRecord(load(readFileSync(path, "utf8")));
}

function configPath(): string {
  return join(getOmpAgentDir(), "config.yml");
}

export const settingsGetHandler: Handler<"settingsGet"> = ({ category }) => asSettingsRecord(readOmpConfig()[category]);

function flattenSettings(source: Record<string, unknown>, prefix: string, out: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenSettings(value as Record<string, unknown>, path, out);
    } else {
      out[path] = value;
    }
  }
}

export const settingsListHandler: Handler<"settingsList"> = () => {
  const config = readOmpConfig();
  const values: Record<string, unknown> = {};
  flattenSettings(config, "", values);
  // Also expose top-level records themselves for object-typed consumers.
  for (const [key, value] of Object.entries(config)) {
    if (value !== null && typeof value === "object") values[key] = value;
  }
  return { values };
};

export const settingsSetHandler: Handler<"settingsSet"> = ({ category, key, value }) => {
  const config = readOmpConfig();
  if (category === "__root__") {
    config[key] = value;
  } else {
    const categoryValue = asSettingsRecord(config[category]);
    categoryValue[key] = value;
    config[category] = categoryValue;
  }
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), dump(config, { lineWidth: -1 }), "utf8");
  return { success: true };
};

// ---------------------------------------------------------------------------
// cwd / directory surfaces
// ---------------------------------------------------------------------------

export const cwdValidateHandler: Handler<"cwdValidate"> = ({ cwd }) => {
  if (typeof cwd === "string" && existsSync(cwd)) return { cwd };
  return { error: "Directory does not exist" };
};

export const cwdBrowseHandler: Handler<"cwdBrowse"> = ({ path }) => {
  const target = path && existsSync(path) ? path : homedir();
  try {
    const entries: Array<{ name: string; path: string; isDir: boolean }> = [];
    for (const e of readdirSync(target, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      entries.push({ name: e.name, path: join(target, e.name), isDir: e.isDirectory() });
    }
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    return {
      path: target,
      entries,
      parent: target === "/" ? null : dirname(target),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

export const cwdGitBranchHandler: Handler<"cwdGitBranch"> = async ({ cwd }) => {
  if (!cwd || !existsSync(cwd)) return { branch: null };
  type GitRepository = { rootUri: vscode.Uri; state: { HEAD?: { name?: string } } };
  type GitApi = { repositories: GitRepository[]; getRepository(uri: vscode.Uri): GitRepository | null };
  type GitExtension = { getAPI(version: 1): GitApi };

  try {
    const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!ext) return { branch: null };
    const git = ext.isActive ? ext.exports : await ext.activate();
    const api = git.getAPI(1);
    const repo =
      api.getRepository(vscode.Uri.file(cwd)) ??
      api.repositories.find((r) => cwd === r.rootUri.fsPath || cwd.startsWith(`${r.rootUri.fsPath}/`));
    return { branch: repo?.state.HEAD?.name ?? (repo ? "detached" : null) };
  } catch {
    return { branch: null };
  }
};

// ---------------------------------------------------------------------------
// file-index — @ autocomplete
// ---------------------------------------------------------------------------

const IGNORED_DIRS: Record<string, true> = {
  node_modules: true, ".git": true, ".hg": true, ".svn": true,
  dist: true, build: true, ".next": true, ".cache": true,
  ".vscode-test": true, ".DS_Store": true,
};

export const fileIndexHandler: Handler<"fileIndex"> = ({ cwd, q }) => {
  if (!cwd || !existsSync(cwd)) return { files: [], truncated: false };
  const MAX_FILES = 20_000;
  const MAX_DEPTH = 8;
  const files: string[] = [];
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (truncated || depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORED_DIRS[e.name]) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.isFile()) {
        files.push(relative(cwd, abs).split("\\").join("/"));
        if (files.length >= MAX_FILES) { truncated = true; return; }
      }
    }
  };
  walk(cwd, 0);

  if (!q) return { files, truncated };
  const needle = q.toLowerCase();
  const matched = files.filter((f) => f.toLowerCase().includes(needle));
  const dirs = new Set<string>();
  for (const f of matched) {
    let idx = f.indexOf("/");
    while (idx !== -1) {
      dirs.add(f.slice(0, idx));
      idx = f.indexOf("/", idx + 1);
    }
  }
  const matches: Array<{ path: string; isDir: boolean }> = [];
  for (const d of dirs) matches.push({ path: d, isDir: true });
  for (const f of matched) matches.push({ path: f, isDir: false });
  matches.sort((a, b) =>
    a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path),
  );
  return { matches, truncated };
};

/** Complete recognized internal URL schemes without exposing arbitrary filesystem paths. */
export const urlCompleteHandler: Handler<"urlComplete"> = ({ scheme, query }) => {
  if (scheme !== "skill") return { items: [] };
  const root = join(homedir(), ".omp", "agent");
  const skills: Array<{ value: string; label?: string }> = [];
  for (const directory of [join(root, "managed-skills"), join(root, "skills")]) {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.toLowerCase().includes(query.toLowerCase())) continue;
        skills.push({ value: entry.name, label: entry.name });
      }
    } catch {
      // A missing optional skills directory has no completions.
    }
  }
  skills.sort((left, right) => left.value.localeCompare(right.value));
  return { items: skills };
};

// ---------------------------------------------------------------------------
// fs directories — the folder picker
// ---------------------------------------------------------------------------

export const fsDirectoriesListHandler: Handler<"fsDirectoriesList"> = ({ path }) => {
  const target = path && existsSync(path) ? resolve(path) : homedir();
  try {
    const entries = readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: join(target, e.name), isDir: true }));
    return { path: target, entries, parent: target === "/" ? null : dirname(target) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

export const fsDirectoriesCreateHandler: Handler<"fsDirectoriesCreate"> = ({ parentPath, folderName }) => {
  try {
    const target = join(parentPath, folderName);
    mkdirSync(target, { recursive: false });
    return { success: true, path: target };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ---------------------------------------------------------------------------
// home / defaults / project trust
// ---------------------------------------------------------------------------

export const homeHandler: Handler<"home"> = () => ({ home: process.env.HOME ?? homedir() });

export const defaultCwdHandler: Handler<"defaultCwd"> = () => ({ cwd: getOmpAgentDir() });

export const projectTrustGetHandler: Handler<"projectTrustGet"> = ({ cwd }) => ({
  trusted: true,
  cwd,
  projectRoot: cwd,
});

export const projectTrustSetHandler: Handler<"projectTrustSet"> = () => ({ trusted: true });

// ---------------------------------------------------------------------------
// worktrees (stubs — not embedded)
// ---------------------------------------------------------------------------

export const worktreesListHandler: Handler<"worktreesList"> = ({ cwd }) => ({
  projectRoot: cwd,
  isGit: false,
  isTopLevel: true,
  worktrees: [],
});

export const worktreesCreateHandler: Handler<"worktreesCreate"> = () => ({
  success: false,
  error: "Worktrees are not supported in the VS Code extension yet.",
});

export const worktreesDeleteHandler: Handler<"worktreesDelete"> = () => ({
  success: false,
  error: "Worktrees are not supported in the VS Code extension yet.",
});

export const openWorkbenchHandler: Handler<"openWorkbench"> = async () => {
  await vscode.commands.executeCommand("omp.openWorkbench");
  return { ok: true as const };
};

// Silence unused-import lint if `statSync` gets removed later.
void statSync;
