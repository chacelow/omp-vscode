import { useState } from "react";
import { hostCall } from "../../../bridge";

interface OAuthLoginDialogProps { provider: string; authorizationUrl: string; onClose: () => void; onSuccess?: () => void; }

export function OAuthLoginDialog({ provider, authorizationUrl, onClose, onSuccess }: OAuthLoginDialogProps) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const copyUrl = async () => { await navigator.clipboard.writeText(authorizationUrl); setStatus("Authorization URL copied."); };
  const submit = async () => {
    if (!code.trim()) { setStatus("Paste the authorization code first."); return; }
    setSubmitting(true); setStatus(null);
    try {
      const result = await hostCall("authLogin", { provider, code: code.trim() });
      if (!result.success) { setStatus(result.error ?? "Login failed."); return; }
      onSuccess?.(); onClose();
    } catch (error: unknown) { setStatus(error instanceof Error ? error.message : "Login failed."); }
    finally { setSubmitting(false); }
  };
  return <div className="absolute inset-0 z-[95] flex items-center justify-center bg-black/30 p-5"><section role="dialog" aria-modal="true" aria-label={`Log in to ${provider}`} className="w-full max-w-lg rounded-lg border border-border bg-background shadow-xl"><header className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Log in to {provider}</h2><p className="mt-1 text-xs text-muted-foreground">Open the authorization URL in a browser, then paste the resulting code.</p></header><main className="grid gap-3 p-4"><label className="grid gap-1 text-sm">Authorization URL<textarea readOnly aria-label="Authorization URL" value={authorizationUrl} className="min-h-20 resize-y rounded border border-border bg-muted p-2 font-mono text-xs" /></label><button type="button" onClick={() => void copyUrl()} className="justify-self-start rounded border border-border px-3 py-2 text-sm hover:bg-muted">Copy authorization URL</button><label className="grid gap-1 text-sm">Authorization code<textarea autoFocus value={code} onChange={(event) => setCode(event.target.value)} className="min-h-24 resize-y rounded border border-border bg-muted p-2 font-mono text-sm" /></label>{status && <p role="status" className="rounded border border-border bg-muted p-2 text-xs">{status}</p>}</main><footer className="flex justify-end gap-2 border-t border-border p-3"><button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-sm">Cancel</button><button type="button" disabled={submitting} onClick={() => void submit()} className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{submitting ? "Submitting…" : "Submit"}</button></footer></section></div>;
}
