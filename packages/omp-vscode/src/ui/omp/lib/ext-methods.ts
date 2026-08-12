import { z } from "zod";
import { acpRequest } from "../../bridge";

/** Runtime shapes returned by the `_omp/*` ACP extension methods. */
const OmpSessionSummarySchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  title: z.string().optional(),
  updatedAt: z.string().optional(),
  _meta: z
    .object({
      messageCount: z.number().optional(),
      size: z.number().optional(),
    })
    .optional(),
});
export type OmpSessionSummary = z.infer<typeof OmpSessionSummarySchema>;

const OmpSessionsListAllSchema = z.object({
  sessions: z.array(OmpSessionSummarySchema),
  total: z.number(),
});
export type OmpSessionsListAllResult = z.infer<typeof OmpSessionsListAllSchema>;

const OmpProjectsListSchema = z.object({
  projects: z.array(
    z.object({
      cwd: z.string(),
      sessionCount: z.number(),
      lastActivityAt: z.number(),
      lastTitle: z.string(),
    })
  ),
  totalSessions: z.number(),
});
export type OmpProjectsListResult = z.infer<typeof OmpProjectsListSchema>;

const OmpChatsByCwdSchema = z.object({
  sessions: z.array(OmpSessionSummarySchema),
});
export type OmpChatsByCwdResult = z.infer<typeof OmpChatsByCwdSchema>;

const OmpUsageSchema = z.object({ reports: z.array(z.unknown()) });
export type OmpUsageResult = z.infer<typeof OmpUsageSchema>;

const OmpExtensionsSchema = z.object({ extensions: z.array(z.unknown()) });
export type OmpExtensionsResult = z.infer<typeof OmpExtensionsSchema>;

const OmpExtensionsToggleSchema = z.object({ enabled: z.boolean() });
export type OmpExtensionsToggleResult = z.infer<
  typeof OmpExtensionsToggleSchema
>;

const SpeechModelsListSchema = z.object({
  settings: z.record(z.string(), z.string()),
  defaults: z.record(z.string(), z.string()),
  speechToText: z.record(z.string(), z.unknown()),
  textToSpeech: z.record(z.string(), z.unknown()),
});
export type SpeechModelsListResult = z.infer<typeof SpeechModelsListSchema>;

function parseWithSchema<T>(schema: z.ZodType<T>, result: unknown): T {
  return schema.parse(result);
}

export function acpExt<T>(
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  return acpRequest({
    type: "acp/extMethod",
    method,
    params,
  }) as unknown as Promise<T>;
}

export async function ompSessionsListAll(
  limit?: number
): Promise<OmpSessionsListAllResult> {
  return parseWithSchema(
    OmpSessionsListAllSchema,
    await acpExt<unknown>("_omp/sessions/listAll", { limit })
  );
}

export async function ompProjectsList(): Promise<OmpProjectsListResult> {
  return parseWithSchema(
    OmpProjectsListSchema,
    await acpExt<unknown>("_omp/projects/list", {})
  );
}

export async function ompChatsByCwd(
  cwd: string,
  limit?: number
): Promise<OmpChatsByCwdResult> {
  return parseWithSchema(
    OmpChatsByCwdSchema,
    await acpExt<unknown>("_omp/chats/byCwd", { cwd, limit })
  );
}

export async function ompUsage(): Promise<OmpUsageResult> {
  return parseWithSchema(
    OmpUsageSchema,
    await acpExt<unknown>("_omp/usage", {})
  );
}

export async function ompExtensions(
  cwd?: string
): Promise<OmpExtensionsResult> {
  return parseWithSchema(
    OmpExtensionsSchema,
    await acpExt<unknown>("_omp/extensions", { cwd })
  );
}

export async function ompExtensionsToggle(
  providerId: string,
  enabled?: boolean
): Promise<OmpExtensionsToggleResult> {
  return parseWithSchema(
    OmpExtensionsToggleSchema,
    await acpExt<unknown>("_omp/extensions/toggle", { providerId, enabled })
  );
}

export async function speechModelsList(): Promise<SpeechModelsListResult> {
  return parseWithSchema(
    SpeechModelsListSchema,
    await acpExt<unknown>("speech.models.list", {})
  );
}
