import { readFileSync } from "fs";
import { join } from "path";
import type { Handler } from "./index";
import { getOmpCliVersion } from "../omp-cli";

export const versionHandler: Handler<"version"> = async () => {
  let omp = "";
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    ) as { version?: string };
    omp = pkg.version ?? "";
  } catch {
    // package.json unavailable — leave empty.
  }
  return { pi: "", omp, cli: await getOmpCliVersion() };
};
