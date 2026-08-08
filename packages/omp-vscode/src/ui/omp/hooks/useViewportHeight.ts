"use client";

import { useEffect } from "react";

interface ViewportHeightState {
  hasFocusedEditable: boolean;
  innerHeight: number;
  viewportHeight: number;
  viewportScale: number;
}

export function shouldUseVisualViewportHeight({
  hasFocusedEditable,
  innerHeight,
  viewportHeight,
  viewportScale,
}: ViewportHeightState): boolean {
  const isUnscaled = Math.abs(viewportScale - 1) < 0.01;
  return hasFocusedEditable && isUnscaled && innerHeight - viewportHeight > 1;
}

function hasFocusedEditableElement(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  return activeElement.isContentEditable
    || activeElement.tagName === "INPUT"
    || activeElement.tagName === "SELECT"
    || activeElement.tagName === "TEXTAREA";
}

/**
 * Keep the app height aligned with the visual viewport while a mobile keyboard
 * is open. iOS standalone PWAs can leave 100dvh at the layout viewport height,
 * which puts the composer behind the keyboard and may scroll the page itself.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    // Desktop / electron webviews: the visualViewport heuristics below are
    // for on-screen keyboards only. Guard with a touch-capability check so a
    // misbehaving visualViewport (e.g. innerHeight != viewport.height from
    // zoom/anchors) can never shrink the app and leave the body background
    // exposed below the chat page.
    if (!("ontouchstart" in window) || navigator.maxTouchPoints === 0) return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;

    const update = () => {
      const keyboardOpen = shouldUseVisualViewportHeight({
        hasFocusedEditable: hasFocusedEditableElement(),
        innerHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportScale: viewport.scale,
      });
      if (keyboardOpen) {
        root.style.setProperty("--app-viewport-height", `${viewport.height}px`);
        if (window.scrollX !== 0 || window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      } else if (root.style.getPropertyValue("--app-viewport-height")) {
        // Clear any stale value (e.g. set while the mobile keyboard was
        // open) as soon as focus leaves an editable or the viewport
        // returns to full height; a leftover short height leaves the
        // chat page short and exposes the body background below it.
        root.style.removeProperty("--app-viewport-height");
      }
    };

    // Re-evaluate on focus changes too: blurring into a dropdown trigger
    // (e.g. model menu) must clear the keyboard-height override even if
    // no viewport resize event fires.
    const onFocus = () => update();
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);
}
