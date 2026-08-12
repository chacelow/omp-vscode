import { useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { hostCall } from "../../bridge";

interface Props {
  currentCwd?: string | null;
  onClose: () => void;
  onSelectSession: (session: SessionInfo) => void;
}

export function SessionResumeDialog({
  currentCwd,
  onClose,
  onSelectSession,
}: Props) {
  const [scope, setScope] = useState<"project" | "all">("project");
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  useEffect(() => {
    let active = true;
    void hostCall("sessionsList", {}).then((result) => {
      if (active) setSessions(result.sessions);
    });
    if (scope === "all") {
      void hostCall("sessionsList", {}).then((result) => {
        if (active) setSessions(result.sessions);
      });
    }
    return () => {
      active = false;
    };
  }, [scope]);
  const visible = useMemo(
    () =>
      sessions.filter(
        (session) =>
          (scope === "all" || !currentCwd || session.cwd === currentCwd) &&
          `${session.name ?? ""} ${session.firstMessage} ${session.cwd}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [currentCwd, query, scope, sessions]
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resume session"
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--bg)] p-5"
    >
      <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
        <h2 className="text-lg">Resume session</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
        <div className="ml-auto">
          <button
            type="button"
            aria-pressed={scope === "project"}
            onClick={() => setScope("project")}
          >
            Project
          </button>
          <button
            type="button"
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
          >
            All
          </button>
        </div>
      </div>
      <input
        autoFocus
        aria-label="Filter sessions"
        className="mx-auto mt-4 w-full max-w-4xl rounded border bg-transparent p-2"
        placeholder="Filter sessions"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="mx-auto mt-3 w-full max-w-4xl overflow-y-auto">
        {visible.map((session) => (
          <button
            key={session.id}
            type="button"
            className="mb-2 block w-full rounded border p-3 text-left hover:bg-[var(--bg-hover)]"
            onClick={() => onSelectSession(session)}
          >
            <strong>{session.name ?? session.firstMessage}</strong>
            <span className="ml-2 text-xs text-[var(--text-muted)]">
              {session.cwd}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
