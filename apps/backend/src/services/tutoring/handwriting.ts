/**
 * Handwriting practice grading (roadmap: the student chalks the answer
 * themselves and the tutor grades it).
 *
 * Two paths, chosen by capability (never silently skips the image):
 * - Vision provider: reads the ACTUAL board capture (photo of the student's
 *   handwriting) and grades content + legibility from what it sees.
 * - Text-only provider: grades the typed transcription of what the student
 *   wrote; legibility is estimated from transcription noise (unclear marks,
 *   question marks) — an honest approximation, not a fake reading.
 *
 * The outcome is persisted as a quiz result so marks, XP stats, and the
 * parent weekly view include handwriting practice.
 */
import type { Session } from "@local-live-tutor/shared";
import type { HandwritingFeedback, HandwritingGradeInput } from "@local-live-tutor/shared";

import { Errors } from "../../errors.js";
import type { AppDeps } from "../../routes/index.js";
import { HANDWRITING_GRADE_PROMPT } from "@local-live-tutor/shared";

/** XP awards mirror the quiz values (tutoring.ts) so marks stay consistent. */
const XP_CORRECT_QUIZ = 10;
const XP_PARTICIPATION = 2;

/** Deterministic legibility estimate for the no-image path (0–100). */
function estimateLegibility(written: string): number {
  const t = written.trim();
  if (!t) return 0;
  const unclear = (t.match(/[?*~^]+/g) ?? []).length;
  const words = t.split(/\s+/).filter(Boolean).length;
  const lengthPenalty = words < 2 ? 15 : 0;
  return Math.max(20, Math.min(95, 92 - unclear * 8 - lengthPenalty));
}

function normalizeVerdict(
  raw: string,
): HandwritingFeedback["verdict"] {
  const v = raw.toLowerCase();
  if (v.includes("unreadable") || v.includes("unclear")) return "unreadable";
  if (v.includes("partial")) return "partially_correct";
  if (v.includes("incorrect") || v.includes("wrong") || v.includes("incorrect")) return "incorrect";
  if (v.includes("correct")) return "correct";
  return "unreadable";
}

function clampLegibility(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function gradeHandwriting(
  deps: AppDeps,
  session: Session,
  input: HandwritingGradeInput,
): Promise<HandwritingFeedback> {
  const { provider } = await deps.registry.resolve();
  const wantsVision = Boolean(input.imageDataUrl);
  const visionAvailable = typeof provider.vision === "function";

  if (wantsVision && !visionAvailable) {
    throw Errors.visionUnsupported();
  }

  let feedback: HandwritingFeedback;

  if (wantsVision && visionAvailable) {
    const base64 = (input.imageDataUrl ?? "").split(",")[1] ?? "";
    const response = await (provider as Required<Pick<typeof provider, "vision">> & typeof provider).vision({
      imageBase64: base64,
      imageMime: "image/png",
      forceJson: true,
      messages: [
        { role: "system", content: HANDWRITING_GRADE_PROMPT },
        {
          role: "user",
          content: `The student was asked to write: "${input.prompt}"${
            input.expected ? ` (reference answer: "${input.expected}")` : ""
          }. This is a photo of what they wrote on the chalkboard. Grade it.`,
        },
      ],
    });
    let parsed: Partial<HandwritingFeedback> & { verdict?: string } = {};
    try {
      parsed = JSON.parse(response.text) as typeof parsed;
    } catch {
      throw Errors.internal("The model returned unreadable grading output. Try again.");
    }
    const verdict = normalizeVerdict(String(parsed.verdict ?? ""));
    if (!parsed.readAs || !parsed.feedback) {
      throw Errors.internal("The model returned incomplete grading output. Try again.");
    }
    feedback = {
      readAs: String(parsed.readAs).slice(0, 2000),
      verdict,
      feedback: String(parsed.feedback).slice(0, 1000),
      correct: typeof parsed.correct === "boolean" ? parsed.correct : verdict === "correct",
      legibility: clampLegibility(parsed.legibility),
    };
  } else {
    // Text-only path: grade the transcription; legibility is estimated.
    const systemPrompt =
      "You grade a student's handwritten answer for an AI tutor. The student wrote the answer by hand on a chalkboard and typed what they wrote. Compare what they wrote against what was asked. NEVER solve the problem yourself. Be encouraging and specific. Return ONLY JSON: {\"readAs\": string, \"verdict\": \"correct\"|\"partially_correct\"|\"incorrect\"|\"unreadable\", \"feedback\": string (2-3 sentences), \"correct\": boolean, \"legibility\": number 0-100}.";
    const response = await provider.chat({
      forceJson: true,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Asked to write: "${input.prompt}"${
            input.expected ? `\nReference answer: "${input.expected}"` : ""
          }\nStudent's transcription of their board writing: "${input.written}"\nGrade the answer.`,
        },
      ],
    });
    let parsed: Partial<HandwritingFeedback> & { verdict?: string } = {};
    try {
      parsed = JSON.parse(response.content) as typeof parsed;
    } catch {
      throw Errors.internal("The model returned unreadable grading output. Try again.");
    }
    const verdict = normalizeVerdict(String(parsed.verdict ?? ""));
    if (!parsed.readAs || !parsed.feedback) {
      throw Errors.internal("The model returned incomplete grading output. Try again.");
    }
    feedback = {
      readAs: String(parsed.readAs).slice(0, 2000),
      verdict,
      feedback: String(parsed.feedback).slice(0, 1000),
      correct: typeof parsed.correct === "boolean" ? parsed.correct : verdict === "correct",
      legibility: estimateLegibility(input.written),
    };
  }

  // Persist as a quiz result (marks + parent view include handwriting).
  if (feedback.verdict !== "unreadable") {
    deps.quiz.create({
      sessionId: session.id,
      question: `[Handwriting] ${input.prompt}`,
      correct: feedback.correct,
      feedback: `${feedback.verdict} · legibility ${feedback.legibility}/100 — ${feedback.feedback}`,
    });
    deps.studyStats.recordAnswer(
      feedback.correct,
      feedback.correct ? XP_CORRECT_QUIZ : XP_PARTICIPATION,
    );
    // Same delta patch shape the quiz flow uses (repo derives the totals).
    deps.sessions.update(session.id, {
      xpAward: feedback.correct ? XP_CORRECT_QUIZ : XP_PARTICIPATION,
      quizCorrectDelta: feedback.correct ? 1 : 0,
      quizAskedDelta: 1,
    } as never);
  }

  return feedback;
}
