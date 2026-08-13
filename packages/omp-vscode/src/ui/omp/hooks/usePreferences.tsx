"use client";

import { useEffect, useMemo, type ReactNode } from "react";

import { useSettingsStore } from "@/state/settings-store";

/**
 * Backwards-compatible facade over the display-preference slice
 * (`@/state/settings-store`).
 *
 * The former React Context has been retired; this file now exists so that
 * existing consumers importing `PreferencesProvider` / `usePreferences`
 * continue to work unchanged during the incremental migration to the new
 * modular state architecture. New code SHOULD import from
 * `@/hooks/useSettings` and `@/state/settings-store` directly.
 */

interface PreferencesContextValue {
  showImages: boolean;
  refreshPreferences: () => Promise<void>;
  setShowImages: (showImages: boolean) => Promise<void>;
}

/**
 * Kept as a mount-time trigger for the initial settings fetch so callers
 * that wrap their subtree in `<PreferencesProvider>` continue to hydrate the
 * store exactly as they did before. The store itself is a global singleton;
 * no React context is created.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void useSettingsStore.getState().refresh();
  }, []);
  return <>{children}</>;
}

export function usePreferences(): PreferencesContextValue {
  const showImages = useSettingsStore((s) => s.display.showImages);
  const refreshPreferences = useSettingsStore((s) => s.refresh);
  const setShowImages = useSettingsStore((s) => s.setShowImages);
  return useMemo(
    () => ({ showImages, refreshPreferences, setShowImages }),
    [showImages, refreshPreferences, setShowImages]
  );
}
