/**
 * `AssistantMessage` → `<MessageTiming>` prop shape.
 *
 * Pure function: no React, no bridge, no I/O. Unit-tested in
 * `adapters.test.ts`.
 *
 * `<MessageTiming>` does no formatting; every stat we emit is a
 * pre-formatted `{ label, value }` pair. Stat ordering is stable:
 *
 *   model → duration → tokens → cache → cost
 *
 * Stats that would render as an empty or meaningless value are omitted
 * (rather than rendered as `—` or `0`), so short turns collapse cleanly.
 */

import type { AssistantMessage } from "@/lib/types";

export interface TimingStat {
  label: string;
  value: string;
}

export interface TimingFooterStats {
  stats: readonly TimingStat[];
  streaming?: boolean;
}

export interface TimingOptions {
  streaming?: boolean;
  /** Preferred human display name for a model, e.g. `{ "claude-opus": "Opus" }`.
   *  Keys tried: `provider:model`, then `model`. */
  modelNames?: Record<string, string>;
  /** Locale hint for `Intl.NumberFormat`; defaults to `"en-US"`. */
  locale?: string;
}

function formatDurationMs(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0)
    return undefined;
  const s = durationMs / 1000;
  if (s < 1) return `${Math.round(durationMs)}ms`;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`;
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(2) : m.toFixed(1)}M`;
}

function formatCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function resolveModelName(
  message: AssistantMessage,
  names: Record<string, string> | undefined
): string | undefined {
  const raw = message.model || "";
  if (!raw) return undefined;
  if (!names) return raw;
  const key = message.provider ? `${message.provider}:${raw}` : raw;
  return names[key] ?? names[raw] ?? raw;
}

export function toTimingStats(
  message: AssistantMessage,
  options: TimingOptions = {}
): TimingFooterStats {
  const stats: TimingStat[] = [];

  // 1) Model — usually the row's identity.
  const model = resolveModelName(message, options.modelNames);
  if (model) stats.push({ label: "model", value: model });

  // 2) Duration — engine-computed generation time, formatted.
  const duration = formatDurationMs(message.duration);
  if (duration !== undefined) stats.push({ label: "took", value: duration });

  // 3) Tokens — input / output as a single "N in / N out" stat if both known,
  //    else whichever is present. Cache is a separate stat below.
  const usage = message.usage;
  if (usage) {
    const inTok = usage.input ?? 0;
    const outTok = usage.output ?? 0;
    if (inTok > 0 || outTok > 0) {
      stats.push({
        label: "tokens",
        value: `${formatTokens(inTok)} in / ${formatTokens(outTok)} out`,
      });
    }

    // 4) Cache — read/write pair, plus hit ratio when there is a read.
    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite = usage.cacheWrite ?? 0;
    if (cacheRead > 0 || cacheWrite > 0) {
      const totalIn = inTok + cacheRead;
      const ratio = totalIn > 0 ? Math.round((cacheRead / totalIn) * 100) : 0;
      const parts: string[] = [];
      parts.push(`${formatTokens(cacheRead)} read`);
      if (cacheWrite > 0) parts.push(`${formatTokens(cacheWrite)} write`);
      if (cacheRead > 0) parts.push(`${ratio}% hit`);
      stats.push({ label: "cache", value: parts.join(" · ") });
    }

    // 5) Cost — total plus per-Mtok rate on output when both known.
    const cost = usage.cost;
    if (cost && Number.isFinite(cost.total) && cost.total > 0) {
      const perMtok = outTok > 0 ? (cost.total * 1_000_000) / outTok : 0;
      const value =
        perMtok > 0
          ? `${formatCostUsd(cost.total)} · ${formatCostUsd(perMtok)}/Mtok`
          : formatCostUsd(cost.total);
      stats.push({ label: "cost", value });
    }
  }

  const out: TimingFooterStats = { stats };
  if (options.streaming) out.streaming = true;
  return out;
}
