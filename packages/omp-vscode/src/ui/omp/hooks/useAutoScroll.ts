import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Chat viewport auto-follow, ported from assistant-ui's
 * `useThreadViewportAutoScroll` (assistant-ui/assistant-ui@822a3b3,
 * packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts, MIT).
 *
 * Semantics — the pattern ChatGPT-class UIs converge on:
 * - Content growth auto-follows ONLY while the user is at the bottom, and
 *   follows with an INSTANT jump (no spring/smooth animation loop, so a
 *   user's upward scroll is never overwritten by a next animation frame).
 * - A user scroll-up (scrollTop decreased while scrollHeight unchanged)
 *   releases the follow; from then on NOTHING scrolls the viewport until
 *   the user returns to the bottom or an explicit intent fires.
 * - `pointerdown` cancels any pending scroll-to-bottom intent, so clicking
 *   (e.g. expanding a collapsible) never hijacks the next content growth.
 * - Big actions plant explicit intent: send / edit-resend → smooth scroll,
 *   session load / switch → instant scroll. Everything else never scrolls.
 *
 * Replaces `use-stick-to-bottom`: its spring wrote scrollTop every frame
 * during follow, fighting user input in the VS Code webview (wheel-escape
 * heuristics miss trackpad momentum and scrollbar drags).
 */

export interface AutoScrollHandle {
  /** Attach to the scroll container (the overflow-y element). */
  scrollRef: (el: HTMLElement | null) => void;
  /** Attach to the content wrapper (the element that grows). */
  contentRef: (el: HTMLElement | null) => void;
  /** Explicit intent: jump/animate to bottom and re-engage follow. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Release the follow lock without scrolling — call before a
   * user-initiated layout growth (edit-mode mount, collapsible expand)
   * so the growth isn't followed to the bottom. */
  release: () => void;
  /** True while the viewport is pinned to the bottom (follow engaged). */
  isAtBottom: () => boolean;
  /** Subscribe to isAtBottom changes (for the ↓ button). */
  subscribe: (cb: (isAtBottom: boolean) => void) => () => void;
}

const BOTTOM_EPSILON_PX = 1;

export function useAutoScroll(): AutoScrollHandle {
  const divRef = useRef<HTMLElement | null>(null);
  const isAtBottomRef = useRef(true);
  const listenersRef = useRef(new Set<(v: boolean) => void>());
  const lastScrollTop = useRef(0);
  const lastScrollHeight = useRef(0);
  const lastObservedScrollHeight = useRef(0);
  const lastObservedClientHeight = useRef(0);
  /** Pending bottom-scroll intent (send/load). Cleared on arrival at the
   * bottom or when the user actively scrolls up on stable content. */
  const pendingBehaviorRef = useRef<ScrollBehavior | null>(null);
  const scheduledFrameRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const setIsAtBottom = useCallback((next: boolean) => {
    if (isAtBottomRef.current === next) return;
    isAtBottomRef.current = next;
    for (const cb of listenersRef.current) cb(next);
  }, []);

  const doScrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const div = divRef.current;
    if (!div) return;
    pendingBehaviorRef.current = behavior;
    div.scrollTo({ top: div.scrollHeight, behavior });
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      setIsAtBottom(true);
      pendingBehaviorRef.current = behavior;
      if (scheduledFrameRef.current !== null) {
        cancelAnimationFrame(scheduledFrameRef.current);
      }
      scheduledFrameRef.current = requestAnimationFrame(() => {
        scheduledFrameRef.current = null;
        doScrollToBottom(behavior);
      });
    },
    [doScrollToBottom, setIsAtBottom]
  );

  const handleScroll = useCallback(() => {
    const div = divRef.current;
    if (!div) return;

    const newIsAtBottom =
      Math.abs(div.scrollHeight - div.scrollTop - div.clientHeight) <=
        BOTTOM_EPSILON_PX || div.scrollHeight <= div.clientHeight;

    const isInFlightDownwardScroll =
      !newIsAtBottom && lastScrollTop.current < div.scrollTop;
    if (!isInFlightDownwardScroll) {
      // (a smooth scroll-to-bottom fires many midpoint events before landing;
      // don't flicker isAtBottom or clear intent mid-animation)
      if (newIsAtBottom) {
        // Ambiguous when the viewport doesn't overflow — keep intent alive
        // until content can actually scroll.
        const viewportOverflows = div.scrollHeight > div.clientHeight + 1;
        if (viewportOverflows) pendingBehaviorRef.current = null;
      } else if (
        lastScrollTop.current > div.scrollTop &&
        lastScrollHeight.current === div.scrollHeight
      ) {
        // scrollHeight equality rules out content-driven shifts being
        // misread as a user scroll-up.
        pendingBehaviorRef.current = null;
      }
      const shouldUpdate = newIsAtBottom || pendingBehaviorRef.current === null;
      if (shouldUpdate) setIsAtBottom(newIsAtBottom);
    }

    lastScrollTop.current = div.scrollTop;
    lastScrollHeight.current = div.scrollHeight;
  }, [setIsAtBottom]);

  const handleContentResize = useCallback(() => {
    const div = divRef.current;
    if (!div) return;
    const { scrollHeight, clientHeight } = div;
    if (
      scrollHeight === lastObservedScrollHeight.current &&
      clientHeight === lastObservedClientHeight.current
    ) {
      return;
    }
    lastObservedScrollHeight.current = scrollHeight;
    lastObservedClientHeight.current = clientHeight;

    const pending = pendingBehaviorRef.current;
    if (pending) {
      doScrollToBottom(pending);
    } else if (isAtBottomRef.current) {
      // Follow streaming growth with an instant jump — no animation frame
      // loop to fight the user's input.
      doScrollToBottom("instant");
    }
    handleScroll();
  }, [doScrollToBottom, handleScroll]);

  const cancelPendingIntent = useCallback(() => {
    // A pointer gesture invalidates pending intent; otherwise an intent kept
    // alive by a non-overflowing thread hijacks the next content growth
    // (e.g. expanding a collapsible tool call).
    pendingBehaviorRef.current = null;
  }, []);

  const scrollRef = useCallback(
    (el: HTMLElement | null) => {
      const prev = divRef.current;
      if (prev) {
        prev.removeEventListener("scroll", handleScroll);
        prev.removeEventListener("pointerdown", cancelPendingIntent);
      }
      divRef.current = el;
      if (el) {
        el.addEventListener("scroll", handleScroll, { passive: true });
        el.addEventListener("pointerdown", cancelPendingIntent, {
          passive: true,
        });
        lastScrollTop.current = el.scrollTop;
        lastScrollHeight.current = el.scrollHeight;
      }
    },
    [handleScroll, cancelPendingIntent]
  );

  const contentRef = useCallback(
    (el: HTMLElement | null) => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (!el) return;
      const ro = new ResizeObserver(handleContentResize);
      ro.observe(el);
      resizeObserverRef.current = ro;
    },
    [handleContentResize]
  );

  useLayoutEffect(
    () => () => {
      if (scheduledFrameRef.current !== null) {
        cancelAnimationFrame(scheduledFrameRef.current);
      }
      resizeObserverRef.current?.disconnect();
    },
    []
  );

  const isAtBottom = useCallback(() => isAtBottomRef.current, []);
  const subscribe = useCallback((cb: (v: boolean) => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);
  const release = useCallback(() => {
    pendingBehaviorRef.current = null;
    setIsAtBottom(false);
  }, [setIsAtBottom]);

  return {
    scrollRef,
    contentRef,
    scrollToBottom,
    release,
    isAtBottom,
    subscribe,
  };
}
