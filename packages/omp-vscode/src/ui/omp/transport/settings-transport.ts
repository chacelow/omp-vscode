import { hostCall } from "../../bridge";

/**
 * Thin wrapper over the webview→host bridge for the "display" settings
 * category. This module is the ONLY place in the omp app allowed to touch
 * `hostCall` for display prefs; the settings store consumes these functions.
 */

const CATEGORY = "display";

export async function fetchDisplaySettings(): Promise<Record<string, unknown>> {
  return await hostCall("settingsGet", { category: CATEGORY });
}

export async function writeDisplaySetting(
  key: string,
  value: unknown
): Promise<void> {
  await hostCall("settingsSet", { category: CATEGORY, key, value });
}
