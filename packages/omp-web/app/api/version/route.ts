import { NextResponse } from "next/server";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "fs";
import { join } from "path";
import { getOmpCliVersion } from "@/lib/omp-cli";

// GET /api/version — pi kernel version (SDK), omp-web version (package.json),
// and the installed omp CLI version (from `omp -v`, cached 1h).
export async function GET() {
  let omp = "";
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as {
      version?: string;
    };
    omp = pkg.version ?? "";
  } catch {
    // package.json unavailable
  }
  return NextResponse.json({ pi: VERSION, omp, cli: getOmpCliVersion() });
}
