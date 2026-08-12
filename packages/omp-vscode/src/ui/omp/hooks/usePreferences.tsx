"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { hostCall } from "../../bridge";

interface PreferencesContextValue {
  showImages: boolean;
  refreshPreferences: () => Promise<void>;
  setShowImages: (showImages: boolean) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readShowImages(value: Record<string, unknown>): boolean {
  return typeof value.showImages === "boolean" ? value.showImages : true;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [showImages, setShowImagesState] = useState(true);

  const refreshPreferences = useCallback(async () => {
    const display = await hostCall("settingsGet", { category: "display" });
    setShowImagesState(readShowImages(display));
  }, []);

  useEffect(() => {
    void refreshPreferences().catch(() => undefined);
  }, [refreshPreferences]);

  const setShowImages = useCallback(async (next: boolean) => {
    setShowImagesState(next);
    await hostCall("settingsSet", {
      category: "display",
      key: "showImages",
      value: next,
    });
  }, []);

  const value = useMemo(
    () => ({ showImages, refreshPreferences, setShowImages }),
    [refreshPreferences, setShowImages, showImages]
  );
  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const preferences = useContext(PreferencesContext);
  if (!preferences)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return preferences;
}
