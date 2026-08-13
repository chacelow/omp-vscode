import type { ComponentType } from "react";
import type { AssistantContentBlock } from "@/lib/types";
import { ImagePart } from "./ImagePart";
import { TextPart } from "./TextPart";
import { ThinkingPart } from "./ThinkingPart";
import { ToolCallPart } from "./ToolCallPart";
import {
  BashToolPart,
  ChangeToolPart,
  FetchToolPart,
  GlobToolPart,
  GrepToolPart,
  ReadToolPart,
  TodoToolPart,
  WebSearchToolPart,
} from "./tools";
import type { AssistantPartProps, PartRenderer, ToolPartProps, ToolRenderer } from "./types";
export const partRegistry: Record<AssistantContentBlock["type"], PartRenderer> = {
  text: TextPart,
  image: ImagePart,
  thinking: ThinkingPart,
  toolCall: ToolCallPart,
};
export const toolRenderers: Record<string, ToolRenderer> = {
  todo: TodoToolPart,
  read: ReadToolPart,
  grep: GrepToolPart,
  grepped: GrepToolPart,
  glob: GlobToolPart,
  web_search: WebSearchToolPart,
  websearch: WebSearchToolPart,
  fetch: FetchToolPart,
  web_fetch: FetchToolPart,
  webfetch: FetchToolPart,
  bash: BashToolPart,
  run: BashToolPart,
  shell: BashToolPart,
  edit: ChangeToolPart,
  write: ChangeToolPart,
  create: ChangeToolPart,
  delete: ChangeToolPart,
  move: ChangeToolPart,
  rename: ChangeToolPart,
  multi_edit: ChangeToolPart,
};
export type { AssistantPartProps, ToolPartProps, PartRenderer, ToolRenderer, ComponentType };
