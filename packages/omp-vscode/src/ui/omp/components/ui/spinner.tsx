import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared loading spinner (lucide Loader2 + Tailwind spin animation).

export function Spinner({ className, size = 14 }: { className?: string; size?: number }) {
  return <Loader2 size={size} className={cn("animate-spin", className)} />;
}

// Full-area loading state: spinner inside a soft circular disc, centered.
export function LoadingState({
  label,
  className,
  spinnerSize = 14,
}: {
  label?: string;
  className?: string;
  spinnerSize?: number;
}) {
  return (
    <div className={cn("flex h-full items-center justify-center gap-2 text-[var(--text-muted)]", className)}>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-panel)] shadow-[0_1px_3px_var(--vscode-widget-shadow,rgba(0,0,0,0.1))]">
        <Spinner size={spinnerSize} className="text-[var(--accent)]" />
      </div>
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}
