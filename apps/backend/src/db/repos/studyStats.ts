/**
 * Study stats repository (ADR-0007 gamification). Stores cumulative stats in
 * the app_settings KV store under a dedicated key — no schema migration
 * needed. Owns all award logic: daily streaks (local calendar days), answer
 * streaks, badge unlocking, and flashcard mastery.
 */
import { eq } from "drizzle-orm";
import type { BadgeId, StudyStats } from "@local-live-tutor/shared";

import type { Db } from "../client.js";
import { appSettings as settingsTable } from "../schema.js";

const STATS_KEY = "study-stats";

const EMPTY: StudyStats = {
  dailyStreak: 0,
  bestDailyStreak: 0,
  answerStreak: 0,
  bestAnswerStreak: 0,
  totalCorrect: 0,
  totalXp: 0,
  badges: [],
  masteredFlashcards: [],
};

/** Local calendar day of a timestamp (student-local, server clock). */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function today(): string {
  return dayOf(new Date().toISOString());
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

export class StudyStatsRepo {
  constructor(private readonly db: Db) {}

  get(): StudyStats {
    const row = this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, STATS_KEY))
      .get();
    if (!row) return { ...EMPTY };
    return normalize(row.value as Partial<StudyStats>);
  }

  private set(stats: StudyStats): StudyStats {
    const next = { ...stats, updatedAt: new Date().toISOString() };
    this.db
      .insert(settingsTable)
      .values({ key: STATS_KEY, value: next })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: next } })
      .run();
    return next;
  }

  /**
   * Record a graded quiz answer. Returns the updated stats plus any badges
   * newly unlocked by this event.
   */
  recordAnswer(correct: boolean, xpAwarded: number): { stats: StudyStats; newBadges: BadgeId[] } {
    const s = this.get();
    const now = today();

    // Daily streak: correct answers extend/carve it; wrong answers reset it.
    if (correct) {
      const gap = s.lastStudyDate ? daysBetween(s.lastStudyDate, now) : Number.NaN;
      if (s.lastStudyDate === undefined) s.dailyStreak = 1;
      else if (gap === 1) s.dailyStreak += 1;
      else if (gap === 0) s.dailyStreak = Math.max(1, s.dailyStreak);
      else s.dailyStreak = 1;
      s.lastStudyDate = now;
      s.answerStreak += 1;
      s.bestAnswerStreak = Math.max(s.bestAnswerStreak, s.answerStreak);
      s.bestDailyStreak = Math.max(s.bestDailyStreak, s.dailyStreak);
    } else {
      s.answerStreak = 0;
    }
    if (correct) s.totalCorrect += 1;
    s.totalXp += Math.max(0, xpAwarded);

    const before = new Set(s.badges);
    const unlocked: BadgeId[] = [];
    const unlock = (id: BadgeId) => {
      if (!before.has(id)) {
        s.badges.push(id);
        unlocked.push(id);
      }
    };
    if (s.totalCorrect >= 1) unlock("first_correct");
    if (s.answerStreak >= 3) unlock("streak_3");
    if (s.answerStreak >= 5) unlock("streak_5");
    if (s.totalCorrect >= 5) unlock("quiz_5");
    if (s.totalXp >= 100) unlock("xp_100");
    if (s.masteredFlashcards.length >= 10) unlock("cards_10");

    return { stats: this.set(s), newBadges: unlocked };
  }

  /** Record a completed flashcard deck review (participation XP). */
  recordXp(xp: number): { stats: StudyStats; newBadges: BadgeId[] } {
    const s = this.get();
    s.totalXp += Math.max(0, xp);
    const before = new Set(s.badges);
    const unlocked: BadgeId[] = [];
    if (s.totalXp >= 100 && !before.has("xp_100")) {
      s.badges.push("xp_100");
      unlocked.push("xp_100");
    }
    return { stats: this.set(s), newBadges: unlocked };
  }

  /** Mark flashcards mastered by their front text. Idempotent. */
  markMastered(fronts: string[]): { stats: StudyStats; newBadges: BadgeId[] } {
    if (fronts.length === 0) return { stats: this.get(), newBadges: [] };
    const s = this.get();
    const known = new Set(s.masteredFlashcards);
    for (const front of fronts) {
      if (front.trim()) known.add(front.trim());
    }
    s.masteredFlashcards = [...known];
    const before = new Set(s.badges);
    const unlocked: BadgeId[] = [];
    if (s.masteredFlashcards.length >= 10 && !before.has("cards_10")) {
      s.badges.push("cards_10");
      unlocked.push("cards_10");
    }
    return { stats: this.set(s), newBadges: unlocked };
  }
}

function normalize(raw: Partial<StudyStats> | null | undefined): StudyStats {
  return {
    ...EMPTY,
    ...raw,
    badges: Array.isArray(raw?.badges) ? raw.badges : [],
    masteredFlashcards: Array.isArray(raw?.masteredFlashcards) ? raw.masteredFlashcards : [],
  };
}
