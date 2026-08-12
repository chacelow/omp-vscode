"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StarfieldEmblem } from "../StarfieldEmblem";
import { Shimmer } from "../ai-elements/shimmer";

/** Unified full-panel loading state — the emblem breathes and a Shimmer
 *  label announces what's being loaded. Used for both the initial
 *  workspace-opening state and the session-detail load. Replaces the old
 *  Loader2 spinner in `LoadingState` for these two top-level cases so the
 *  brand shows through instead of a generic ring. */
export function AppLoading({
  label,
  subtitle,
  className,
  size = 56,
}: {
  /** Primary line — what's happening ("Loading session…"). Shimmer-animated. */
  label: string;
  /** Optional secondary line — WHAT is loading (session title / id / path). Mono, dim. */
  subtitle?: ReactNode;
  className?: string;
  /** Emblem pixel size. */
  size?: number;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center",
        className
      )}
    >
      <div className="omp-app-loading-emblem" style={{ width: size, height: size }}>
        <StarfieldEmblem size={size} />
      </div>
      <Shimmer className="text-sm text-[var(--text)]" duration={2} spread={1}>
        {label}
      </Shimmer>
      {subtitle && (
        <div
          className="max-w-[min(720px,100%)] font-mono text-[11px] break-all text-[var(--text-dim)]"
          style={{ overflowWrap: "anywhere" }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}
