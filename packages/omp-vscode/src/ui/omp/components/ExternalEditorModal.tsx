"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";

interface ExternalEditorModalProps {
  open: boolean;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => void;
}

/** Webview-native substitute for the TUI's external $EDITOR workflow. */
export default function ExternalEditorModal({ open, initialValue, onClose, onSave }: ExternalEditorModalProps) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [initialValue, open]);

  if (!open) return null;

  return (
    <div
      aria-label="External draft editor"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(78vh,720px)] w-full max-w-4xl flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-[var(--text)]">Edit draft</h2>
          <span className="text-xs text-[var(--text-muted)]">Ctrl+Enter to save</span>
        </div>
        <textarea
          ref={textareaRef}
          aria-label="Draft text"
          className="min-h-0 flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-sm leading-6 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
            if (event.ctrlKey && event.key === "Enter") {
              event.preventDefault();
              onSave(value);
            }
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => onSave(value)}>Save draft</Button>
        </div>
      </div>
    </div>
  );
}
