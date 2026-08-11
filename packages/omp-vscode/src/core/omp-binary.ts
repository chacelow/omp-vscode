import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Locate the configured OMP executable, then standard installation locations. */
export function resolveOmpBinary(): string {
  const candidates = [
    process.env.OMP_CLI_PATH,
    join(homedir(), ".bun", "bin", "omp"),
    join(homedir(), ".local", "bin", "omp"),
    "/opt/homebrew/bin/omp",
    "/usr/local/bin/omp",
    "omp",
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => candidate === "omp" || existsSync(candidate)) ?? "omp";
}
