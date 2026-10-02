import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHALK_STEP_MS,
  runChalkSequence,
  scheduleChalkOps,
} from "../src/features/whiteboard/chalkSequencer";
import type { WhiteboardOperation } from "@local-live-tutor/shared";

const op = (n: number): WhiteboardOperation => ({
  id: `op-${n}`,
  sessionId: "s",
  actor: "tutor",
  type: "write",
  payload: { x: 100, y: 100, text: `line ${n}` },
  createdAt: new Date().toISOString(),
});

describe("chalkSequencer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("staggers ops with the first at zero delay", () => {
    const timed = scheduleChalkOps([op(1), op(2), op(3)]);
    expect(timed.map((t) => t.delay)).toEqual([0, CHALK_STEP_MS, 2 * CHALK_STEP_MS]);
  });

  it("reveals each op after its delay", () => {
    const revealed: string[] = [];
    const cancel = runChalkSequence(scheduleChalkOps([op(1), op(2)]), (op) =>
      revealed.push(op.id),
    );
    expect(revealed).toEqual([]);
    vi.advanceTimersByTime(CHALK_STEP_MS - 1);
    expect(revealed).toEqual(["op-1"]);
    vi.advanceTimersByTime(1);
    expect(revealed).toEqual(["op-1", "op-2"]);
    cancel();
  });

  it("cancel prevents pending reveals but keeps revealed ones", () => {
    const revealed: string[] = [];
    const cancel = runChalkSequence(scheduleChalkOps([op(1), op(2)]), (op) =>
      revealed.push(op.id),
    );
    vi.advanceTimersByTime(CHALK_STEP_MS - 1);
    cancel();
    vi.advanceTimersByTime(10 * CHALK_STEP_MS);
    expect(revealed).toEqual(["op-1"]);
  });

  it("returns a no-op cancel for an empty schedule", () => {
    const cancel = runChalkSequence([], () => {
      throw new Error("should not reveal");
    });
    expect(() => cancel()).not.toThrow();
  });
});
