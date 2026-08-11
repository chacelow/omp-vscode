import { spawn } from "child_process";
import { resolveOmpBinary } from "../omp-binary";

let cliVersionCache: string | null = null;

/** `omp -v` output, cached for the extension's lifetime. */
export async function getOmpCliVersion(): Promise<string> {
  if (cliVersionCache !== null) return cliVersionCache;
  try {
    const child = spawn(resolveOmpBinary(), ["-v"]);
    let out = "";
    for await (const chunk of child.stdout) out += String(chunk);
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
    cliVersionCache = out.trim();
  } catch {
    cliVersionCache = "";
  }
  return cliVersionCache;
}
