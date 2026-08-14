import type { ElicitationContentValue } from "@agentclientprotocol/sdk";
import type {
  AcpElicitationRequest,
  AcpPermissionRequest,
} from "../../../../core/acp/protocol";
import { ShieldAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useI18n } from "@/hooks/useI18n";

type InteractionRequest = AcpPermissionRequest | AcpElicitationRequest;
type InteractionResponse = {
  optionId?: string;
  action?: "accept" | "decline" | "cancel";
  content?: Record<string, ElicitationContentValue>;
};

type ElicitationOption = {
  label: string;
  response: InteractionResponse;
};

function elicitationOptions(
  request: AcpElicitationRequest
): ElicitationOption[] | null {
  if (request.request.mode === "confirm") {
    return [
      {
        label: "Yes",
        response: { action: "accept", content: { confirmed: true } },
      },
      {
        label: "No",
        response: { action: "accept", content: { confirmed: false } },
      },
    ];
  }
  if (
    request.request.mode !== "select" ||
    !("requestedSchema" in request.request) ||
    !request.request.requestedSchema ||
    typeof request.request.requestedSchema !== "object"
  )
    return null;

  const schema = request.request.requestedSchema;
  const choices =
    "enum" in schema && Array.isArray(schema.enum)
      ? schema.enum.filter(
          (choice): choice is string => typeof choice === "string"
        )
      : [];
  return choices.length > 0
    ? choices.map((choice) => ({
        label: choice,
        response: { action: "accept", content: { value: choice } },
      }))
    : null;
}

export function supportsInlineApproval(request: InteractionRequest): boolean {
  return "toolCall" in request || elicitationOptions(request) !== null;
}

function requestSummary(request: InteractionRequest): string {
  if ("toolCall" in request)
    return request.toolCall.title ?? request.toolCall.kind ?? "Permission required";
  return "title" in request.request && typeof request.request.title === "string"
    ? request.request.title
    : request.request.message ?? "Response required";
}

export function ApprovalBar({
  request,
  onRespond,
}: {
  request: InteractionRequest;
  onRespond: (request: InteractionRequest, response: InteractionResponse) => void;
}) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const isPermission = "toolCall" in request;
  const options: ElicitationOption[] = isPermission
    ? request.options.map((option) => ({
        label: option.name,
        response: { optionId: option.optionId },
      }))
    : (elicitationOptions(request) ?? []);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.16,
        ease: [0.2, 0, 0, 1],
      }}
      className="overflow-hidden"
    >
      <div className="mx-3 mb-2 flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-sm">
        <ShieldAlert
          size={16}
          aria-hidden="true"
          className="shrink-0 text-[var(--accent)]"
        />
        <span
          className="min-w-0 flex-1 truncate text-[var(--text)]"
          title={requestSummary(request)}
        >
          {requestSummary(request)}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {options.map((option, index) => (
            <button
              key={isPermission ? option.response.optionId : option.label}
              type="button"
              className={
                index === 0
                  ? "rounded border border-[var(--accent)] bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white transition-colors hover:brightness-110"
                  : "rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text)]"
              }
              onClick={() => onRespond(request, option.response)}
            >
              {isPermission && index === 0 ? t("approval.allow") : option.label}
            </button>
          ))}
          {isPermission && (
            <button
              type="button"
              className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text)]"
              onClick={() => onRespond(request, {})}
            >
              {t("approval.deny")}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
