import { ThinkingBlock } from "../../MessageView";
import type { AssistantPartProps } from "./types";
import type { ThinkingContent } from "@/lib/types";

export function ThinkingPart(props: AssistantPartProps) {
  return <ThinkingBlock block={props.block as ThinkingContent} isStreaming={props.isStreaming} duration={props.streamingDuration} sessionId={props.sessionId} entryId={props.entryId} blockIndex={props.blockIndex} />;
}
