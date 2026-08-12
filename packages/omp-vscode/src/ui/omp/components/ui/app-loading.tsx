"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Shimmer } from "../ai-elements/shimmer";
// The real brand mark. esbuild's `text` loader inlines the file contents
// (see esbuild.js) so we can render it via dangerouslySetInnerHTML and
// keep `fill="currentColor"` themable.
import ompLogoSvg from "../../../../../media/omp.svg";

/** Unified full-panel loading state — the OMP logo pulses while a
 *  Shimmer-animated label announces what's being loaded. Used for the
 *  initial workspace-opening state, the session-detail load, and the
 *  session-list boot page. */
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
  /** Logo pixel size. */
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
      <div
        className="omp-app-loading-logo text-[var(--text-muted)]"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: ompLogoSvg }}
      />
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
