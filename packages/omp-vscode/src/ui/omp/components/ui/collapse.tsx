import type { ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";

/** Shared height+opacity collapse animation. Every existing expand/collapse
 *  in the chat (thinking blocks, tool detail, footer meta, branch summary,
 *  toolbar) inlined the same three-line motion snippet with slightly
 *  different durations. Consolidating them here means one place to tune
 *  the app's motion feel — matching the `--omp-motion-*` CSS tokens in
 *  globals.css so plain-CSS and Motion animations stay in lockstep. */
export function Collapse({
  open,
  children,
  className,
  style,
  duration = "base",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  duration?: "fast" | "base" | "slow";
}) {
  const seconds =
    duration === "fast" ? 0.12 : duration === "slow" ? 0.24 : 0.16;
  const transition: Transition = { duration: seconds, ease: [0.2, 0, 0, 1] };
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={transition}
          className={className}
          style={{ overflow: "hidden", ...style }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
