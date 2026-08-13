import type { SessionInfo } from "@/lib/types";
import { acpRequest, hostCall } from "../../bridge";

/**
 * Thin wrappers over the webview→host and ACP transports for session-slice
 * concerns. This module is the ONLY place the session-store touches
 * `hostCall` / `acpRequest`.
 */

export async function fetchSessionsList(): Promise<{
  sessions: SessionInfo[];
  runningSessionIds?: string[];
}> {
  return await hostCall("sessionsList", {});
}

export async function fetchSessionDetail(sessionId: string): Promise<
  Awaited<ReturnType<typeof hostCall<"sessionDetail">>> | null
> {
  const detail = await hostCall("sessionDetail", { sessionId });
  return detail ?? null;
}

/**
 * ACP-native `session/new`. Returns the newly-minted session id, or null
 * when the response envelope is malformed.
 */
export async function createNewSession(cwd: string): Promise<string | null> {
  const response = await acpRequest({ type: "acp/newSession", cwd });
  if (
    !response ||
    typeof response !== "object" ||
    !("sessionId" in response) ||
    typeof response.sessionId !== "string"
  ) return null;
  return response.sessionId;
}
