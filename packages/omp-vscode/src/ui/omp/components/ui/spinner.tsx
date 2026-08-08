import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared loading spinner (lucide Loader2 + Tailwind spin animation).

export function Spinner({ className, size = 14 }: { className?: string; size?: number }) {
  return <Loader2 size={size} className={cn("animate-spin", className)} />;
}

// Centered loading state: spinner inside a soft circular disc, with an
// optional label and extra content below.
export function LoadingState({
  label,
  children,
  className,
  spinnerSize = 14,
}: {
  label?: string;
  children?: ReactNode;
  className?: string;
  spinnerSize?: number;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[var(--text-muted)]",
        className,
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-panel)] shadow-[0_1px_3px_var(--vscode-widget-shadow,rgba(0,0,0,0.1))]">
        <Spinner size={spinnerSize} className="text-[var(--accent)]" />
      </div>
      {label && <div className="text-sm text-[var(--text)]">{label}</div>}
      {children}
    </div>
  );
}
