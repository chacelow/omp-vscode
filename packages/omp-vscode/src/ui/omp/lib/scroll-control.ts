/**
 * Module-level bridge between the chat's stick-to-bottom controller and
 * deeply nested components that mutate layout (edit-mode mounts, tool-card
 * expanders, thinking toggles).
 *
 * Why: `use-stick-to-bottom` treats ANY positive content growth while
 * pinned at the bottom as "streaming output — follow it". A user click
 * that expands content mid-transcript therefore re-pins the viewport to
 * the bottom and the clicked element flies out of view. The industry
 * pattern (assistant-ui ThreadViewport, ChatGPT, MUI chat) is: user
 * intent releases the follow lock, and only the explicit ↓ button (or
 * reaching the bottom again) re-engages it.
 *
 * Components call `releaseAutoFollow()` BEFORE any user-initiated
 * expansion. ChatWindow registers the live controller on mount.
 */

interface ScrollControl {
  stopScroll: () => void;
  scrollToBottom: () => void;
  /** The scroll container element (for expansion anchoring). */
  getScrollElement?: () => HTMLElement | null;
}

let current: ScrollControl | null = null;

export function registerScrollControl(ctrl: ScrollControl): () => void {
  current = ctrl;
  return () => {
    if (current === ctrl) current = null;
  };
}

/** Release the auto-follow lock. Call before user-initiated layout growth. */
export function releaseAutoFollow(): void {
  current?.stopScroll();
}

/** Re-engage: jump to the bottom and re-pin (the ↓ button). */
export function jumpToBottom(): void {
  current?.scrollToBottom();
}

/**
 * Keep a user-clicked expandable visually anchored while it grows.
 *
 * Convention from polished agent UIs (Cursor, Linear): if the element's
 * bottom edge sits in the LOWER half of the viewport, anchor the bottom
 * edge — the expansion grows UPWARD and the content the user is about to
 * read stays on screen. Otherwise anchor the top edge (natural downward
 * growth). Implemented as scrollTop compensation on the next frame,
 * after React commits the expanded layout.
 *
 * Call SYNCHRONOUSLY in the click handler, before the state update.
 */
export function anchorExpansion(el: HTMLElement | null): void {
  const scroller = current?.getScrollElement?.();
  if (!(scroller && el)) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const before = el.getBoundingClientRect();
  const anchorBottom =
    before.bottom - scrollerRect.top > scroller.clientHeight / 2;
  requestAnimationFrame(() => {
    const after = el.getBoundingClientRect();
    const delta = anchorBottom
      ? after.bottom - before.bottom
      : after.top - before.top;
    if (delta !== 0) scroller.scrollTop += delta;
  });
}
