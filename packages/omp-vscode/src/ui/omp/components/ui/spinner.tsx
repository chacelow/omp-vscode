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
  spinnerSize = 16,
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
        "flex h-full flex-col items-center justify-center gap-2.5 p-6 text-center text-[var(--text-muted)]",
        className,
      )}
    >
      <Spinner size={spinnerSize} className="text-[var(--text-muted)]" />
      {label && <div className="text-sm text-[var(--text)]">{label}</div>}
      {children}
    </div>
  );
}
