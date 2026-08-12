import { useEffect, useMemo, useState } from "react";
import type {
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
} from "@/lib/types";

export enum CopyTargetKind {
  AssistantText = "assistant-text",
  CodeBlock = "code-block",
  ToolOutput = "tool-output",
  BashCommand = "bash-command",
  Model = "model",
  SessionId = "session-id",
  Cwd = "cwd",
}
export interface CopyTarget {
  id: string;
  kind: CopyTargetKind;
  label: string;
  content: string;
  hint?: string;
}
interface CopySelectorProps {
  messages: AgentMessage[];
  model?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
  onClose: () => void;
  onCopied?: (label: string) => void;
}

function textFromContent(
  content: AssistantMessage["content"] | ToolResultMessage["content"]
): string {
  const parts: string[] = [];
  for (const block of content) {
    if (
      block.type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}
function codeTargets(text: string, prefix: string): CopyTarget[] {
  return Array.from(text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)).map(
    (match, index) => ({
      id: `${prefix}:code:${index}`,
      kind: CopyTargetKind.CodeBlock,
      label: `Code block ${index + 1}${match[1].trim() ? ` (${match[1].trim()})` : ""}`,
      content: match[2],
      hint: match[1].trim() || undefined,
    })
  );
}
export function buildCopyTargets(
  messages: AgentMessage[],
  model?: string | null,
  sessionId?: string | null,
  cwd?: string | null
): CopyTarget[] {
  const targets: CopyTarget[] = [];
  const assistant = messages.findLast(
    (message) => message.role === "assistant"
  );
  if (assistant?.role === "assistant") {
    const text = textFromContent(assistant.content);
    if (text) {
      targets.push({
        id: "assistant:last",
        kind: CopyTargetKind.AssistantText,
        label: "Last assistant response",
        content: text,
      });
      targets.push(...codeTargets(text, "assistant:last"));
    }
  }
  const tool = messages.findLast((message) => message.role === "toolResult");
  if (tool?.role === "toolResult") {
    const text = textFromContent(tool.content);
    if (text)
      targets.push({
        id: "tool:last",
        kind: CopyTargetKind.ToolOutput,
        label: "Last tool result",
        content: text,
      });
  }
  const bash = messages.findLast((message) => message.role === "bashExecution");
  if (bash?.role === "bashExecution") {
    targets.push({
      id: "bash:last:command",
      kind: CopyTargetKind.BashCommand,
      label: "Last bash command",
      content: bash.command,
    });
    if (bash.output)
      targets.push({
        id: "bash:last:output",
        kind: CopyTargetKind.ToolOutput,
        label: "Last bash output",
        content: bash.output,
      });
  }
  if (model)
    targets.push({
      id: "session:model",
      kind: CopyTargetKind.Model,
      label: "Current model",
      content: model,
    });
  if (sessionId)
    targets.push({
      id: "session:id",
      kind: CopyTargetKind.SessionId,
      label: "Session ID",
      content: sessionId,
    });
  if (cwd)
    targets.push({
      id: "session:cwd",
      kind: CopyTargetKind.Cwd,
      label: "Current working directory",
      content: cwd,
    });
  return targets;
}
export function CopySelector({
  messages,
  model,
  sessionId,
  cwd,
  onClose,
  onCopied,
}: CopySelectorProps) {
  const targets = useMemo(
    () => buildCopyTargets(messages, model, sessionId, cwd),
    [messages, model, sessionId, cwd]
  );
  const [index, setIndex] = useState(0);
  const selected = targets[index];
  const copy = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.content);
    onCopied?.(selected.label);
    onClose();
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, targets.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void copy();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose, targets.length, selected]);
  return (
    <div className="absolute inset-0 z-[95] flex items-center justify-center bg-black/30 p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Copy selector"
        className="border-border bg-background w-full max-w-2xl rounded-lg border shadow-xl"
      >
        <header className="border-border border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Copy</h2>
          <p className="text-muted-foreground text-xs">
            Use ↑/↓ and Enter to copy.
          </p>
        </header>
        <main className="grid max-h-[60vh] overflow-y-auto p-2">
          {targets.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">
              Nothing to copy yet.
            </p>
          ) : (
            targets.map((target, targetIndex) => (
              <button
                type="button"
                key={target.id}
                onClick={() => {
                  setIndex(targetIndex);
                  void navigator.clipboard
                    .writeText(target.content)
                    .then(() => {
                      onCopied?.(target.label);
                      onClose();
                    });
                }}
                className={`rounded p-3 text-left text-sm ${targetIndex === index ? "bg-muted" : "hover:bg-muted/60"}`}
              >
                <strong>{target.label}</strong>
                <span className="text-muted-foreground block truncate text-xs">
                  {target.content}
                </span>
              </button>
            ))
          )}
        </main>
        <footer className="border-border flex justify-end border-t p-3">
          <button
            type="button"
            onClick={onClose}
            className="border-border rounded border px-3 py-2 text-sm"
          >
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}
