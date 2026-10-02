/**
 * Adaptive persona (roadmap: the tutor reads the room) — deterministic
 * student-state detection shared by the tutoring service and tests.
 *
 * The BASE persona is what the student picked; the ADAPTATION is a tone
 * overlay computed from how the student is actually doing:
 * - struggling → drop the jokes, slow down, encourage
 * - cruising → playful energy, celebrate, raise the challenge
 * - neutral → the base persona speaks as-is.
 * The overlay never changes the pedagogy — only tone.
 */
import type { PersonaAdaptation } from "@local-live-tutor/shared";

export function computeAdaptation(
  quizResults: Array<{ correct: boolean }>,
  hintsTaken: number,
): PersonaAdaptation {
  const last = quizResults.at(-1);
  const prev = quizResults.at(-2);
  if (last && !last.correct && prev && !prev.correct) return "struggling";
  if (last && !last.correct && hintsTaken >= 2) return "struggling";
  if (last?.correct && prev?.correct) return "cruising";
  return "neutral";
}
