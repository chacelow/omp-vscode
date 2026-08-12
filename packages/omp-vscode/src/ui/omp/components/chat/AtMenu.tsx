import { memo } from "react";
import { FolderIcon, getFileIcon } from "../FileIcons";
import type { FileIndexEntry } from "@/lib/file-fuzzy";

// "@" file-autocomplete menu — opens above the textarea when the user types
// "@" in the input. Local index first; debounced server search replaces it.

interface AtMenuProps {
  loading: boolean;
  matches: FileIndexEntry[];
  activeIndex: number;
  serverResultInUse: boolean;
  needsServerSearch: boolean;
  indexTruncated: boolean;
  query: string;
  onApply: (entry: FileIndexEntry) => void;
  onHover: (index: number) => void;
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const AtMenu = memo(function AtMenu({
  loading,
  matches,
  activeIndex,
  serverResultInUse,
  needsServerSearch,
  indexTruncated,
  query,
  onApply,
  onHover,
  itemRefs,
  t,
}: AtMenuProps) {
  const matchCountLabel =
    matches.length === 1
      ? t("chat.match")
      : t("chat.matches", { count: matches.length });
  // With a truncated index, local results are provisional — the debounced
  // server search over the full listing replaces them.
  const truncatedHint =
    indexTruncated && !serverResultInUse
      ? query
        ? t("chat.searchingAll")
        : t("chat.indexTruncated")
      : "";

  return (
    <div className="shadow-[0_-6px_20px_var(--vscode-widget-shadow, rgba(0,0,0,0.12))] absolute inset-x-0 bottom-[calc(100%+8px)] z-[120] max-h-[min(48vh,400px)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--text-dim)]">
        <span>
          {loading
            ? t("chat.loadingFiles")
            : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
        </span>
        <span className="font-mono">{t("chat.tabEnter")}</span>
      </div>
      <div
        className="overflow-y-auto p-1"
        style={{ maxHeight: "calc(min(48vh, 400px) - 34px)" }}
      >
        {!loading && matches.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-[var(--text-dim)]">
            {needsServerSearch && !serverResultInUse
              ? t("chat.searching")
              : t("chat.noMatchingFiles")}
          </div>
        ) : (
          matches.map((entry, index) => {
            const active = index === activeIndex;
            const name = entry.path.split("/").pop() ?? entry.path;
            const dirPrefix = entry.path.slice(
              0,
              entry.path.length - name.length
            );
            return (
              <button
                key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onApply(entry);
                }}
                onMouseEnter={() => onHover(index)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[12.5px] text-[var(--text)] ${active ? "bg-[var(--bg-selected)]" : ""}`}
              >
                <span className="flex shrink-0 items-center">
                  {entry.isDir ? (
                    <FolderIcon size={14} />
                  ) : (
                    getFileIcon(name, 14)
                  )}
                </span>
                <span className="min-w-0 truncate">
                  {dirPrefix && (
                    <span className="text-[var(--text-dim)]">{dirPrefix}</span>
                  )}
                  {name}
                  {entry.isDir && (
                    <span className="text-[var(--text-dim)]">/</span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});
