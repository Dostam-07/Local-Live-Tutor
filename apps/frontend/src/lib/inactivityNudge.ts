/**
 * Student inactivity nudge (user spec: a patient human tutor, not a timeout).
 *
 * While the tutor is WAITING for the student — it asked a question, posed a
 * quiz, or simply finished speaking — a gentle check-in fires after a
 * configurable quiet period. The nudge:
 *  - never marks the student wrong, never reveals the answer,
 *  - never restarts or resets the problem,
 *  - fires at most once per waiting stretch (one nudge, then silence until
 *    the student interacts),
 *  - reads the room: what it says depends on the learning context (thinking
 *    over a quiz, seemingly stuck, mid-lesson gap after an explanation).
 *
 * The texts are speech-friendly by design: short sentences, contractions,
 * natural pauses — they go through the same speech layer as tutor turns.
 */

export type NudgeContext =
  /** A quiz question / posed problem is awaiting an answer. */
  | "quiz"
  /** The tutor just explained something; the floor is the student's. */
  | "explained"
  /** Repeated nudges already fired — the student may be genuinely stuck. */
  | "stuck"
  /** Two nudges went unanswered — offer to break the problem down. */
  | "substep"
  /** The tutor asked something and is waiting on the student. */
  | "waiting";

/** Varied, natural check-ins — never the same sentence twice in a row. */
const NUDGES: Record<NudgeContext, readonly string[]> = {
  quiz: [
    "Still working on it? No rush at all — I'll be right here.",
    "Take your time on this one. I'm here whenever you're ready.",
    "No pressure — think it through, I'm not going anywhere.",
  ],
  explained: [
    "Are you still with me? Take your time — I'm here when you're ready.",
    "Whenever you're ready, just tell me what you're thinking.",
    "Still there? We can pick up exactly where we left off.",
  ],
  stuck: [
    "Hey, if this one's tricky, I can give you a small hint — just say the word.",
    "No rush. If you're stuck, I can give you a small hint — we'll crack it together.",
    "Take your time. And remember, asking for a hint is a power move, not a weakness.",
  ],
  waiting: [
    "Hey, are you still here? Take your time — I'm here when you're ready.",
    "I'm here with you. Would you like to continue?",
    "Still with me? We'll continue whenever you're ready.",
  ],
  substep: [
    "This one might be a lot all at once. Want me to pick a smaller first step together?",
    "How about we shrink it down — I can give you one tiny piece to start with. Just say the word.",
    "If it feels big right now, we can take the smallest possible step first. Ready when you are.",
  ],
};

/** The last nudge text handed out, so consecutive nudges never repeat. */
let lastNudge = "";

/**
 * Picks a nudge for the current learning context.
 *
 * Escalation ladder (user spec: distinguish thinking from stuck):
 *   nudge 1 → space + warmth ("take your time")
 *   nudge 2 → a hint offer ("if you're stuck, I can give you a small hint")
 *   nudge 3+ → a smaller-sub-step offer ("want me to pick a tiny first
 *   piece together?") — never the answer, never a reset, never pressure.
 */
export function pickNudge(context: NudgeContext, unansweredCount: number): string {
  let effective: NudgeContext = context;
  if (unansweredCount >= 2) {
    effective = "substep";
  } else if (unansweredCount === 1 && (context === "quiz" || context === "waiting" || context === "explained")) {
    effective = "stuck";
  }
  const pool = NUDGES[effective];
  // Deterministically avoid an immediate repeat (a broken-record tutor is
  // exactly what the user asked to avoid): drop the last text from the draw.
  const fresh = pool.filter((t) => t !== lastNudge);
  const source = fresh.length > 0 ? fresh : pool;
  const text = source[Math.floor(Math.random() * source.length)] ?? "";
  lastNudge = text;
  return text;
}

/** Test seam: forget the last nudge so a fresh test run starts clean. */
export function resetNudgeMemory(): void {
  lastNudge = "";
}

/**
 * One-shot inactivity timer. Arm it while waiting on the student; any
 * interaction cancels it. `onFire` runs at most once per arm — the caller
 * re-arms only after the student actually responds.
 */
export class InactivityTimer {
  private handle: number | undefined;
  private armed = false;

  /** Starts (or restarts) the countdown. No-op when seconds ≤ 0 (disabled). */
  arm(seconds: number, onFire: () => void): void {
    this.cancel();
    if (seconds <= 0) return;
    this.armed = true;
    this.handle = window.setTimeout(() => {
      if (!this.armed) return;
      this.armed = false;
      this.handle = undefined;
      onFire();
    }, seconds * 1000);
  }

  /** Cancels without firing — the student interacted (or the state changed). */
  cancel(): void {
    this.armed = false;
    if (this.handle !== undefined) {
      window.clearTimeout(this.handle);
      this.handle = undefined;
    }
  }

  get isArmed(): boolean {
    return this.armed;
  }
}
