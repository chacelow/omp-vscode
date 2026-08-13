import type { AssistantPartProps } from "./types";

/** Reserved extension point; no current message block selects this renderer. */
export function DebugPart({ block }: AssistantPartProps & { debug?: boolean }) {
  if (!("debug" in block) || !block.debug) return null;
  return <pre>{JSON.stringify(block, null, 2)}</pre>;
}
