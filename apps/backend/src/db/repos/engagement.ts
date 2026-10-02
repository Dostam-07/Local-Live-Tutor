/**
 * Engagement events repository (parent view: quiet/resume patterns per
 * subject). Records each inactivity-nudge cycle — when the tutor checked in,
 * how long the student had been quiet, which escalation rung it reached, and
 * when/how the student came back — so the parent view can show real
 * engagement patterns instead of guesses. All local, all family-owned.
 */
import { and, desc, gte, sql } from "drizzle-orm";
import type {
  EngagementEvent,
  EngagementEventInput,
  EngagementSummary,
} from "@local-live-tutor/shared";

import type { Db } from "../client.js";
import { engagementEvents as eventsTable } from "../schema.js";

type EventRow = typeof eventsTable.$inferSelect;

function rowToEvent(row: EventRow): EngagementEvent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    profileId: row.profileId ?? undefined,
    subject: row.subject ?? undefined,
    kind: row.kind === "resumed" ? "resumed" : "nudge_fired",
    rung: row.rung ?? undefined,
    quietSeconds: row.quietSeconds ?? undefined,
    resumedVia: row.resumedVia ?? undefined,
    createdAt: row.createdAt,
  };
}

export class EngagementRepo {
  constructor(private readonly db: Db) {}

  record(input: EngagementEventInput): EngagementEvent {
    const now = new Date().toISOString();
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `eng-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const row = {
      id,
      sessionId: input.sessionId,
      profileId: input.profileId ?? null,
      subject: input.subject ?? null,
      kind: input.kind,
      rung: input.rung ?? null,
      quietSeconds:
        typeof input.quietSeconds === "number" && Number.isFinite(input.quietSeconds)
          ? Math.max(0, Math.min(86_400, Math.round(input.quietSeconds)))
          : null,
      resumedVia: input.resumedVia ?? null,
      createdAt: now,
    };
    this.db.insert(eventsTable).values(row).run();
    return rowToEvent({ ...row, profileId: row.profileId, subject: row.subject } as EventRow);
  }

  /** Raw events for the window, newest first (parent view drill-down). */
  list(sinceIso: string, profileId?: string): EngagementEvent[] {
    const filters = [gte(eventsTable.createdAt, sinceIso)];
    if (profileId) filters.push(sql`${eventsTable.profileId} = ${profileId}`);
    const rows = this.db
      .select()
      .from(eventsTable)
      .where(and(...filters))
      .orderBy(desc(eventsTable.createdAt))
      .limit(2000)
      .all();
    return rows.map(rowToEvent);
  }

  /**
   * Aggregated engagement patterns for the parent view: quiet spells, resume
   * behavior, and per-subject breakdown — honest numbers only (a subject with
   * no events simply doesn't appear).
   */
  summarize(sinceIso: string, profileId?: string): EngagementSummary {
    const events = this.list(sinceIso, profileId);
    const nudges = events.filter((e) => e.kind === "nudge_fired");
    const resumes = events.filter((e) => e.kind === "resumed");

    const quietSeconds = nudges
      .map((e) => e.quietSeconds ?? 0)
      .filter((s) => s > 0);
    const avgQuietSeconds =
      quietSeconds.length > 0
        ? Math.round(quietSeconds.reduce((a, b) => a + b, 0) / quietSeconds.length)
        : 0;
    const longestQuietSeconds = quietSeconds.length > 0 ? Math.max(...quietSeconds) : 0;

    const resumeGaps = resumes.map((e) => e.quietSeconds ?? 0).filter((s) => s > 0);
    const avgResumeSeconds =
      resumeGaps.length > 0
        ? Math.round(resumeGaps.reduce((a, b) => a + b, 0) / resumeGaps.length)
        : 0;

    const subjectMap = new Map<
      string,
      { subject: string; quietSpells: number; avgQuietSeconds: number; resumes: number; deepestRung: number }
    >();
    for (const event of nudges) {
      const subject = event.subject ?? "other";
      const entry = subjectMap.get(subject) ?? {
        subject,
        quietSpells: 0,
        avgQuietSeconds: 0,
        resumes: 0,
        deepestRung: 0,
      };
      entry.quietSpells += 1;
      entry.avgQuietSeconds += event.quietSeconds ?? 0;
      entry.deepestRung = Math.max(entry.deepestRung, event.rung ?? 1);
      subjectMap.set(subject, entry);
    }
    for (const event of resumes) {
      const subject = event.subject ?? "other";
      const entry = subjectMap.get(subject) ?? {
        subject,
        quietSpells: 0,
        avgQuietSeconds: 0,
        resumes: 0,
        deepestRung: 0,
      };
      entry.resumes += 1;
      subjectMap.set(subject, entry);
    }
    const perSubject = Array.from(subjectMap.values())
      .map((s) => ({
        ...s,
        avgQuietSeconds: s.quietSpells > 0 ? Math.round(s.avgQuietSeconds / s.quietSpells) : 0,
      }))
      .sort((a, b) => b.quietSpells - a.quietSpells);

    // Recent quiet spells for the drill-down list (nudges with context).
    const recentQuietSpells = nudges.slice(0, 20).map((e) => ({
      sessionId: e.sessionId,
      subject: e.subject,
      rung: e.rung ?? 1,
      quietSeconds: e.quietSeconds ?? 0,
      resumed: resumes.some((r) => r.sessionId === e.sessionId && r.createdAt >= e.createdAt),
      at: e.createdAt,
    }));

    return {
      quietSpells: nudges.length,
      avgQuietSeconds,
      longestQuietSeconds,
      resumes: resumes.length,
      avgResumeSeconds,
      perSubject,
      recentQuietSpells,
    };
  }
}
