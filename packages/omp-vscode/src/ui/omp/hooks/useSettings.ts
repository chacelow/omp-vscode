import { useSettingsStore } from "@/state/settings-store";

/**
 * Selector hooks for the display-preference slice.
 *
 * Each hook returns the narrowest slice a caller needs, so components
 * subscribe to just what they render and re-render only on that change.
 */

export const useShowImages = (): boolean =>
  useSettingsStore((s) => s.display.showImages);

export const useRefreshSettings = (): (() => Promise<void>) =>
  useSettingsStore((s) => s.refresh);

export const useSetShowImages = (): ((next: boolean) => Promise<void>) =>
  useSettingsStore((s) => s.setShowImages);
