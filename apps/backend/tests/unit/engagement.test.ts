/**
 * Engagement repo unit tests (parent view: quiet/resume patterns per
 * subject) — honest aggregation over recorded nudge cycles, on a real
 * in-memory SQLite database. No mocks of the repo itself.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_URL =
  fs.mkdtempSync(path.join(os.tmpdir(), "engagement-test-")) + "/test.sqlite";

const { createDb } = await import("../../src/db/client.js");
const { EngagementRepo } = await import("../../src/db/repos/engagement.js");

const db = createDb(
  (globalThis as unknown as { __engagementDbPath?: string }).__engagementDbPath ??
    process.env.DATABASE_URL!,
);
const repo = new EngagementRepo(db);

const sessionA = "sess-algebra";
const sessionB = "sess-history";

beforeAll(async () => {
  // Session A (math): a 90s quiet spell, nudged at rung 1, resumed by typing.
  repo.record({ sessionId: sessionA, subject: "math", kind: "nudge_fired", rung: 1, quietSeconds: 90 });
  repo.record({ sessionId: sessionA, subject: "math", kind: "resumed", resumedVia: "typed", quietSeconds: 115 });
  // Session A again: went quiet twice in one lesson; second reached rung 3.
  repo.record({ sessionId: sessionA, subject: "math", kind: "nudge_fired", rung: 3, quietSeconds: 400 });
  // Session B (history): one deep quiet spell, never resumed (lesson left open).
  repo.record({ sessionId: sessionB, subject: "history", kind: "nudge_fired", rung: 2, quietSeconds: 240 });
});

describe("EngagementRepo.summarize", () => {
  it("counts quiet spells and computes honest averages", () => {
    const s = repo.summarize(new Date(0).toISOString());
    expect(s.quietSpells).toBe(3);
    // (90 + 400 + 240) / 3 = 243.33… → 243
    expect(s.avgQuietSeconds).toBe(243);
    expect(s.longestQuietSeconds).toBe(400);
  });

  it("aggregates per subject with the deepest rung reached", () => {
    const s = repo.summarize(new Date(0).toISOString());
    const math = s.perSubject.find((x) => x.subject === "math");
    const history = s.perSubject.find((x) => x.subject === "history");
    expect(math?.quietSpells).toBe(2);
    expect(math?.resumes).toBe(1);
    expect(math?.deepestRung).toBe(3);
    expect(history?.quietSpells).toBe(1);
    expect(history?.resumes).toBe(0);
    expect(history?.deepestRung).toBe(2);
  });

  it("matches resumes to their session's quiet spells", () => {
    const s = repo.summarize(new Date(0).toISOString());
    expect(s.resumes).toBe(1);
    expect(s.avgResumeSeconds).toBe(115);
    const mathSpell = s.recentQuietSpells.find((x) => x.subject === "math" && x.rung === 1);
    expect(mathSpell?.resumed).toBe(true);
    const historySpell = s.recentQuietSpells.find((x) => x.subject === "history");
    expect(historySpell?.resumed).toBe(false);
  });

  it("respects the profile filter when given", () => {
    // No profile rows were recorded with profileId; a filter excludes them all.
    const s = repo.summarize(new Date(0).toISOString(), "profile-x");
    expect(s.quietSpells).toBe(0);
    expect(s.perSubject).toEqual([]);
  });

  it("returns a clean empty state for a fresh window (no fake zeros)", () => {
    const s = repo.summarize(new Date(Date.now() + 86_400_000).toISOString());
    expect(s.quietSpells).toBe(0);
    expect(s.avgQuietSeconds).toBe(0);
    expect(s.longestQuietSeconds).toBe(0);
    expect(s.perSubject).toEqual([]);
    expect(s.recentQuietSpells).toEqual([]);
  });

  it("clamps absurd quiet durations instead of storing them", () => {
    const ev = repo.record({
      sessionId: "sess-x",
      kind: "nudge_fired",
      quietSeconds: 999_999,
    });
    expect(ev.quietSeconds).toBeLessThanOrEqual(86_400);
  });
});
