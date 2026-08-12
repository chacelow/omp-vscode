"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import { Globe } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

const LANG_OPTIONS: {
  id: "en" | "zh-CN";
  label: string;
  sub: string;
  flag: string;
}[] = [
  { id: "en", label: "English", sub: "English", flag: "🇺🇸" },
  { id: "zh-CN", label: "中文", sub: "Chinese (Simplified)", flag: "🇨🇳" },
];

export function LanguagePicker(): JSX.Element {
  const { locale, setLocale } = useI18n();
  const { isStarfield } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const activeLabel = locale === "zh-CN" ? "中文" : "English";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        variant="ghost"
        size="toolbar"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={`Language: ${activeLabel}`}
        aria-label="Switch language"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "text-[var(--text-muted)]",
          isStarfield && "text-[#d99b26]",
          open && "bg-[var(--bg-selected)] text-[var(--text)]"
        )}
      >
        <Globe />
      </Button>

      {/* Dropdown Menu */}
      {open && (
        <div
          role="listbox"
          aria-label="Select language"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 9000,
            minWidth: 170,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            boxShadow:
              "0 8px 32px var(--vscode-widget-shadow, rgba(0,0,0,0.28))",
            borderRadius: isStarfield ? 0 : 8,
            overflow: "hidden",
            borderTop: isStarfield
              ? "2px solid #d99b26"
              : "1px solid var(--border)",
          }}
        >
          {isStarfield && (
            <div
              style={{
                padding: "6px 12px 4px",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 9,
                letterSpacing: "0.14em",
                color: "#d99b26",
                opacity: 0.7,
                textTransform: "uppercase",
                borderBottom: "1px solid #1e2d45",
              }}
            >
              ◈ Language / 语言
            </div>
          )}

          {LANG_OPTIONS.map((opt) => {
            const isActive = locale === opt.id;
            return (
              <button
                key={opt.id}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setLocale(opt.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "8px 12px",
                  background: isActive ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderLeft: isActive
                    ? isStarfield
                      ? "3px solid #d99b26"
                      : "3px solid var(--accent)"
                    : "3px solid transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "none";
                }}
              >
                <span style={{ fontSize: 14 }}>{opt.flag}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color:
                        isStarfield && isActive ? "#d99b26" : "var(--text)",
                      fontFamily: isStarfield
                        ? "var(--font-mono, monospace)"
                        : "inherit",
                    }}
                  >
                    {opt.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-dim)",
                      fontFamily: isStarfield
                        ? "var(--font-mono, monospace)"
                        : "inherit",
                    }}
                  >
                    {opt.sub}
                  </div>
                </div>

                {isActive && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={isStarfield ? "#d99b26" : "var(--accent)"}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
