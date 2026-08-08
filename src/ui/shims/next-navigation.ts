// Minimal mock of next/navigation for the webview environment.
// omp-web's AppShell reads URL state through these hooks; in VS Code the
// sidebar view has no URL, so we provide no-op stubs that keep the app
// on the "new session" flow.

export function useRouter() {
  return {
    push: (_url: string, _opts?: unknown) => {},
    replace: (_url: string, _opts?: unknown) => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  };
}

export function useSearchParams(): URLSearchParams {
  // The extension host passes the active workspace folder via #app[data-cwd]
  // so sessions follow the currently opened directory.
  const params = new URLSearchParams("");
  try {
    const cwd = document.getElementById("app")?.getAttribute("data-cwd");
    if (cwd) params.set("cwd", cwd);
  } catch {
    // ignore
  }
  return params;
}

export function usePathname(): string {
  return "/";
}

export function useParams(): Record<string, string> {
  return {};
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

export function redirect(): never {
  throw new Error("redirect() is not supported inside the VS Code webview");
}
