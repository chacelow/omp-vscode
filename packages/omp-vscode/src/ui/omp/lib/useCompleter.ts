import { useCallback, useEffect, useState } from "react";

export type CompleterRange = { start: number; end: number };

export interface UseCompleterOptions<T> {
  trigger?: string;
  fetch?: (query: string) => Promise<readonly T[]> | readonly T[];
  accept?: (item: T, range: CompleterRange) => void;
}

export interface CompleterState<T> {
  open: boolean;
  query: string;
  items: readonly T[];
  activeIndex: number;
  insertRange: CompleterRange | null;
  openAt: (range: CompleterRange, query: string) => void;
  close: () => void;
  setItems: (items: readonly T[]) => void;
  moveActive: (delta: number) => void;
  accept: () => T | undefined;
}

/** Shared state machine for token completers in the composer. */
export function useCompleter<T>(
  options: UseCompleterOptions<T> = {}
): CompleterState<T> {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItemsState] = useState<readonly T[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [insertRange, setInsertRange] = useState<CompleterRange | null>(null);

  useEffect(() => {
    if (activeIndex >= items.length)
      setActiveIndex(Math.max(0, items.length - 1));
  }, [activeIndex, items.length]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setItemsState([]);
    setActiveIndex(0);
    setInsertRange(null);
  }, []);

  const setItems = useCallback((nextItems: readonly T[]) => {
    setItemsState(nextItems);
    setActiveIndex(0);
  }, []);

  const openAt = useCallback(
    (range: CompleterRange, nextQuery: string) => {
      setOpen(true);
      setQuery(nextQuery);
      setInsertRange(range);
      setActiveIndex(0);
      const fetched = options.fetch?.(nextQuery);
      if (fetched) {
        void Promise.resolve(fetched).then(setItemsState);
      }
    },
    [options.fetch]
  );

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((index) =>
        Math.max(0, Math.min(items.length - 1, index + delta))
      );
    },
    [items.length]
  );

  const accept = useCallback((): T | undefined => {
    if (!insertRange) return undefined;
    const item = items[activeIndex];
    if (item !== undefined) options.accept?.(item, insertRange);
    return item;
  }, [activeIndex, insertRange, items, options.accept]);

  return {
    open,
    query,
    items,
    activeIndex,
    insertRange,
    openAt,
    close,
    setItems,
    moveActive,
    accept,
  };
}
