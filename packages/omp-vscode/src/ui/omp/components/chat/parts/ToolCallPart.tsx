import { ToolCallBlock } from "../../MessageView";
import type { AssistantPartProps } from "./types";
import type { ToolCallContent } from "@/lib/types";

export function ToolCallPart(props: AssistantPartProps) {
  const block = props.block as ToolCallContent;
  return <ToolCallBlock block={block} result={props.toolResults?.get(block.toolCallId)} duration={props.toolCallDurations?.get(block.toolCallId)} onOpenFile={props.onOpenFile} isStreaming={props.isStreaming} expanded={props.expandAllTools} />;
}
