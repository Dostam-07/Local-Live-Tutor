/**
 * Lesson export (ADR-0006): assembles everything the student produced in a
 * session — transcript, board contents, quiz results, flashcards, XP — into
 * one structured report for download / printing.
 */
import { chalkKindSchema, type LessonExport } from "@local-live-tutor/shared";

import { Errors } from "../../errors.js";
import type { AppDeps } from "../../routes/index.js";

export async function buildLessonExport(
  deps: AppDeps,
  sessionId: string,
): Promise<LessonExport> {
  const session = deps.sessions.getById(sessionId);
  if (!session) throw Errors.notFound("Session");

  const messages = deps.messages.listBySession(sessionId);
  const ops = deps.ops.listBySession(sessionId);
  const quizzes = deps.quiz.listBySession(sessionId);

  const flashcards = new Map<string, string>();
  for (const message of messages) {
    for (const card of message.flashcards ?? []) {
      flashcards.set(card.front, card.back);
    }
  }

  const boardLines = ops
    .filter((op) => op.type === "write" || op.type === "draw_equation")
    .map((op) => String(op.payload.text ?? op.payload.latex ?? ""))
    .filter((line) => line.trim().length > 0);
  // Chalk log: every board op in order, so the export shows HOW the lesson
  // unfolded (writes, highlights, arrows) — not just the final board. Kind
  // (question/fact/answer/explanation) rides along for color coding.
  const chalkLog = ops.map((op) => ({
    actor: op.actor,
    type: op.type,
    text: String(op.payload.text ?? op.payload.label ?? op.payload.latex ?? "").trim(),
    kind: chalkKindSchema.safeParse(op.payload.kind).data,
  }));

  const title =
    session.title ??
    session.extractedProblem?.slice(0, 80) ??
    `Lesson ${session.createdAt.slice(0, 10)}`;

  // Cumulative stats (ADR-0007) — the export reflects the whole journey.
  const hintsTaken = messages.filter(
    (m) => m.role === "student" && /\bhint\b/i.test(m.content),
  ).length;
  const stats = deps.studyStats.get();

  return {
    session,
    title,
    problem: session.extractedProblem ?? null,
    transcript: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "student" | "tutor",
        content: m.content,
        responseType: m.responseType,
        createdAt: m.createdAt,
      })),
    boardLines,
    chalkLog,
    quizResults: quizzes.map((q) => ({
      question: q.question,
      correct: q.correct,
      feedback: q.feedback ?? "",
    })),
    flashcards: [...flashcards.entries()].map(([front, back]) => ({
      front,
      back,
      mastered: stats.masteredFlashcards.includes(front),
    })),
    xp: session.xp,
    quizScore: session.quizScore,
    stats,
    hintsTaken,
  };
}
