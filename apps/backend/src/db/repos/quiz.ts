/**
 * Quiz result repository (ADR-0006 gamification): per-question outcomes used
 * for the running score and the downloadable lesson report.
 */
import { asc, desc, eq } from "drizzle-orm";

import type { Db } from "../client.js";
import { quizResults as quizTable } from "../schema.js";

export type QuizResult = {
  id: string;
  sessionId: string;
  messageId?: string;
  question: string;
  correct: boolean;
  feedback?: string;
  createdAt: string;
};

export class QuizRepo {
  constructor(private readonly db: Db) {}

  create(input: Omit<QuizResult, "id" | "createdAt">): QuizResult {
    const row = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      question: input.question,
      correct: input.correct,
      feedback: input.feedback ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(quizTable).values(row).run();
    return {
      id: row.id,
      sessionId: row.sessionId,
      messageId: row.messageId ?? undefined,
      question: row.question,
      correct: row.correct,
      feedback: row.feedback ?? undefined,
      createdAt: row.createdAt,
    };
  }

  listBySession(sessionId: string): QuizResult[] {
    return this.db
      .select()
      .from(quizTable)
      .where(eq(quizTable.sessionId, sessionId))
      .orderBy(asc(quizTable.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        messageId: row.messageId ?? undefined,
        question: row.question,
        correct: row.correct,
        feedback: row.feedback ?? undefined,
        createdAt: row.createdAt,
      }));
  }

  /** Attaches the grading tutor message to the most recent unanswered result. */
  linkMessage(messageId: string, sessionId: string, question: string): void {
    const rows = this.db
      .select()
      .from(quizTable)
      .where(eq(quizTable.sessionId, sessionId))
      .orderBy(desc(quizTable.createdAt))
      .limit(1)
      .all();
    const row = rows[0];
    if (row && row.question === question && !row.messageId) {
      this.db.update(quizTable).set({ messageId }).where(eq(quizTable.id, row.id)).run();
    }
  }

  deleteBySession(sessionId: string): number {
    return this.db.delete(quizTable).where(eq(quizTable.sessionId, sessionId)).run().changes;
  }

  /** Most recent quiz outcomes, newest last — the adaptive-persona signal. */
  recentBySession(sessionId: string, limit = 5): QuizResult[] {
    return this.db
      .select()
      .from(quizTable)
      .where(eq(quizTable.sessionId, sessionId))
      .orderBy(desc(quizTable.createdAt))
      .limit(limit)
      .all()
      .reverse()
      .map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        messageId: row.messageId ?? undefined,
        question: row.question,
        correct: row.correct,
        feedback: row.feedback ?? undefined,
        createdAt: row.createdAt,
      }));
  }
}
