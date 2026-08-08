"use client";

// Theme follows the VS Code color theme automatically.
//
// VS Code injects `color-scheme` into webviews based on the active editor
// theme, so `prefers-color-scheme` tracks light/dark switches with zero
// manual toggling. All colors are driven by --vscode-* tokens (globals.css),
// so the UI restyles itself whenever the user changes theme.

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(cb: () => void): () => void {
  let mql: MediaQueryList | null = null;
  try {
    mql = window.matchMedia(DARK_QUERY);
    mql.addEventListener("change", cb);
  } catch {
    // matchMedia unavailable — never unsubscribe
    return () => {};
  }
  return () => mql?.removeEventListener("change", cb);
}

function getSnapshot(): Theme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function getServerSnapshot(): Theme {
  return "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    theme,
    isDark: theme === "dark",
    // The starfield theme is not used inside VS Code.
    isStarfield: false,
  };
}
