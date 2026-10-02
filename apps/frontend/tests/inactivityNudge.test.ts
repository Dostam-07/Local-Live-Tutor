/**
 * Inactivity nudge unit tests (user spec: gentle human check-in, never a
 * system timeout) — varied non-repeating texts, the escalation ladder
 * (space → hint offer → smaller-sub-step offer), never-wrong/never-reveal
 * guarantees, and one-shot timer semantics. Offline and deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InactivityTimer, pickNudge, resetNudgeMemory } from "../src/lib/inactivityNudge";

describe("pickNudge (gentle check-in texts)", () => {
  beforeEach(() => resetNudgeMemory());

  it("never returns the same text twice in a row", () => {
    const seen = new Set<string>();
    let last = pickNudge("waiting", 0);
    seen.add(last);
    for (let i = 0; i < 40; i += 1) {
      const next = pickNudge("waiting", 0);
      expect(next).not.toBe(last); // consecutive nudges vary
      seen.add(next);
      last = next;
    }
    expect(seen.size).toBeGreaterThan(1); // the pool actually rotates
  });

  it("nudge 1 gives space (no hint push, no pressure)", () => {
    const first = pickNudge("quiz", 0);
    expect(first).toMatch(/take your time|no rush|think it through/i);
    expect(first).not.toMatch(/hint/i);
  });

  it("nudge 2 offers a hint — space first, help second", () => {
    const second = pickNudge("quiz", 1);
    expect(second).toMatch(/hint|together|power move/i);
  });

  it("nudge 3 offers a smaller sub-step, never the answer (user spec)", () => {
    for (const context of ["quiz", "waiting", "explained", "stuck"] as const) {
      resetNudgeMemory();
      const third = pickNudge(context, 2);
      expect(third).toMatch(/smaller|tiny|smallest|shrink/i);
      // Never reveals or solves; it offers to break the problem down.
      expect(third).toMatch(/\?|word|ready/i);
    }
  });

  it("the ladder never marks the student wrong or reveals an answer", () => {
    for (const context of ["quiz", "explained", "stuck", "waiting"] as const) {
      for (let unanswered = 0; unanswered <= 4; unanswered += 1) {
        resetNudgeMemory();
        const text = pickNudge(context, unanswered);
        expect(text.toLowerCase()).not.toMatch(/wrong|incorrect|the answer is|timeout|inactivity/);
      }
    }
  });
});

describe("InactivityTimer (one-shot countdown)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the configured delay", () => {
    const timer = new InactivityTimer();
    const onFire = vi.fn();
    timer.arm(120, onFire);
    vi.advanceTimersByTime(119_999);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500_000);
    expect(onFire).toHaveBeenCalledTimes(1); // one nudge per stretch
  });

  it("cancel stops it without firing (student interacted)", () => {
    const timer = new InactivityTimer();
    const onFire = vi.fn();
    timer.arm(120, onFire);
    vi.advanceTimersByTime(60_000);
    timer.cancel();
    vi.advanceTimersByTime(500_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("re-arming restarts the countdown (drawing pause → fresh window)", () => {
    const timer = new InactivityTimer();
    const onFire = vi.fn();
    timer.arm(120, onFire);
    vi.advanceTimersByTime(100_000);
    timer.arm(120, onFire); // drawing paused the timer → fresh window
    vi.advanceTimersByTime(110_000);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("seconds <= 0 disables the nudge entirely", () => {
    const timer = new InactivityTimer();
    const onFire = vi.fn();
    timer.arm(0, onFire);
    vi.advanceTimersByTime(10 * 60_000);
    expect(onFire).not.toHaveBeenCalled();
    expect(timer.isArmed).toBe(false);
  });
});
