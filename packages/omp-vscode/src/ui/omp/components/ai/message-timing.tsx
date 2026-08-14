"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { mono } from "./surfaces";

export interface TimingStat {
  label: string;
  value: string;
  /** Lower values remain visible longer in the compact timing row. */
  priority?: number;
}

export function MessageTiming({
  stats,
  streaming,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "stats" | "streaming"> & {
  stats: readonly TimingStat[];
  streaming?: boolean;
}) {
  return (
    <div
      data-slot="message-timing"
      className={cn(
        "assistant-meta-timing fade-in animate-in relative w-full max-w-sm min-w-0 duration-500",
        className,
      )}
      {...props}
    >
      <div className="assistant-meta-timing__compact flex min-w-0 items-center justify-start gap-x-3 whitespace-nowrap">
        {stats.map((stat) => (
          <span
            key={stat.label}
            className={cn(
              "assistant-meta-timing__stat flex shrink-0 items-baseline gap-1",
              `assistant-meta-timing__stat--priority-${stat.priority ?? 99}`,
            )}
          >
            <span className={cn(mono, "text-foreground/25")}>{stat.label}</span>
            <span
              className={cn(
                mono,
                "tabular-nums",
                streaming
                  ? "text-blue-500 dark:text-blue-400"
                  : "text-foreground/50",
              )}
            >
              {stat.value}
            </span>
          </span>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="assistant-meta-timing__overlay absolute right-0 top-0 z-20 flex max-w-none items-center justify-start gap-x-3 whitespace-nowrap border border-[var(--border)] bg-[var(--bg-secondary)] px-1"
      >
        {stats.map((stat) => (
          <span key={stat.label} className="flex items-baseline gap-1">
            <span className={cn(mono, "text-foreground/25")}>{stat.label}</span>
            <span
              className={cn(
                mono,
                "tabular-nums",
                streaming
                  ? "text-blue-500 dark:text-blue-400"
                  : "text-foreground/50",
              )}
            >
              {stat.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
