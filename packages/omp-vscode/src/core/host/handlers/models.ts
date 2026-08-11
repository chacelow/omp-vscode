import type { Handler } from "./index";
import { parseModelRef, readOmpConfig, readOmpModelsFromConfig, readOmpModelsFromDb } from "../../omp-models";

/** GET /api/models equivalent: read the user's configured model list locally.
 *  `currentModel` / `fastMode*` are derived by the webview from the ACP
 *  snapshot; here we return null/false so the shape stays stable. */
export const modelsGetHandler: Handler<"modelsGet"> = () => {
  const config = readOmpConfig();
  const roles = config.modelRoles ?? {};

  const modelRoles: Record<string, { provider: string; modelId: string; thinkingLevel?: string }> = {};
  for (const [role, ref] of Object.entries(roles)) {
    if (!ref) continue;
    const parsed = parseModelRef(ref);
    if (!parsed) continue;
    const thinkingIdx = ref.lastIndexOf(":");
    const thinking = thinkingIdx > 0 ? ref.slice(thinkingIdx + 1) : undefined;
    if (thinking && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) {
      modelRoles[role] = { ...parsed, thinkingLevel: thinking };
    } else {
      modelRoles[role] = parsed;
    }
  }
  const defaultModel = parseModelRef(roles.default) ?? null;

  const configItems = readOmpModelsFromConfig();
  const roleProviders = new Set(Object.values(modelRoles).map((r) => r.provider));
  const configProviders = new Set(configItems.map((m) => m.provider));
  const dbItems = readOmpModelsFromDb().filter((m) => roleProviders.has(m.provider) && !configProviders.has(m.provider));

  const items = [...configItems, ...dbItems];
  const modelList = items.map((m) => ({ id: m.id, name: m.name, provider: m.provider }));
  const models: Record<string, string> = {};
  for (const m of items) if (!models[m.id]) models[m.id] = m.name;

  return {
    models,
    modelList,
    defaultModel,
    currentModel: null,
    fastModeEnabled: false,
    fastModeActive: false,
    modelRoles,
    thinkingLevels: {},
    thinkingLevelMaps: {},
    thinkingLevelPins: {},
    modelError: null,
    modelScopeWarnings: [],
  };
};
