import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getOmpAgentDir } from "./session-reader";
import { parse as parseYaml } from "yaml";

// ============================================================================
// OMP model + config reading (extended-host edition)
//
// The omp CLI maintains its model catalog in ~/.omp/agent/models.db
// (model_cache table: provider_id → models JSON) and role defaults in
// config.yml (modelRoles: default/smol/slow/plan). Read them directly —
// the RPC protocol has no config-management commands.
// ============================================================================

export interface OmpModelItem {
  id: string;
  name: string;
  provider: string;
}

/** OMP's own model cache (~/.omp/agent/models.db) — written by the CLI, read
 *  without network. Used when get_available_models stalls on a remote
 *  custom provider (e.g. a slow cursor-proxy baseUrl). */
export function readOmpModelsFromDb(): OmpModelItem[] {
  const dbPath = join(getOmpAgentDir(), "models.db");
  if (!existsSync(dbPath)) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT provider_id, models FROM model_cache").all() as Array<{ provider_id: string; models: string }>;
    db.close();
    const items: OmpModelItem[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.models) as Array<{ id: string; name?: string }>;
        if (Array.isArray(parsed)) {
          for (const m of parsed) {
            if (m && m.id) items.push({ id: m.id, name: m.name || m.id, provider: row.provider_id });
          }
        }
      } catch {
        // ignore row parse error
      }
    }
    if (items.length > 0) return items;
  } catch {
    // fall through to regex parse
  }
  try {
    const fileStr = readFileSync(dbPath).toString("utf8");
    const items: OmpModelItem[] = [];
    const jsonMatch = fileStr.match(/\[\s*\{\s*"id"\s*:[\s\S]*?\]/g);
    if (jsonMatch) {
      for (const block of jsonMatch) {
        try {
          const parsed = JSON.parse(block) as Array<{ id: string; name?: string; provider?: string }>;
          if (Array.isArray(parsed)) {
            for (const m of parsed) {
              if (m && m.id) items.push({ id: m.id, name: m.name || m.id, provider: m.provider || "omp" });
            }
          }
        } catch {
          // ignore invalid blocks
        }
      }
    }
    return items;
  } catch {
    return [];
  }
}

export interface OmpConfig {
  modelRoles?: {
    default?: string;
    smol?: string;
    slow?: string;
    plan?: string;
    [key: string]: string | undefined;
  };
  shellPath?: string;
  setupVersion?: number;
}

export function readOmpConfig(): OmpConfig {
  const configPath = join(getOmpAgentDir(), "config.yml");
  if (!existsSync(configPath)) return {};
  try {
    const content = readFileSync(configPath, "utf8");
    return (parseYaml(content) as OmpConfig) || {};
  } catch {
    return {};
  }
}

/** Parse "provider/model-id" (or "provider/model:id") into {provider, modelId}. */
export function parseModelRef(ref: string | undefined): { provider: string; modelId: string } | null {
  if (!ref) return null;
  let clean = ref.trim();
  const colonIdx = clean.lastIndexOf(":");
  if (colonIdx > 0) clean = clean.slice(0, colonIdx);
  const slashIdx = clean.indexOf("/");
  if (slashIdx > 0) {
    return { provider: clean.slice(0, slashIdx), modelId: clean.slice(slashIdx + 1) };
  }
  return null;
}
