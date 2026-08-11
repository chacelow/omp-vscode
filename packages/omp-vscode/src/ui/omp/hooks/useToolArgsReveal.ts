import { useEffect, useMemo, useRef, useState } from "react";

const FRAME_INTERVAL_MS = 1000 / 30;
const CATCHUP_FRAMES = 8;
const MIN_STEP = 3;
const REVEALED_KEYS = ["content", "input", "code"] as const;

function rawInputText(rawInput: unknown): string {
  if (typeof rawInput === "string") return rawInput;
  try {
    return JSON.stringify(rawInput ?? {});
  } catch {
    return "";
  }
}

function clampSliceEnd(text: string, end: number): number {
  if (end <= 0) return 0;
  if (end >= text.length) return text.length;
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end + 1 : end;
}

function decodeJsonString(value: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${value}"`);
    if (typeof decoded === "string") return decoded;
  } catch {
    // The partial value has not closed its JSON string yet.
  }
  return value.replace(/\\(?:u([\da-fA-F]{0,4})|(["\\/bfnrt]))?/g, (_match, unicode: string | undefined, escaped: string | undefined) => {
    if (unicode !== undefined && unicode.length === 4) return String.fromCharCode(Number.parseInt(unicode, 16));
    const escapes: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    return escaped === undefined ? "" : (escapes[escaped] ?? escaped);
  });
}

function partialDisplayInput(prefix: string): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const key of REVEALED_KEYS) {
    const match = new RegExp(`(?:^|[,{]\\s*)"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, "s").exec(prefix);
    if (match?.[1] !== undefined) parsed[key] = decodeJsonString(match[1]);
  }

  try {
    const complete = JSON.parse(prefix);
    if (typeof complete === "object" && complete !== null && !Array.isArray(complete)) {
      for (const key of REVEALED_KEYS) {
        const value = complete[key];
        if (value !== undefined) parsed[key] = value;
      }
    }
  } catch {
    // A streaming JSON buffer is usually incomplete; the top-level scan above is intentional.
  }

  return parsed;
}

/** Paces raw streamed tool arguments and exposes safely decoded top-level preview fields. */
export function useToolArgsReveal(rawInput: unknown): { displayInput: Record<string, unknown> } {
  const target = useMemo(() => rawInputText(rawInput), [rawInput]);
  const targetRef = useRef(target);
  const revealedRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (!target.startsWith(targetRef.current)) {
      revealedRef.current = 0;
      setRevealed(0);
    }
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    const tick = (timestamp: number) => {
      if (timestamp - lastFrameRef.current < FRAME_INTERVAL_MS) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameRef.current = timestamp;
      const total = targetRef.current.length;
      if (revealedRef.current >= total) {
        frameRef.current = null;
        return;
      }
      const step = Math.max(MIN_STEP, Math.ceil((total - revealedRef.current) / CATCHUP_FRAMES));
      revealedRef.current = clampSliceEnd(targetRef.current, Math.min(total, revealedRef.current + step));
      setRevealed(revealedRef.current);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      lastFrameRef.current = 0;
    };
  }, [target]);

  const displayInput = useMemo(() => partialDisplayInput(target.slice(0, revealed)), [revealed, target]);
  return useMemo(() => ({ displayInput }), [displayInput]);
}
