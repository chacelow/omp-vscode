import {
  BashLine,
  ChangeLine,
  FetchLine,
  GlobLine,
  GrepLine,
  ReadLine,
  TodoCard,
  WebSearchLine,
} from "../ToolLine";
import type { ToolPartProps } from "./types";

export function ReadToolPart(props: ToolPartProps) { return <ReadLine {...props} />; }
export function GrepToolPart(props: ToolPartProps) { return <GrepLine {...props} />; }
export function GlobToolPart(props: ToolPartProps) { return <GlobLine {...props} />; }
export function WebSearchToolPart(props: ToolPartProps) { return <WebSearchLine {...props} />; }
export function FetchToolPart(props: ToolPartProps) { return <FetchLine {...props} />; }
export function BashToolPart(props: ToolPartProps) { return <BashLine {...props} />; }
export function ChangeToolPart(props: ToolPartProps) { return <ChangeLine {...props} />; }
export function TodoToolPart({ block, result }: ToolPartProps) { return <TodoCard block={block} result={result} />; }

export function DefaultToolPart(props: ToolPartProps) {
  if (props.block.toolKind === "read") return <ReadToolPart {...props} />;
  if (props.block.toolKind === "search") return <GrepToolPart {...props} />;
  if (props.block.toolKind === "fetch") return <FetchToolPart {...props} />;
  if (props.block.toolKind === "execute") return <BashToolPart {...props} />;
  if (props.block.toolKind === "edit" || props.block.toolKind === "delete" || props.block.toolKind === "move") return <ChangeToolPart {...props} />;
  return null;
}
