/**
 * Unit tests for the StudyStatsRepo (ADR-0007): streak logic, badge
 * unlocking, and flashcard mastery. Uses a real temp-file SQLite database.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createDb } from "../../src/db/client.js";
import { StudyStatsRepo } from "../../src/db/repos/studyStats.js";

const dir = mkdtempSync(join(tmpdir(), "llt-stats-"));
const db = createDb(join(dir, "test.db"));
const repo = new StudyStatsRepo(db);

afterAll(() => {
  // Windows keeps the SQLite file locked; force:true tolerates a failed rm.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Temp dir cleanup is best-effort in CI/Windows.
  }
});

describe("StudyStatsRepo", () => {
  it("starts empty", () => {
    const s = repo.get();
    expect(s.answerStreak).toBe(0);
    expect(s.badges).toEqual([]);
    expect(s.masteredFlashcards).toEqual([]);
  });

  it("awards first_correct on the first correct answer", () => {
    const { stats, newBadges } = repo.recordAnswer(true, 10);
    expect(stats.totalCorrect).toBe(1);
    expect(stats.answerStreak).toBe(1);
    expect(stats.totalXp).toBe(10);
    expect(newBadges).toContain("first_correct");
    expect(stats.dailyStreak).toBe(1);
  });

  it("extends answer streak across correct answers and unlocks streak badges", () => {
    // Same-day correct answers extend the answer streak but keep the daily
    // streak at 1 (one study day).
    const second = repo.recordAnswer(true, 10);
    expect(second.stats.answerStreak).toBe(2);
    expect(second.newBadges).not.toContain("streak_3");

    const third = repo.recordAnswer(true, 10);
    expect(third.stats.answerStreak).toBe(3);
    expect(third.newBadges).toContain("streak_3");
    expect(third.stats.dailyStreak).toBe(1);
  });

  it("resets the answer streak on a wrong answer", () => {
    const wrong = repo.recordAnswer(false, 2);
    expect(wrong.stats.answerStreak).toBe(0);
    expect(wrong.stats.totalXp).toBe(32); // 10+10+10 correct + 2 participation
    expect(wrong.stats.bestAnswerStreak).toBe(3);
  });

  it("is idempotent for mastered flashcards and unlocks cards_10", () => {
    const fronts = Array.from({ length: 10 }, (_, i) => `Card ${i + 1}`);
    const first = repo.markMastered(fronts.slice(0, 5));
    expect(first.stats.masteredFlashcards).toHaveLength(5);
    const second = repo.markMastered(fronts.slice(5));
    expect(second.stats.masteredFlashcards).toHaveLength(10);
    expect(second.newBadges).toContain("cards_10");
    // Re-marking must not duplicate or re-unlock.
    const again = repo.markMastered(fronts);
    expect(again.stats.masteredFlashcards).toHaveLength(10);
    expect(again.newBadges).not.toContain("cards_10");
  });

  it("tracks total XP via recordXp and unlocks xp_100 at 100", () => {
    const repo2 = new StudyStatsRepo(createDb(join(dir, "xp.db")));
    repo2.recordXp(90);
    const { stats, newBadges } = repo2.recordXp(10);
    expect(stats.totalXp).toBe(100);
    expect(newBadges).toContain("xp_100");
  });
});
