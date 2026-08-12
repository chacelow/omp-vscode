import * as React from "react";

import { cn } from "@/lib/utils";

interface SwitchProps
  extends Omit<React.ComponentProps<"button">, "onChange" | "role"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function Switch({
  checked,
  className,
  disabled,
  onCheckedChange,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-state={checked ? "checked" : "unchecked"}
      data-slot="switch"
      className={cn(
        "relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border p-px transition-[background-color,border-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vscode-focusBorder,var(--accent))] disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-[var(--vscode-inputOption-activeBorder,var(--vscode-focusBorder,var(--accent)))] bg-[var(--vscode-inputOption-activeBackground,var(--accent))]"
          : "border-[var(--vscode-checkbox-border,var(--border))] bg-[var(--vscode-checkbox-background,var(--bg-panel))]",
        className
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "block size-3.5 rounded-full shadow-sm transition-transform duration-150 ease-out",
          checked
            ? "translate-x-3.5 bg-[var(--vscode-inputOption-activeForeground,var(--vscode-button-foreground,#fff))]"
            : "translate-x-0 bg-[var(--vscode-checkbox-foreground,var(--text-muted))]"
        )}
      />
    </button>
  );
}

export { Switch, type SwitchProps };
