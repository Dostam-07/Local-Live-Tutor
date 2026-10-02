/**
 * First-input handoff (welcome board → workspace).
 *
 * The welcome board greets locally and creates the session only at the
 * student's first input. That input must then drive turn one on the workspace
 * — not a redundant greeting — so it is parked here (per-sessionId storage)
 * and consumed once, by the workspace's load effect.
 *
 * sessionStorage keeps the handoff alive across the client-side navigation
 * (and an accidental hard reload); it is consumed exactly once and cleared.
 */
export type FirstInput = {
  text?: string;
  upload?: { name: string; dataUrl: string };
  /** Explicit lesson settings chosen on the welcome board, if any. */
  prefs?: {
    subject?: string;
    gradeLevel?: string;
    helpLevel?: string;
    /** Per-session memory (roadmap): stashed style/voice/language. */
    persona?: string;
    voice?: string;
    language?: string;
  };
};

const key = (sessionId: string) => `tutor:first-input:${sessionId}`;

export function stashFirstMessage(sessionId: string, input: FirstInput): void {
  try {
    window.sessionStorage.setItem(key(sessionId), JSON.stringify(input));
  } catch {
    /* storage unavailable — the workspace falls back to the normal greeting */
  }
}

export function consumeFirstMessage(sessionId: string): FirstInput | null {
  try {
    const raw = window.sessionStorage.getItem(key(sessionId));
    if (!raw) return null;
    window.sessionStorage.removeItem(key(sessionId));
    const parsed = JSON.parse(raw) as FirstInput;
    return parsed && (parsed.text || parsed.upload) ? parsed : null;
  } catch {
    return null;
  }
}
