/**
 * Session + message repositories (PRD §7 Session/Message, §11 sessions API).
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type {
  CreateSessionInput,
  Message,
  Session,
  UpdateSessionInput,
} from "@local-live-tutor/shared";

import type { Db } from "../client.js";
import {
  messages as messagesTable,
  sessions as sessionsTable,
} from "../schema.js";
import { autoCompleteIdleSessions, sweepAbandonedSessions } from "../../services/maintenance.js";

type SessionRow = typeof sessionsTable.$inferSelect;
type MessageRow = typeof messagesTable.$inferSelect;

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title ?? undefined,
    subject: row.subject as Session["subject"],
    gradeLevel: (row.gradeLevel ?? undefined) as Session["gradeLevel"],
    mode: row.mode as Session["mode"],
    helpLevel: row.helpLevel as Session["helpLevel"],
    originalImagePath: row.originalImagePath ?? undefined,
    extractedProblem: row.extractedProblem ?? undefined,
    currentGoal: row.currentGoal ?? undefined,
    status: row.status as Session["status"],
    provider: row.provider,
    model: row.model,
    xp: row.xp ?? 0,
    quizScore: [row.quizCorrect ?? 0, row.quizAsked ?? 0],
    persona: (row.persona ?? undefined) as Session["persona"],
    voice: (row.voice ?? undefined) as Session["voice"],
    language: (row.language ?? undefined) as Session["language"],
    profileId: row.profileId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as Message["role"],
    content: row.content,
    inputType: (row.inputType ?? undefined) as Message["inputType"],
    responseType: (row.responseType ?? undefined) as Message["responseType"],
    hintLevel: row.hintLevel ?? undefined,
    answerRevealed: row.answerRevealed ?? undefined,
    xpAwarded: row.xpAwarded ?? undefined,
    quizGrading: (row.quizGrading ?? undefined) as Message["quizGrading"],
    flashcards: (row.flashcards ?? undefined) as Message["flashcards"],
    quiz: (row.quiz ?? undefined) as Message["quiz"],
    isGreeting: row.isGreeting ?? undefined,
    subject: (row.subject ?? undefined) as Message["subject"],
    createdAt: row.createdAt,
  };
}

export class SessionRepo {
  constructor(private readonly db: Db) {}

  create(
    input: CreateSessionInput & {
      provider: string;
      model: string;
      /** Per-session persona & voice memory (roadmap). */
      persona?: Session["persona"];
      voice?: Session["voice"];
      language?: Session["language"];
      /** Owning student profile (roadmap). */
      profileId?: string;
    },
  ): Session {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const row = {
      id,
      title: input.title ?? null,
      subject: input.subject,
      gradeLevel: input.gradeLevel ?? null,
      mode: input.mode,
      helpLevel: input.helpLevel,
      status: "active" as const,
      xp: 0,
      quizCorrect: 0,
      quizAsked: 0,
      persona: input.persona ?? null,
      voice: input.voice ?? null,
      language: input.language ?? null,
      profileId: input.profileId ?? null,
      provider: input.provider,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(sessionsTable).values(row).run();
    return rowToSession(row as unknown as SessionRow);
  }

  getById(id: string): Session | undefined {
    const row = this.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .get();
    return row ? rowToSession(row) : undefined;
  }

  list(limit = 100, profileId?: string): Session[] {
    const base = this.db.select().from(sessionsTable);
    const rows = (
      profileId ? base.where(eq(sessionsTable.profileId, profileId)) : base
    )
      .orderBy(desc(sessionsTable.updatedAt))
      .limit(limit)
      .all();
    return rows.map(rowToSession);
  }

  update(id: string, patch: UpdateSessionInput): Session | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    const next: SessionRow = {
      ...existing,
      title: patch.title !== undefined ? patch.title : (existing.title ?? null),
      extractedProblem:
        patch.extractedProblem !== undefined
          ? patch.extractedProblem
          : (existing.extractedProblem ?? null),
      originalImagePath:
        patch.originalImagePath !== undefined
          ? patch.originalImagePath
          : (existing.originalImagePath ?? null),
      currentGoal:
        patch.currentGoal !== undefined
          ? patch.currentGoal
          : (existing.currentGoal ?? null),
      status: patch.status ?? existing.status,
      helpLevel: patch.helpLevel ?? existing.helpLevel,
      mode: patch.mode ?? existing.mode,
      subject: patch.subject ?? existing.subject,
      gradeLevel: patch.gradeLevel !== undefined ? patch.gradeLevel : (existing.gradeLevel ?? null),
      persona: (patch as UpdateSessionInput).persona ?? (existing.persona ?? null),
      voice: (patch as UpdateSessionInput).voice ?? (existing.voice ?? null),
      language: (patch as UpdateSessionInput).language ?? (existing.language ?? null),
      xp: existing.xp + ((patch as UpdateSessionInput & { xpAward?: number }).xpAward ?? 0),
      quizCorrect: (patch as UpdateSessionInput & { quizCorrectDelta?: number }).quizCorrectDelta !== undefined
        ? existing.quizScore[0] + (patch as UpdateSessionInput & { quizCorrectDelta?: number }).quizCorrectDelta!
        : existing.quizScore[0],
      quizAsked: (patch as UpdateSessionInput & { quizAskedDelta?: number }).quizAskedDelta !== undefined
        ? existing.quizScore[1] + (patch as UpdateSessionInput & { quizAskedDelta?: number }).quizAskedDelta!
        : existing.quizScore[1],
      provider: existing.provider,
      model: existing.model,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    } as unknown as SessionRow;
    this.db
      .update(sessionsTable)
      .set({
        title: next.title,
        extractedProblem: next.extractedProblem,
        currentGoal: next.currentGoal,
        originalImagePath: next.originalImagePath,
        status: next.status,
        helpLevel: next.helpLevel,
        mode: next.mode,
        subject: next.subject,
        gradeLevel: next.gradeLevel,
        persona: next.persona,
        voice: next.voice,
        language: next.language,
        xp: next.xp,
        quizCorrect: next.quizCorrect,
        quizAsked: next.quizAsked,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionsTable.id, id))
      .run();
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db
      .delete(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .run();
    return result.changes > 0;
  }

  deleteAll(): number {
    return this.db.delete(sessionsTable).run().changes;
  }

  /**
   * Abandoned-session sweep (user spec). See services/maintenance.ts for the
   * precise rules; the repo exposes it so routes can sweep without reaching
   * into another service module.
   */
  sweepAbandoned(graceMs: number): number {
    return sweepAbandonedSessions(this.db, graceMs);
  }

  /** Idle auto-save (user spec): close lessons silent past the window. */
  autoCompleteIdle(idleMs: number): number {
    return autoCompleteIdleSessions(this.db, idleMs);
  }
}

export class MessageRepo {
  constructor(private readonly db: Db) {}

  create(
    input: Omit<Message, "createdAt"> & { createdAt?: string },
  ): Message {
    const row = {
      id: input.id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      inputType: input.inputType ?? null,
      responseType: input.responseType ?? null,
      hintLevel: input.hintLevel ?? null,
      answerRevealed: input.answerRevealed ?? null,
      xpAwarded: input.xpAwarded ?? null,
      quizGrading: input.quizGrading ?? null,
      flashcards: input.flashcards ?? null,
      quiz: input.quiz ?? null,
      isGreeting: input.isGreeting ?? null,
      subject: input.subject ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db.insert(messagesTable).values(row).run();
    return rowToMessage(row as unknown as MessageRow);
  }

  listBySession(sessionId: string, limit = 500): Message[] {
    const rows = this.db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.sessionId, sessionId))
      .orderBy(asc(messagesTable.createdAt))
      .limit(limit)
      .all();
    return rows.map(rowToMessage);
  }

  countBySession(sessionId: string): number {
    return this.db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.sessionId, sessionId))
      .all().length;
  }

  lastTutorMessage(sessionId: string): Message | undefined {
    const rows = this.db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.sessionId, sessionId),
          eq(messagesTable.role, "tutor"),
        ),
      )
      .orderBy(desc(messagesTable.createdAt))
      .limit(1)
      .all();
    const row = rows[0];
    return row ? rowToMessage(row) : undefined;
  }
}
