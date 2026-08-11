"use client";

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { ompUsage } from "../../lib/ext-methods";
import { useI18n } from "@/hooks/useI18n";

type UnknownRecord = Record<string, unknown>;
type UsageAmount = { used?: number; usedFraction?: number; remainingFraction?: number; unit?: string };
type UsageWindow = { label?: string; resetsAt?: number; resetLabel?: string };
type UsageLimit = { label: string; scope: { tier?: string; windowId?: string }; window?: UsageWindow; amount: UsageAmount; notes: string[] };
type ResetCredit = { expiresAt?: string };
type UsageReport = { provider: string; fetchedAt?: number; limits: UsageLimit[]; notes: string[]; metadata: { email?: string; accountId?: string }; resetCredits?: { availableCount: number; credits: ResetCredit[] } };

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null ? value as UnknownRecord : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseLimit(value: unknown): UsageLimit | undefined {
  const limit = asRecord(value);
  const label = limit && asString(limit.label);
  if (!limit || !label) return undefined;
  const rawScope = asRecord(limit.scope);
  const rawWindow = asRecord(limit.window);
  const rawAmount = asRecord(limit.amount);
  return {
    label,
    scope: { tier: rawScope && asString(rawScope.tier), windowId: rawScope && asString(rawScope.windowId) },
    window: rawWindow ? { label: asString(rawWindow.label), resetsAt: asFiniteNumber(rawWindow.resetsAt), resetLabel: asString(rawWindow.resetLabel) } : undefined,
    amount: { used: rawAmount && asFiniteNumber(rawAmount.used), usedFraction: rawAmount && asFiniteNumber(rawAmount.usedFraction), remainingFraction: rawAmount && asFiniteNumber(rawAmount.remainingFraction), unit: rawAmount && asString(rawAmount.unit) },
    notes: strings(limit.notes),
  };
}

function parseReport(value: unknown): UsageReport | undefined {
  const report = asRecord(value);
  const provider = report && asString(report.provider);
  if (!report || !provider) return undefined;
  const metadata = asRecord(report.metadata);
  const resetCredits = asRecord(report.resetCredits);
  const rawCredits = resetCredits && Array.isArray(resetCredits.credits) ? resetCredits.credits : [];
  const availableCount = resetCredits && asFiniteNumber(resetCredits.availableCount);
  return {
    provider,
    fetchedAt: asFiniteNumber(report.fetchedAt),
    limits: Array.isArray(report.limits) ? report.limits.flatMap((limit) => { const parsed = parseLimit(limit); return parsed ? [parsed] : []; }) : [],
    notes: strings(report.notes),
    metadata: { email: metadata && asString(metadata.email), accountId: metadata && asString(metadata.accountId) },
    resetCredits: availableCount === undefined ? undefined : { availableCount, credits: rawCredits.flatMap((credit) => { const record = asRecord(credit); return record ? [{ expiresAt: asString(record.expiresAt) }] : []; }) },
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatProviderName(id: string): string {
  return id.split(/[-_]/g).map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" ");
}

function formatUsageAmount(amount: UsageAmount, t: (key: string, params?: Record<string, string | number>) => string): string {
  const used = amount.used ?? (amount.usedFraction === undefined ? undefined : amount.usedFraction * 100);
  const remaining = amount.remainingFraction ?? (amount.usedFraction === undefined ? undefined : Math.max(0, 1 - amount.usedFraction));
  const unit = amount.unit === "percent" ? "%" : amount.unit ? ` ${amount.unit}` : "";
  const usedText = used === undefined ? t("usage.usedUnknown") : t("usage.usedText", { amount: `${used.toFixed(2)}${unit}` });
  return `${usedText}${remaining === undefined ? "" : t("usage.remainingText", { percent: (remaining * 100).toFixed(1) })}`;
}

function limitTitle(limit: UsageLimit): string {
  const tier = limit.scope.tier && !limit.label.toLowerCase().includes(limit.scope.tier.toLowerCase()) ? ` (${limit.scope.tier})` : "";
  const windowLabel = limit.window?.label ?? limit.scope.windowId;
  const suffix = windowLabel && windowLabel.toLowerCase() !== "quota window" && !limit.label.toLowerCase().includes(windowLabel.toLowerCase()) ? ` — ${windowLabel}` : "";
  return `${limit.label}${tier}${suffix}`;
}

const buttonStyle = { padding: "4px 10px", border: "1px solid var(--vscode-button-border, transparent)", borderRadius: 2, background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", fontFamily: "var(--vscode-font-family)", fontSize: 12, cursor: "pointer" } as const;

export function UsagePanel({ onOpenReset }: { onOpenReset: () => void }): JSX.Element {
  const { t } = useI18n();
  const [reports, setReports] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ompUsage();
      setReports(result.reports);
    } catch {
      setReports([]);
      setError("Unable to load usage data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const parsedReports = useMemo(() => reports.flatMap((report) => { const parsed = parseReport(report); return parsed ? [parsed] : []; }), [reports]);
  const groups = useMemo(() => {
    const grouped = new Map<string, UsageReport[]>();
    for (const report of parsedReports) grouped.set(report.provider, [...(grouped.get(report.provider) ?? []), report]);
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [parsedReports]);
  const latestFetchedAt = useMemo(() => Math.max(0, ...parsedReports.map((report) => report.fetchedAt ?? 0)), [parsedReports]);
  const now = Date.now();

  return <div style={{ width: "100%", height: "100%", overflow: "auto", color: "var(--vscode-foreground, var(--text))" }}>
    <div style={{ maxWidth: 920, padding: "20px 24px 32px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--vscode-settings-headerBorder, var(--border))" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("usage.title")}{latestFetchedAt ? <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{t("usage.fetchedAgo", { duration: formatDuration(now - latestFetchedAt) })}</span> : null}</h2>
        <div style={{ display: "flex", gap: 8 }}><button type="button" onClick={onOpenReset} style={buttonStyle}>{t("usage.action.reset")}</button><button type="button" onClick={() => void reload()} disabled={loading} style={buttonStyle}>{loading ? t("common.loading") : t("usage.action.reload")}</button></div>
      </header>
      {error ? <p role="status" style={{ margin: "14px 0 0", color: "var(--vscode-errorForeground, #f14c4c)", fontSize: 13 }}>{error}</p> : null}
      {!loading && reports.length === 0 ? <p style={{ margin: "20px 0 0", fontSize: 13, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{t("usage.empty")}</p> : null}
      {!loading && reports.length > 0 && groups.length === 0 ? <p style={{ margin: "20px 0 0", fontSize: 13, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{t("usage.empty")}</p> : null}
      {groups.map(([provider, providerReports]) => {
        const providerNotes = [...new Set(providerReports.flatMap((report) => report.notes))];
        return <section key={provider} style={{ marginTop: 24 }}>
          <h3 style={{ margin: 0, paddingBottom: 8, borderBottom: "1px solid var(--vscode-settings-headerBorder, var(--border))", fontSize: 14, fontWeight: 600 }}>{formatProviderName(provider)}</h3>
          {providerNotes.map((note, index) => <p key={`${note}-${index}`} style={{ margin: "7px 0 0", fontSize: 11, lineHeight: 1.45, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{note}</p>)}
          {providerReports.map((report, reportIndex) => {
            const account = report.metadata.email || report.metadata.accountId || "account";
            const savedResets = report.resetCredits?.availableCount ?? 0;
            return <div key={`${account}-${reportIndex}`} style={{ marginTop: 12, padding: 12, border: "1px solid var(--vscode-settings-headerBorder, var(--border))", borderRadius: 2 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: savedResets > 0 || report.limits.length > 0 ? 10 : 0 }}>{account}</div>
              {savedResets > 0 ? <div style={{ marginBottom: 10 }}><span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 2, background: "var(--vscode-badge-background, var(--accent))", color: "var(--vscode-badge-foreground, var(--text))", fontSize: 11 }}>{t(savedResets === 1 ? "usage.savedResets" : "usage.savedResets.plural", { count: savedResets })}</span>{report.resetCredits?.credits.map((credit, index) => {
                const expiresAt = credit.expiresAt ? Date.parse(credit.expiresAt) : Number.NaN;
                if (Number.isNaN(expiresAt)) return null;
                const date = credit.expiresAt?.slice(0, 10) ?? "";
                return <div key={index} style={{ marginTop: 4, fontSize: 11, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{expiresAt > now ? t("usage.expiresIn", { duration: formatDuration(expiresAt - now), date }) : t("usage.expired", { date })}</div>;
              })}</div> : null}
              {report.limits.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{t("usage.noLimits")}</p> : report.limits.map((limit, index) => {
                const fraction = limit.amount.usedFraction === undefined ? undefined : Math.min(1, Math.max(0, limit.amount.usedFraction));
                const color = fraction === undefined || fraction < 0.7 ? "var(--vscode-testing-iconPassed, #73c991)" : fraction < 0.9 ? "var(--vscode-editorWarning-foreground, #cca700)" : "var(--vscode-testing-iconFailed, #f14c4c)";
                const resetsAt = limit.window?.resetsAt;
                return <div key={`${limit.label}-${index}`} style={{ paddingTop: index ? 12 : 0, marginTop: index ? 12 : 0, borderTop: index ? "1px solid var(--vscode-settings-headerBorder, var(--border))" : undefined }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{limitTitle(limit)}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{formatUsageAmount(limit.amount, t)}</div>
                  <div aria-label={fraction === undefined ? "Usage unavailable" : `${Math.round(fraction * 100)}% used`} style={{ height: 6, marginTop: 8, borderRadius: 2, background: fraction === undefined ? "var(--vscode-progressBar-background, var(--border))" : `linear-gradient(to right, ${color} 0%, ${color} ${fraction * 100}%, var(--vscode-progressBar-background, var(--border)) ${fraction * 100}%, var(--vscode-progressBar-background, var(--border)) 100%)` }} />
                  {resetsAt && resetsAt > now ? <div style={{ marginTop: 5, fontSize: 11, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{t("usage.resetsIn", { duration: formatDuration(resetsAt - now) })}</div> : null}
                  {limit.notes.length > 0 ? <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, color: "var(--vscode-descriptionForeground, var(--text-dim))" }}>{limit.notes.join(" • ")}</div> : null}
                </div>;
              })}
            </div>;
          })}
        </section>;
      })}
    </div>
  </div>;
}
