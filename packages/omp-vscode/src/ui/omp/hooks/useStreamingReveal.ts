import { useEffect, useMemo, useRef, useState } from "react";

const FRAME_INTERVAL_MS = 1000 / 30;
const CATCHUP_FRAMES = 8;
const MIN_STEP = 3;

function graphemeSlice(
  text: string,
  count: number,
  segmenter: Intl.Segmenter
): string {
  if (count <= 0 || text.length === 0) return "";

  let seen = 0;
  for (const segment of segmenter.segment(text)) {
    seen += 1;
    if (seen >= count)
      return text.slice(0, segment.index + segment.segment.length);
  }
  return text;
}

function graphemeCount(text: string, segmenter: Intl.Segmenter): number {
  let count = 0;
  for (const _segment of segmenter.segment(text)) count += 1;
  return count;
}

/**
 * Smoothly reveals an append-only streamed text value at 30 fps. `thinking`
 * identifies a thinking stream so its independent reveal cursor is reset when
 * the block changes kind. Consumers may pass `snapToEnd` for transcript-order
 * boundaries such as a following tool call.
 */
export function useStreamingReveal(
  text: string,
  thinking = false,
  snapToEnd = false
): { displayText: string } {
  const segmenter = useMemo(
    () => new Intl.Segmenter(undefined, { granularity: "grapheme" }),
    []
  );
  const targetRef = useRef(text);
  const revealedRef = useRef(0);
  const kindRef = useRef(thinking);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    const previous = targetRef.current;
    targetRef.current = text;

    if (kindRef.current !== thinking || !text.startsWith(previous)) {
      kindRef.current = thinking;
      revealedRef.current = 0;
      setRevealed(0);
    }
  }, [text, thinking]);

  useEffect(() => {
    // Fast path: never-streamed content (loaded from JSONL / a message
    // that has always been in snapToEnd mode) — reveal instantly, no
    // animation. revealedRef stays at 0 for this case because the frame
    // loop has never run.
    if (snapToEnd && revealedRef.current === 0) {
      const total = graphemeCount(text, segmenter);
      revealedRef.current = total;
      setRevealed(total);
      return;
    }

    const tick = (timestamp: number) => {
      if (timestamp - lastFrameRef.current < FRAME_INTERVAL_MS) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameRef.current = timestamp;

      const total = graphemeCount(targetRef.current, segmenter);
      if (revealedRef.current >= total) {
        frameRef.current = null;
        return;
      }

      const remaining = total - revealedRef.current;
      // Turn just ended (snapToEnd flipped true mid-stream): finish the
      // remaining reveal in ~3 frames (~100ms) at 30fps. Smooths out the
      // gap between "last chunk arrived" and "prompt resolved" — used to
      // hard-snap and the tail of the message flashed in ("嘣一下").
      // Regular streaming keeps the gentler 8-frame catchup.
      const catchupFrames = snapToEnd ? 3 : CATCHUP_FRAMES;
      const minStep = snapToEnd ? MIN_STEP * 6 : MIN_STEP;
      const step = Math.max(minStep, Math.ceil(remaining / catchupFrames));
      revealedRef.current = Math.min(total, revealedRef.current + step);
      setRevealed(revealedRef.current);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastFrameRef.current = 0;
    };
  }, [segmenter, snapToEnd, text]);

  const displayText = useMemo(
    () => graphemeSlice(text, revealed, segmenter),
    [revealed, segmenter, text]
  );
  return useMemo(() => ({ displayText }), [displayText]);
}
