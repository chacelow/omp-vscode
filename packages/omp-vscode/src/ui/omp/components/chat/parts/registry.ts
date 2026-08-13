import type { ComponentType } from "react";
import type { AssistantContentBlock } from "@/lib/types";
import { ImagePart } from "./ImagePart";
import { TextPart } from "./TextPart";
import { ThinkingPart } from "./ThinkingPart";
import { ToolCallPart } from "./ToolCallPart";
import {
  ChangeToolPart,
  FetchToolPart,
  GlobToolPart,
  GrepToolPart,
  ReadToolPart,
  TodoToolPart,
  WebSearchToolPart,
} from "./tools";
import { BashToolPart } from "./tools/BashToolPart";
import { EditToolPart } from "./tools/EditToolPart";
import { WriteToolPart } from "./tools/WriteToolPart";
import type { AssistantPartProps, PartRenderer, ToolPartProps, ToolRenderer } from "./types";

export const partRegistry: Record<AssistantContentBlock["type"], PartRenderer> = {
  text: TextPart,
  image: ImagePart,
  thinking: ThinkingPart,
  toolCall: ToolCallPart,
};

/**
 * Per-tool renderers. Edit / write / create / multi_edit go through the
 * vendored `<CodeDiff>`-backed renderer. `delete` / `move` / `rename` stay
 * on the legacy `ChangeToolPart` line style — those tools don't produce
 * a hunk to draw and the diff card would be visually empty.
 */
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
  edit: EditToolPart,
  write: WriteToolPart,
  create: WriteToolPart,
  multi_edit: EditToolPart,
  delete: ChangeToolPart,
  move: ChangeToolPart,
  rename: ChangeToolPart,
};

export type { AssistantPartProps, ToolPartProps, PartRenderer, ToolRenderer, ComponentType };
