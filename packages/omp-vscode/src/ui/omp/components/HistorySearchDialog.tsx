import { useEffect, useMemo, useRef, useState } from "react";

interface Props { items: string[]; onClose: () => void; onSelect: (prompt: string) => void; }

export function HistorySearchDialog({ items, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => items.filter((item) => item.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 100), [items, query]);
  useEffect(() => { inputRef.current?.focus(); setActiveIndex(0); }, []);
  return <div role="dialog" aria-modal="true" aria-label="Search input history" className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 p-8">
    <div className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border bg-[var(--bg)] p-4 shadow-xl">
      <input ref={inputRef} aria-label="Search input history" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(matches.length - 1, value + 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); } if (event.key === "Enter" && matches[activeIndex]) onSelect(matches[activeIndex]); }} placeholder="Search history" className="rounded border bg-transparent p-2" />
      <div className="mt-3 overflow-y-auto">{matches.map((item, index) => <button key={`${index}:${item}`} type="button" onClick={() => onSelect(item)} className={`block w-full rounded p-2 text-left ${index === activeIndex ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]"}`}>{item}</button>)}</div>
    </div>
  </div>;
}
