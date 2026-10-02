/**
 * Chalk write-in sequencer (ADR-0005).
 *
 * Turns the tutor's new whiteboard ops into a timed reveal: each op "arrives"
 * (CSS chalk-in animation + optional caption) on a stagger, the way a tutor
 * finishes one line of chalk before starting the next. Pure timing logic is
 * separated from rendering so it is unit-testable with fake timers.
 */
import type { WhiteboardOperation } from "@local-live-tutor/shared";

export const CHALK_STEP_MS = 550;

export type TimedOp = {
  op: WhiteboardOperation;
  /** Delay from sequence start until this op is chalked in, in ms. */
  delay: number;
};

/** Staggers ops so they chalk in one after another (first one immediately). */
export function scheduleChalkOps(
  ops: WhiteboardOperation[],
  stepMs: number = CHALK_STEP_MS,
): TimedOp[] {
  return ops.map((op, index) => ({ op, delay: index * stepMs }));
}

/**
 * Runs a reveal schedule, invoking `reveal` after each op's delay.
 * Returns a cancel function; already-revealed ops stay on the board.
 */
export function runChalkSequence(
  timed: TimedOp[],
  reveal: (op: WhiteboardOperation) => void,
  setTimeoutFn: (fn: () => void, ms: number) => number = window.setTimeout.bind(window),
  clearTimeoutFn: (handle: number) => void = window.clearTimeout.bind(window),
): () => void {
  const handles = timed.map(({ op, delay }) =>
    setTimeoutFn(() => reveal(op), delay),
  );
  return () => {
    for (const handle of handles) clearTimeoutFn(handle);
  };
}
