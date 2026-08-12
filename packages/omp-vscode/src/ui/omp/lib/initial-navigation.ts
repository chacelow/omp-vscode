export interface InitialNavigation {
  requestedCwd: string | null;
  sessionId: string | null;
}

const LAST_SESSION_KEY = "omp.lastSession";

/** Persist the last opened session (id + its cwd) so reopening VS Code —
 *  which reloads the webview with only the workspace `cwd` param — restores
 *  the previous conversation instead of a blank chat. */
export function rememberLastSession(
  sessionId: string | null,
  cwd?: string | null
): void {
  try {
    if (sessionId)
      localStorage.setItem(
        LAST_SESSION_KEY,
        JSON.stringify({ sessionId, cwd: cwd ?? null })
      );
    else localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // localStorage unavailable — restore is best-effort.
  }
}

function readLastSession(): { sessionId: string; cwd: string | null } | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const sessionId =
      "sessionId" in parsed && typeof parsed.sessionId === "string"
        ? parsed.sessionId
        : null;
    if (!sessionId) return null;
    const cwd =
      "cwd" in parsed && typeof parsed.cwd === "string" ? parsed.cwd : null;
    return { sessionId, cwd };
  } catch {
    return null;
  }
}

/** In VS Code the webview ALWAYS boots with a `cwd` param (the workspace
 *  folder, injected by the useSearchParams shim) and never a `session`
 *  param — session restore MUST take priority over the new-session-in-cwd
 *  flow, but only when the remembered session belongs to this workspace
 *  (same cwd, or a subdirectory such as a worktree). */
export function getInitialNavigation(
  searchParams: Pick<URLSearchParams, "get">
): InitialNavigation {
  const explicitSession = searchParams.get("session");
  if (explicitSession)
    return { requestedCwd: null, sessionId: explicitSession };

  const requestedCwd = searchParams.get("cwd")?.trim() || null;
  const last = readLastSession();
  if (
    last &&
    (!requestedCwd ||
      !last.cwd ||
      last.cwd === requestedCwd ||
      last.cwd.startsWith(`${requestedCwd}/`))
  ) {
    return { requestedCwd: null, sessionId: last.sessionId };
  }
  return { requestedCwd, sessionId: null };
}
