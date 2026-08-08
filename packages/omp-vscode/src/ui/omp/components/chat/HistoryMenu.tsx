import { memo } from "react";
import { History } from "lucide-react";

// Input history picker — opens above the textarea (arrow-up / Ctrl-P).

interface HistoryMenuProps {
  items: string[];
  activeIndex: number;
  onSelect: (item: string) => void;
  onHover: (index: number) => void;
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
}

export const HistoryMenu = memo(function HistoryMenu({
  items, activeIndex, onSelect, onHover, itemRefs,
}: HistoryMenuProps) {
  return (
    <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-[120] max-h-[min(44vh,360px)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-[0_-6px_20px_rgba(0,0,0,0.12)]">
      <div className="flex h-[30px] items-center border-b border-[var(--border)] px-2.5 text-[var(--text-dim)]">
        <History size={14} strokeWidth={1.8} aria-hidden />
      </div>
      <div className="overflow-y-auto p-1" style={{ maxHeight: "calc(min(44vh, 360px) - 31px)" }}>
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`${index}:${item}`}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
              onMouseEnter={() => onHover(index)}
              className={`flex w-full items-start gap-2 rounded-md px-2 py-[7px] text-left text-[12.5px] leading-[1.45] text-[var(--text)] ${active ? "bg-[var(--bg-selected)]" : ""}`}
            >
              <span className="shrink-0 pt-px font-mono text-[11px] text-[var(--text-dim)]">{index + 1}</span>
              <span className="min-w-0 break-anywhere" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>
                {item}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
