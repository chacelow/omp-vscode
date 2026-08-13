import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import {
  fetchDisplaySettings,
  writeDisplaySetting,
} from "@/transport/settings-transport";

/**
 * Display-preference slice.
 *
 * Migrated from the former `PreferencesProvider` React Context. Consumers
 * reach this store exclusively through `@/hooks/useSettings` or the
 * backwards-compatible `@/hooks/usePreferences` shim.
 */

export interface DisplaySettings {
  showImages: boolean;
}

interface SettingsState {
  display: DisplaySettings;
  /** Refresh display settings from the host (safe to call at any time). */
  refresh(): Promise<void>;
  /** Optimistically update `showImages` and persist to the host. */
  setShowImages(next: boolean): Promise<void>;
}

const DEFAULT_DISPLAY: DisplaySettings = { showImages: true };

function readShowImages(raw: Record<string, unknown>): boolean {
  return typeof raw.showImages === "boolean" ? raw.showImages : true;
}

export const useSettingsStore = create<SettingsState>()(
  immer((set) => ({
    display: DEFAULT_DISPLAY,
    refresh: async () => {
      try {
        const raw = await fetchDisplaySettings();
        set((s) => {
          s.display.showImages = readShowImages(raw);
        });
      } catch {
        // Preserve the pre-migration behavior of silently tolerating
        // transient host errors during initial fetch.
      }
    },
    setShowImages: async (next: boolean) => {
      set((s) => {
        s.display.showImages = next;
      });
      await writeDisplaySetting("showImages", next);
    },
  }))
);
