import { useEffect, useRef, useState } from "react";
import { MessageView } from "../MessageView";
import { hostCall } from "../../../bridge";
import type { AgentMessage } from "@/lib/types";

interface TranscriptEntry {
  id: string;
  message: AgentMessage;
}

interface Props {
  focused: boolean;
  sessionId: string | null;
  onMetrics?: (metrics: {
    messages: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }) => void;
}
export function AgentTranscriptViewer({
  focused,
  sessionId,
  onMetrics,
}: Props) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const revisionRef = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEntries([]);
    revisionRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!focused || !sessionId) return;
    let active = true;
    const load = async () => {
      const isInitialLoad = revisionRef.current === null;
      try {
        const update = await hostCall("sessionTail", {
          sessionId,
          sinceRevision: revisionRef.current,
        });
        if (!active || !update) return;
        revisionRef.current = update.revision;
        if (update.entries.length > 0) {
          setEntries((current) =>
            isInitialLoad ? update.entries : [...current, ...update.entries]
          );
        }
      } catch {
        // The session may be deleted while the hub is open.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [focused, sessionId]);
  useEffect(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    for (const entry of entries) {
      if (entry.message.role !== "assistant") continue;
      inputTokens += entry.message.usage?.input ?? 0;
      outputTokens += entry.message.usage?.output ?? 0;
      cost += entry.message.usage?.cost.total ?? 0;
    }
    onMetrics?.({ messages: entries.length, inputTokens, outputTokens, cost });
  }, [entries, onMetrics]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-muted)]">
        Select an agent session to inspect its transcript.
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto px-5 py-4"
      aria-label="Agent transcript"
    >
      {entries.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)]">
          No transcript entries yet.
        </div>
      ) : (
        entries.map(({ id, message }) => (
          <MessageView
            key={id}
            message={message}
            entryId={id}
            sessionId={sessionId}
            hideFork
          />
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
