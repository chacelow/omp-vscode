export interface InitialNavigation {
  requestedCwd: string | null;
  sessionId: string | null;
}

const LAST_SESSION_KEY = "omp.lastSessionId";

/** Persist the last opened session so reopening VS Code (which drops URL
 *  params — the webview reloads at "/") restores the previous conversation
 *  instead of a blank chat. localStorage survives webview reloads because
 *  the webview origin is stable per extension. */
export function rememberLastSession(sessionId: string | null): void {
  try {
    if (sessionId) localStorage.setItem(LAST_SESSION_KEY, sessionId);
    else localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // localStorage unavailable (e.g. blocked) — restore is best-effort.
  }
}

export function getInitialNavigation(searchParams: Pick<URLSearchParams, "get">): InitialNavigation {
  const requestedCwd = searchParams.get("cwd")?.trim() || null;
  if (requestedCwd) return { requestedCwd, sessionId: null };

  let sessionId = searchParams.get("session");
  if (!sessionId) {
    try {
      sessionId = localStorage.getItem(LAST_SESSION_KEY);
    } catch {
      sessionId = null;
    }
  }
  return { requestedCwd: null, sessionId };
}
