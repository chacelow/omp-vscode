import { NextResponse } from "next/server";
import { getRpcCapabilities } from "@/lib/rpc-protocol";

// GET /api/capabilities — the OMP RPC capability map (commands, params,
// description, and whether the webview wires them up). Lets a new client/agent
// discover what the backend can do without reading source.
export async function GET() {
  return NextResponse.json({
    backend: "omp-rpc",
    protocol: "omp --mode rpc (JSONL stdin/stdout)",
    capabilities: getRpcCapabilities(),
  });
}
