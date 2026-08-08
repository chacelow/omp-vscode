import { readFileSync } from "fs";
import { join } from "path";

// ============================================================================
// omp CLI version — zero extra processes.
//
// The RPC protocol does not expose the CLI version (verified: no get_version /
// version command, no version field in get_state), so the version is read from
// the @oh-my-pi/pi-coding-agent package.json — the exact source package the
// omp CLI binary is compiled from (bun build --compile). Package version ==
// CLI version (e.g. 17.2.11), read without spawning anything.
// ============================================================================

let versionCache: string | null = null;

/** omp CLI version, e.g. "17.2.11" (from the @oh-my-pi package, cached). */
export function getOmpCliVersion(): string {
  if (versionCache !== null) return versionCache;
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(process.cwd(), "node_modules", "@oh-my-pi", "pi-coding-agent", "package.json"),
        "utf8",
      ),
    ) as { version?: string };
    versionCache = typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    versionCache = "";
  }
  return versionCache;
}
