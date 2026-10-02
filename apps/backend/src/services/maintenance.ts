/**
 * Maintenance helpers — background hygiene that keeps user-facing state clean
 * without a background timer (ADR-0005 conversational entry).
 *
 * Abandoned-session sweep (user spec): a session that never received a tutor
 * turn AND carries nothing the student created (no extracted material, no
 * chalk, no quiz marks) is litter from the welcome-board entry flow. Such
 * sessions are removed — together with their child rows — once they age past
 * a grace period. Anything the student touched survives forever; any session
 * with a tutor turn is by definition a real lesson and is never swept.
 */
import type { Db } from "../db/client.js";
import {
  messages as messagesTable,
  quizResults as quizTable,
  sessions as sessionsTable,
  whiteboardOps as opsTable,
} from "../db/schema.js";
import { and, eq, inArray, isNull, lt, notExists, sql } from "drizzle-orm";

/**
 * Idle auto-save (user spec): a real lesson (has a tutor turn) whose last
 * activity is older than the idle window is gently CLOSED, not deleted —
 * marked "completed" with a friendly "· paused" title so the History tab
 * stays tidy and the student always finds a clean ending. Nothing is lost:
 * every message, chalk line, and quiz mark stays exactly as it was, and
 * reopening the lesson still shows the full board — including the friendly
 * "paused — saved" chalk note written at close time.
 *
 * Runs on boot and lazily before History listings (same no-timer pattern as
 * the abandoned sweep). graceMs ≤ 0 disables it.
 */
export function autoCompleteIdleSessions(db: Db, idleMs: number): number {
  if (idleMs <= 0) return 0;
  const cutoff = new Date(Date.now() - idleMs).toISOString();
  return db.transaction(() => {
    const idle = db
      .select({ id: sessionsTable.id, title: sessionsTable.title })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.status, "active"),
          lt(sessionsTable.updatedAt, cutoff),
          // A real lesson only: at least one tutor turn.
          sql`EXISTS (SELECT 1 FROM ${messagesTable} WHERE ${messagesTable.sessionId} = ${sessionsTable.id} AND ${messagesTable.role} = 'tutor')`,
        ),
      )
      .all();
    if (idle.length === 0) return 0;
    for (const row of idle) {
      // Friendly title suffix (once — idempotent across repeated sweeps).
      const title = row.title && !row.title.includes("· paused") ? `${row.title} · paused` : (row.title ?? "Lesson · paused");
      db.update(sessionsTable)
        .set({ status: "completed", title })
        .where(eq(sessionsTable.id, row.id))
        .run();
      // Friendly board note (user spec): chalk a gentle "paused — saved" line
      // so reopening the lesson reads as a clean pause, not an interruption.
      // Same valid write-op payload the renderer expects; flows below the
      // last chalk line. Idempotent: this branch only runs for `active`
      // sessions, and the update above just marked it completed.
      const now = new Date().toISOString();
      const seqRows = db
        .select({ seq: opsTable.seq })
        .from(opsTable)
        .where(eq(opsTable.sessionId, row.id))
        .all();
      const nextSeq = seqRows.length > 0 ? Math.max(...seqRows.map((r) => r.seq)) + 1 : 1;
      db.insert(opsTable)
        .values({
          id: crypto.randomUUID(),
          sessionId: row.id,
          messageId: null,
          actor: "tutor",
          type: "write",
          payload: {
            x: 0,
            y: 0,
            text: "⏸ We paused here — your board is saved. Come back anytime and we'll pick up right where we left off.",
            color: "#FBD870",
            kind: "explanation",
          },
          seq: nextSeq,
          createdAt: now,
        })
        .run();
    }
    return idle.length;
  });
}

export function sweepAbandonedSessions(db: Db, graceMs: number): number {
  if (graceMs <= 0) return 0;
  const cutoff = new Date(Date.now() - graceMs).toISOString();
  return db.transaction(() => {
    const doomed = db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          lt(sessionsTable.createdAt, cutoff),
          notExists(
            db
              .select({ one: sql`1` })
              .from(messagesTable)
              .where(
                and(
                  eq(messagesTable.sessionId, sessionsTable.id),
                  eq(messagesTable.role, "tutor"),
                ),
              ),
          ),
          isNull(sessionsTable.extractedProblem),
          notExists(
            db
              .select({ one: sql`1` })
              .from(opsTable)
              .where(eq(opsTable.sessionId, sessionsTable.id)),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(quizTable)
              .where(eq(quizTable.sessionId, sessionsTable.id)),
          ),
        ),
      )
      .all();
    const ids = doomed.map((row) => row.id);
    if (ids.length === 0) return 0;
    db.delete(messagesTable).where(inArray(messagesTable.sessionId, ids)).run();
    db.delete(opsTable).where(inArray(opsTable.sessionId, ids)).run();
    db.delete(quizTable).where(inArray(quizTable.sessionId, ids)).run();
    db.delete(sessionsTable).where(inArray(sessionsTable.id, ids)).run();
    return ids.length;
  });
}
