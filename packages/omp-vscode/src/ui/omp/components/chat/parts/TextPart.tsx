import { TextBlock } from "../../MessageView";
import type { AssistantPartProps } from "./types";
import type { TextContent } from "@/lib/types";

export function TextPart(props: AssistantPartProps) {
  return <TextBlock block={props.block as TextContent} isStreaming={props.isStreaming} cwd={props.cwd} onOpenFile={props.onOpenFile} snapReveal={props.snapReveal} />;
}
