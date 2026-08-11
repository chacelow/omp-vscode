import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { dump, load } from "js-yaml";
import { z } from "zod";
import {
  flattenModelsDevCatalog,
  recommendModelCatalogPreset,
} from "../../../ui/omp/lib/model-catalog";
import {
  buildModelsListUrl,
  parseDiscoveredModels,
} from "../../../ui/omp/lib/model-discovery";
import { getOmpAgentDir } from "../../session-reader";
import type { Handler } from "./index";

const discoveryTimeoutMs = 20_000;
const modelTestTimeoutMs = 20_000;
const catalogTimeoutMs = 15_000;
const modelsDevelopmentUrl = "https://models.dev/api.json";
const recordSchema = z.record(z.string(), z.unknown());

const parseRecord = (value: unknown): Record<string, unknown> | undefined => {
  const result = recordSchema.safeParse(value);
  return result.success ? result.data : undefined;
};

interface ModelsConfigDocument extends Record<string, unknown> {
  providers: Record<string, unknown>;
}

function readModelsConfig(): ModelsConfigDocument {
  const modelsPath = path.join(getOmpAgentDir(), "models.yml");
  if (!existsSync(modelsPath)) return { providers: {} };
  const parsed = parseRecord(load(readFileSync(modelsPath, "utf-8")));
  if (!parsed) return { providers: {} };
  return {
    ...parsed,
    providers: parseRecord(parsed.providers) ?? {},
  };
}

function stringRecord(value: unknown): Record<string, string> {
  const record = parseRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function buildDiscoveryHeaders(
  api: string,
  apiKey: string | undefined,
  configured: Record<string, string>
): Headers {
  const headers = new Headers(configured);
  if (!headers.has("accept")) headers.set("Accept", "application/json");
  if (!apiKey) return headers;
  if (api === "anthropic-messages") {
    if (!headers.has("x-api-key")) headers.set("x-api-key", apiKey);
    if (!headers.has("anthropic-version"))
      headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!headers.has("x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!headers.has("authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

async function resolveProviderAuth(
  providerName: string,
  provider: Record<string, unknown>
): Promise<{ apiKey?: string; headers: Record<string, string> }> {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "omp-vscode-model-auth-")
  );
  try {
    const modelsPath = path.join(temporaryDirectory, "models.json");
    const modelId = "__omp_vscode_discovery__";
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [providerName]: {
            ...provider,
            models: [{ id: modelId }],
          },
        },
      }),
      "utf-8"
    );
    const runtime = await ModelRuntime.create({
      authPath: path.join(getOmpAgentDir(), "auth.json"),
      modelsPath,
      allowModelNetwork: false,
    });
    const loadError = runtime.getError();
    if (loadError) throw new Error(loadError);
    const model = runtime.getModel(providerName, modelId);
    if (!model) throw new Error(`Unable to load provider "${providerName}"`);
    const resolved = await runtime.getAuth(model);
    if (resolved) {
      return {
        apiKey: resolved.auth.apiKey,
        headers: stringRecord(resolved.auth.headers),
      };
    }
    return {
      headers: stringRecord(
        runtime.getCompatibilityRequestConfig(model).headers
      ),
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function firstPositiveInteger(
  record: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const raw = record[key];
    const number =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim()
          ? Number(raw)
          : Number.NaN;
    if (Number.isFinite(number) && number > 0) return Math.floor(number);
  }
  return undefined;
}

function extractMetadata(value: unknown): {
  contextWindow?: number;
  maxTokens?: number;
} {
  const record = parseRecord(value);
  if (!record) return {};
  const records = [
    record,
    record.limits,
    record.capabilities,
    record.metadata,
  ].flatMap((candidate) => {
    const parsed = parseRecord(candidate);
    return parsed ? [parsed] : [];
  });
  let contextWindow: number | undefined;
  let maxTokens: number | undefined;
  for (const record of records) {
    contextWindow ??= firstPositiveInteger(record, [
      "contextWindow",
      "context_window",
      "contextLength",
      "context_length",
      "maxContextLength",
      "max_context_length",
      "maxInputTokens",
      "max_input_tokens",
      "inputTokenLimit",
      "input_token_limit",
    ]);
    maxTokens ??= firstPositiveInteger(record, [
      "maxTokens",
      "max_tokens",
      "maxOutputTokens",
      "max_output_tokens",
      "maxCompletionTokens",
      "max_completion_tokens",
      "outputTokenLimit",
      "output_token_limit",
    ]);
  }
  return {
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

function metadataFromPayload(
  payload: unknown,
  modelId: string
): { contextWindow?: number; maxTokens?: number } {
  let items: unknown[] = [];
  if (Array.isArray(payload)) {
    items = payload;
  } else {
    const record = parseRecord(payload);
    if (Array.isArray(record?.data)) items = record.data;
    else if (Array.isArray(record?.models)) items = record.models;
  }
  const normalizedId = modelId.trim().toLocaleLowerCase();
  return extractMetadata(
    items.find((item) => {
      const record = parseRecord(item);
      return (
        typeof record?.id === "string" &&
        record.id.toLocaleLowerCase() === normalizedId
      );
    })
  );
}

function assistantText(message: unknown): string {
  const record = parseRecord(message);
  if (!Array.isArray(record?.content)) return "";
  return record.content
    .flatMap((block) => {
      const parsed = parseRecord(block);
      return parsed?.type === "text" && typeof parsed.text === "string"
        ? [parsed.text]
        : [];
    })
    .join("")
    .slice(0, 300);
}

export const modelsConfigGetHandler: Handler<"modelsConfigGet"> = () =>
  readModelsConfig();

export const modelsConfigSetHandler: Handler<"modelsConfigSet"> = (params) => {
  const parsedParams = parseRecord(params);
  if (!parsedParams)
    return { success: false, error: "Models configuration must be an object" };
  const current = readModelsConfig();
  const providers = parseRecord(parsedParams.providers) ?? current.providers;
  const next = { ...current, ...parsedParams, providers };
  const modelsPath = path.join(getOmpAgentDir(), "models.yml");
  mkdirSync(path.dirname(modelsPath), { recursive: true });
  writeFileSync(
    modelsPath,
    dump(next, { lineWidth: -1, noRefs: true }),
    "utf-8"
  );
  return { success: true };
};

export const modelsConfigDiscoverHandler: Handler<
  "modelsConfigDiscover"
> = async (params) => {
  const parsedParams = parseRecord(params);
  if (!parsedParams) return { error: "Invalid discovery request" };
  const providerName =
    typeof parsedParams.providerName === "string"
      ? parsedParams.providerName.trim()
      : "";
  const provider = parseRecord(parsedParams.provider);
  if (!providerName || !provider)
    return { error: "Provider name and configuration are required" };
  const baseUrl =
    typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
  if (!baseUrl) return { error: "Base URL is required" };
  const api =
    typeof provider.api === "string" && provider.api
      ? provider.api
      : "openai-completions";

  try {
    const endpoint = buildModelsListUrl(baseUrl, api);
    const auth = await resolveProviderAuth(providerName, provider);
    const response = await fetch(endpoint, {
      headers: buildDiscoveryHeaders(api, auth.apiKey, auth.headers),
      signal: AbortSignal.timeout(discoveryTimeoutMs),
    });
    const responseText = await response.text();
    if (!response.ok)
      return {
        error:
          responseText.slice(0, 500) ||
          `Upstream returned HTTP ${response.status}`,
      };
    const models = parseDiscoveredModels(JSON.parse(responseText));
    if (models.length === 0)
      return { error: "No models found in the upstream response" };
    return { models, endpoint: endpoint.toString() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export const modelsConfigMetadataHandler: Handler<
  "modelsConfigMetadata"
> = async (params) => {
  const parsedParams = parseRecord(params);
  if (!parsedParams)
    return { ok: false, error: "Invalid metadata request" };
  const providerName =
    typeof parsedParams.providerName === "string"
      ? parsedParams.providerName.trim()
      : "";
  const modelId =
    typeof parsedParams.modelId === "string" ? parsedParams.modelId.trim() : "";
  const provider = parseRecord(parsedParams.provider);
  if (!providerName || !modelId || !provider)
    return { ok: false, error: "Provider and model are required" };

  const currentConfig = readModelsConfig();
  const configuredProvider = parseRecord(
    currentConfig.providers[providerName]
  );
  if (Array.isArray(configuredProvider?.models)) {
    const configuredModel = configuredProvider.models.find((model) => {
      const record = parseRecord(model);
      return record?.id === modelId;
    });
    const metadata = extractMetadata(configuredModel);
    if (
      metadata.contextWindow !== undefined ||
      metadata.maxTokens !== undefined
    ) {
      return { ok: true, ...metadata, source: "models.yml" };
    }
  }

  const baseUrl =
    typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
  if (!baseUrl)
    return {
      ok: false,
      error: `No limits found for ${providerName}/${modelId}`,
    };
  try {
    const api =
      typeof provider.api === "string" && provider.api
        ? provider.api
        : "openai-completions";
    const endpoint = buildModelsListUrl(baseUrl, api);
    const auth = await resolveProviderAuth(providerName, provider);
    const response = await fetch(endpoint, {
      headers: buildDiscoveryHeaders(api, auth.apiKey, auth.headers),
      signal: AbortSignal.timeout(discoveryTimeoutMs),
    });
    if (!response.ok)
      return { ok: false, error: `Provider returned HTTP ${response.status}` };
    const metadata = metadataFromPayload(await response.json(), modelId);
    if (
      metadata.contextWindow === undefined &&
      metadata.maxTokens === undefined
    ) {
      return {
        ok: false,
        error: `No limits found for ${providerName}/${modelId}`,
      };
    }
    return { ok: true, ...metadata, source: "Provider /models catalog" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const modelsConfigTestHandler: Handler<"modelsConfigTest"> = async (
  params
) => {
  const parsedParams = parseRecord(params);
  if (!parsedParams)
    return { ok: false, error: "Invalid model test request" };
  const providerName =
    typeof parsedParams.providerName === "string"
      ? parsedParams.providerName.trim()
      : "";
  const provider = parseRecord(parsedParams.provider);
  const model = parseRecord(parsedParams.model);
  const modelId = typeof model?.id === "string" ? model.id.trim() : "";
  if (!providerName || !provider || !model || !modelId)
    return { ok: false, error: "Provider and model are required" };

  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "omp-vscode-model-test-")
  );
  try {
    const modelsPath = path.join(temporaryDirectory, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [providerName]: { ...provider, models: [{ ...model, id: modelId }] },
        },
      }),
      "utf-8"
    );
    const runtime = await ModelRuntime.create({
      authPath: path.join(getOmpAgentDir(), "auth.json"),
      modelsPath,
      allowModelNetwork: false,
    });
    const loadError = runtime.getError();
    if (loadError) return { ok: false, error: loadError };
    const configuredModel = runtime.getModel(providerName, modelId);
    if (!configuredModel)
      return {
        ok: false,
        error: `Model not found: ${providerName}/${modelId}`,
      };
    const auth = await runtime.getAuth(configuredModel);
    if (!auth?.auth.apiKey)
      return { ok: false, error: `No API key found for "${providerName}"` };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), modelTestTimeoutMs);
    const startedAt = Date.now();
    try {
      const message = await runtime.completeSimple(
        configuredModel,
        {
          messages: [
            {
              role: "user",
              content: "Reply with OK only.",
              timestamp: Date.now(),
            },
          ],
        },
        {
          maxTokens: 16,
          maxRetries: 0,
          timeoutMs: modelTestTimeoutMs,
          signal: controller.signal,
        }
      );
      const latencyMs = Date.now() - startedAt;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        return {
          ok: false,
          error: message.errorMessage ?? "Model returned an error",
          latencyMs,
        };
      }
      return { ok: true, latencyMs, responseText: assistantText(message) };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

export const modelsConfigCatalogHandler: Handler<
  "modelsConfigCatalog"
> = async ({ query, provider, baseUrl }) => {
  try {
    const response = await fetch(modelsDevelopmentUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(catalogTimeoutMs),
    });
    if (!response.ok)
      return { error: `models.dev returned HTTP ${response.status}` };
    const entries = flattenModelsDevCatalog(await response.json());
    if (entries.length === 0)
      return { error: "models.dev returned an empty catalog" };
    return {
      recommendation: recommendModelCatalogPreset(
        entries,
        query,
        provider,
        baseUrl ?? ""
      ),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};
