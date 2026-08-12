import { useMemo, useState } from "react";
import type { AgentMessage } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  entryIds: string[];
  onClose: () => void;
  onSelectEntry: (
    entryId: string,
    text: string,
    images: Array<{ data: string; mimeType: string }>
  ) => void;
}

function messageText(message: AgentMessage): string {
  if (!("content" in message) || !Array.isArray(message.content)) return "";
  return message.content.reduce<string>((text, block) => {
    if (
      !block ||
      typeof block !== "object" ||
      !("type" in block) ||
      block.type !== "text" ||
      !("text" in block) ||
      typeof block.text !== "string"
    )
      return text;
    return text ? `${text}\n${block.text}` : block.text;
  }, "");
}

export function UserMessageSelector({
  messages,
  entryIds,
  onClose,
  onSelectEntry,
}: Props) {
  const [query, setQuery] = useState("");
  const items = useMemo(
    () =>
      messages
        .map((message, index) => ({
          message,
          entryId: entryIds[index] ?? "",
          index,
        }))
        .filter(
          ({ message, entryId }) =>
            message.role === "user" && entryId.length > 0
        )
        .reverse()
        .filter(({ message }) =>
          messageText(message)
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        ),
    [entryIds, messages, query]
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Branch from message"
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--bg)] p-5"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
        <h2 className="text-lg">Branch from…</h2>
        <button
          type="button"
          aria-label="Close branch selector"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <input
        autoFocus
        aria-label="Filter user messages"
        className="mx-auto mt-4 w-full max-w-3xl rounded border bg-transparent p-2"
        placeholder="Filter messages"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="mx-auto mt-3 w-full max-w-3xl overflow-y-auto">
        {items.map(({ message, entryId, index }) => (
          <button
            key={entryId}
            type="button"
            className="mb-2 w-full rounded border p-3 text-left hover:bg-[var(--bg-hover)]"
            onClick={() => onSelectEntry(entryId, messageText(message), [])}
          >
            <span className="mr-2 font-mono text-xs text-[var(--text-muted)]">
              #{index + 1}
            </span>
            {messageText(message)}
          </button>
        ))}
      </div>
    </div>
  );
}
