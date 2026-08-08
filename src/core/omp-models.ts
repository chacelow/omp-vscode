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
