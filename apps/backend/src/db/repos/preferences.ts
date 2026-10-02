/**
 * Student Tutoring Profile repository (self-improving personalization).
 *
 * Stores long-term teaching preferences per profile; the core tutor stays
 * stable — only this layer evolves (spec §10). Dedupe is normalized-text
 * based so re-saying a preference never duplicates it; near-matches (same
 * category, high word overlap) REPLACE the older line so conflicting
 * preferences don't pile up (spec §5).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { TutorPreference } from "@local-live-tutor/shared";

import type { Db } from "../client.js";
import { behaviorPatterns, tutorPreferences } from "../schema.js";

type PrefRow = typeof tutorPreferences.$inferSelect;
type PatternRow = typeof behaviorPatterns.$inferSelect;

/** Words too generic to count toward preference overlap. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "me",
  "my", "i", "you", "your", "it", "is", "are", "be", "when", "that", "this",
  "prefer", "please", "always", "never", "dont", "do", "not", "use", "give",
  "explain", "keep", "make", "should", "would", "like", "want",
]);

function rowToPref(row: PrefRow): TutorPreference {
  return {
    id: row.id,
    text: row.text,
    category: row.category as TutorPreference["category"],
    source: row.source as TutorPreference["source"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Normalized form used for exact dedupe. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content words of a preference, for similarity. */
function contentWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/** Jaccard overlap of two preferences' content words. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export class PreferencesRepo {
  constructor(private readonly db: Db) {}

  list(profileId?: string): TutorPreference[] {
    const rows = (
      profileId
        ? this.db
            .select()
            .from(tutorPreferences)
            .where(eq(tutorPreferences.profileId, profileId))
        : this.db.select().from(tutorPreferences).where(isNull(tutorPreferences.profileId))
    )
      .all();
    return rows.map(rowToPref).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Adds a preference, deduping against existing ones: an exact (normalized)
   * match is a no-op; ≥0.55 word overlap in the same category REPLACES the
   * older line (latest preference wins, spec §5). Returns the stored
   * preference plus how many older ones it replaced.
   */
  add(input: {
    profileId?: string;
    text: string;
    category: TutorPreference["category"];
    source: TutorPreference["source"];
  }): { preference: TutorPreference; replacedCount: number } {
    const now = new Date().toISOString();
    const existing = this.list(input.profileId);
    const norm = normalize(input.text);
    if (existing.some((p) => normalize(p.text) === norm)) {
      const match = existing.find((p) => normalize(p.text) === norm)!;
      return { preference: match, replacedCount: 0 };
    }
    const words = contentWords(input.text);
    const similar = existing.filter(
      (p) => p.category === input.category && overlap(words, contentWords(p.text)) >= 0.55,
    );
    const replacedCount = similar.length;
    const pref = {
      id: crypto.randomUUID(),
      profileId: input.profileId ?? null,
      text: input.text.trim(),
      category: input.category,
      source: input.source,
      createdAt: now,
      updatedAt: now,
    };
    this.db.transaction(() => {
      this.db.insert(tutorPreferences).values(pref).run();
      for (const dup of similar) {
        this.db.delete(tutorPreferences).where(eq(tutorPreferences.id, dup.id)).run();
      }
    });
    return { preference: rowToPref(pref as unknown as PrefRow), replacedCount };
  }

  update(id: string, text: string): TutorPreference | undefined {
    const row = this.db
      .select()
      .from(tutorPreferences)
      .where(eq(tutorPreferences.id, id))
      .get();
    if (!row) return undefined;
    this.db
      .update(tutorPreferences)
      .set({ text: text.trim(), updatedAt: new Date().toISOString() })
      .where(eq(tutorPreferences.id, id))
      .run();
    return this.db
      .select()
      .from(tutorPreferences)
      .where(eq(tutorPreferences.id, id))
      .get() satisfies PrefRow | undefined as TutorPreference | undefined ?? undefined as unknown as TutorPreference | undefined;
  }

  remove(id: string): boolean {
    return this.db.delete(tutorPreferences).where(eq(tutorPreferences.id, id)).run().changes > 0;
  }

  /** Turns personalization off completely (spec §7): wipe the profile. */
  reset(profileId?: string): number {
    const rows = this.list(profileId);
    for (const row of rows) {
      this.db.delete(tutorPreferences).where(eq(tutorPreferences.id, row.id)).run();
    }
    return rows.length;
  }

  // ---------- Repeated-behavior patterns (spec §8) ----------

  private patternKey(profileId: string | undefined, kind: string): string {
    return `${profileId ?? "shared"}::${kind}`;
  }

  /** Bumps a pattern counter; returns the current count. */
  bumpPattern(profileId: string | undefined, kind: string): number {
    const id = this.patternKey(profileId, kind);
    const row = this.db
      .select()
      .from(behaviorPatterns)
      .where(eq(behaviorPatterns.id, id))
      .get() as PatternRow | undefined;
    const now = new Date().toISOString();
    if (row) {
      this.db
        .update(behaviorPatterns)
        .set({ count: row.count + 1, lastSeenAt: now })
        .where(eq(behaviorPatterns.id, id))
        .run();
      return row.count + 1;
    }
    this.db
      .insert(behaviorPatterns)
      .values({
        id,
        profileId: profileId ?? null,
        kind,
        count: 1,
        lastSeenAt: now,
      })
      .run();
    return 1;
  }

  listPatterns(profileId?: string): Array<{ kind: string; count: number }> {
    const rows = (
      profileId
        ? this.db
            .select()
            .from(behaviorPatterns)
            .where(eq(behaviorPatterns.profileId, profileId))
        : this.db.select().from(behaviorPatterns).where(isNull(behaviorPatterns.profileId))
    ).all() as PatternRow[];
    return rows
      .map((r) => ({ kind: r.kind, count: r.count }))
      .sort((a, b) => b.count - a.count);
  }

  /** One-tap confirm: promote a pattern into a real preference. */
  confirmPattern(
    profileId: string | undefined,
    kind: string,
    text: string,
    category: TutorPreference["category"],
  ): TutorPreference {
    this.db
      .delete(behaviorPatterns)
      .where(eq(behaviorPatterns.id, this.patternKey(profileId, kind)))
      .run();
    return this.add({ profileId, text, category, source: "pattern" }).preference;
  }

  search(kind: string, profileId?: string): boolean {
    const row = this.db
      .select()
      .from(behaviorPatterns)
      .where(
        and(
          eq(behaviorPatterns.id, this.patternKey(profileId, kind)),
        ),
      )
      .get();
    return Boolean(row);
  }
}
