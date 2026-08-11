import { useEffect, useState } from "react";
import { ompUsage } from "@/lib/ext-methods";
import { hostCall } from "../../../bridge";

export interface UsageAccount { id: string; label?: string; resetAvailable?: boolean; resetAt?: string; }
interface ResetUsageSelectorProps { loadUsage?: () => Promise<unknown>; onClose: () => void; }

function accountsFromUsage(value: unknown): UsageAccount[] {
  if (!value || typeof value !== "object") return [];
  const raw = "accounts" in value ? value.accounts : "usage" in value ? value.usage : [];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): UsageAccount[] => {
    if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") return [];
    return [{ id: item.id, label: "label" in item && typeof item.label === "string" ? item.label : undefined, resetAvailable: "resetAvailable" in item && item.resetAvailable === true, resetAt: "resetAt" in item && typeof item.resetAt === "string" ? item.resetAt : undefined }];
  });
}

export function ResetUsageSelector({ loadUsage = ompUsage, onClose }: ResetUsageSelectorProps) {
  const [accounts, setAccounts] = useState<UsageAccount[]>([]);
  const [selected, setSelected] = useState<UsageAccount | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("Loading usage accounts…");
  useEffect(() => { void loadUsage().then((value) => { const next = accountsFromUsage(value); setAccounts(next); setStatus(next.length ? "Select an account to reset." : "No resettable usage accounts found."); }).catch(() => setStatus("Usage is unavailable.")); }, [loadUsage]);
  const redeem = async () => { if (!selected) return; const result = await hostCall("authResetCredit", { account: selected.id }); setStatus(result.ok ? "Usage credit reset." : result.reason ?? "Reset is not supported for this account."); setConfirming(false); };
  return <div className="absolute inset-0 z-[95] flex items-center justify-center bg-black/30 p-5"><section role="dialog" aria-modal="true" aria-label="Reset usage credit" className="w-full max-w-md rounded-lg border border-border bg-background shadow-xl"><header className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Reset usage credit</h2></header><main className="grid gap-2 p-4">{accounts.map((account) => <button type="button" key={account.id} disabled={!account.resetAvailable} onClick={() => { setSelected(account); setConfirming(true); }} className="rounded border border-border p-3 text-left text-sm hover:bg-muted disabled:opacity-50"><strong>{account.label ?? account.id}</strong><span className="block text-xs text-muted-foreground">{account.resetAvailable ? account.resetAt ? `Available ${account.resetAt}` : "Available now" : "Not currently available"}</span></button>)}<p role="status" className="text-xs text-muted-foreground">{status}</p>{confirming && selected && <div role="alertdialog" aria-modal="true" aria-label="Confirm usage reset" className="rounded border border-warning bg-muted p-3 text-sm"><p>Redeem the reset credit for {selected.label ?? selected.id}? This cannot be undone.</p><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setConfirming(false)} className="rounded border border-border px-3 py-2">Cancel</button><button type="button" onClick={() => void redeem()} className="rounded bg-primary px-3 py-2 text-primary-foreground">Redeem reset</button></div></div>}</main><footer className="flex justify-end border-t border-border p-3"><button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-sm">Close</button></footer></section></div>;
}
