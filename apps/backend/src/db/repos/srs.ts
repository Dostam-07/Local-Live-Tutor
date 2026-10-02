/**
 * Spaced-repetition repository (roadmap: SRS flashcard review). Stores each
 * profile's card schedules in the app_settings KV store (same pattern as
 * stats/profiles — no new table needed). Cards are identified by their front
 * text; every flashcard the tutor generates is upserted here, and reviews
 * (quiz answers in a warm-up or the flashcard modal) move the next-due date.
 *
 * SM-2-inspired scheduling: correct review → interval grows (1d, 6d, ×ef);
   wrong review → card resets to learning. The easiness factor adapts.
 */
import { eq } from "drizzle-orm";
import type { SrsCard } from "@local-live-tutor/shared";

import type { Db } from "../client.js";
import { appSettings as settingsTable } from "../schema.js";

const DAY_MS = 86_400_000;
/** Solo mode (no profiles) shares one schedule under this key suffix. */
const SOLO = "solo";

type StoredCard = SrsCard & { back: string };

function keyFor(profileId: string | null | undefined): string {
  return `srs-cards-${profileId || SOLO}`;
}

function normalize(raw: unknown): StoredCard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      front: String(c.front ?? ""),
      back: String(c.back ?? ""),
      reps: typeof c.reps === "number" && Number.isFinite(c.reps) ? Math.max(0, Math.floor(c.reps)) : 0,
      ef: typeof c.ef === "number" && c.ef >= 1.3 && c.ef <= 2.5 ? c.ef : 2.5,
      intervalDays:
        typeof c.intervalDays === "number" && Number.isFinite(c.intervalDays)
          ? Math.max(0, Math.floor(c.intervalDays))
          : 0,
      dueAt: typeof c.dueAt === "string" ? c.dueAt : new Date(0).toISOString(),
      lastReviewedAt: typeof c.lastReviewedAt === "string" ? c.lastReviewedAt : undefined,
    }))
    .filter((c) => c.front.length > 0);
}

/** Normalized front for matching model-phrased questions to their card. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u0080-\uffff]+/g, " ").trim();
}

export class SrsRepo {
  constructor(private readonly db: Db) {}

  private read(profileId: string | null | undefined): StoredCard[] {
    const row = this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, keyFor(profileId)))
      .get();
    return normalize(row?.value);
  }

  private write(profileId: string | null | undefined, cards: StoredCard[]): void {
    this.db
      .insert(settingsTable)
      .values({ key: keyFor(profileId), value: cards })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: cards } })
      .run();
  }

  /**
   * Register flashcards generated in a lesson (idempotent by front). New
   * cards start due immediately so the next lesson can warm up on them.
   */
  upsertMany(
    profileId: string | null | undefined,
    cards: Array<{ front: string; back: string }>,
  ): number {
    const usable = cards.filter((c) => c.front.trim() && c.back.trim());
    if (usable.length === 0) return 0;
    const existing = this.read(profileId);
    const byFront = new Map(existing.map((c) => [norm(c.front), c]));
    let added = 0;
    for (const card of usable) {
      const k = norm(card.front);
      if (byFront.has(k)) continue;
      byFront.set(k, {
        front: card.front.trim(),
        back: card.back.trim(),
        reps: 0,
        ef: 2.5,
        intervalDays: 0,
        dueAt: new Date().toISOString(),
      });
      added += 1;
    }
    if (added > 0) this.write(profileId, [...byFront.values()]);
    return added;
  }

  /** Cards due for review (oldest due first). */
  due(
    profileId: string | null | undefined,
    now = new Date().toISOString(),
    limit = 5,
  ): Array<{ front: string; back: string }> {
    const t = Date.parse(now);
    return this.read(profileId)
      .filter((c) => Date.parse(c.dueAt) <= t)
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .slice(0, limit)
      .map(({ front, back }) => ({ front, back }));
  }

  /** How many cards are due right now (for the UI badge). */
  dueCount(profileId: string | null | undefined, now = new Date().toISOString()): number {
    const t = Date.parse(now);
    return this.read(profileId).filter((c) => Date.parse(c.dueAt) <= t).length;
  }

  /**
   * Record a review. grade: 0 = forgot · 1 = hard · 2 = good · 3 = easy.
   * Returns the updated schedule for the card, or undefined when unknown.
   */
  grade(
    profileId: string | null | undefined,
    front: string,
    grade: 0 | 1 | 2 | 3,
    now = new Date(),
  ): SrsCard | undefined {
    const cards = this.read(profileId);
    const k = norm(front);
    const card = cards.find((c) => norm(c.front) === k);
    if (!card) return undefined;

    const at = now.toISOString();
    card.lastReviewedAt = at;
    if (grade === 0) {
      // Forgot: back to learning, due again next lesson start.
      card.reps = 0;
      card.ef = Math.max(1.3, card.ef - 0.2);
      card.intervalDays = 0;
      card.dueAt = new Date(Date.parse(at) + DAY_MS).toISOString();
    } else {
      card.reps += 1;
      if (grade === 1) card.ef = Math.max(1.3, card.ef - 0.15);
      if (grade === 3) card.ef = Math.min(2.5, card.ef + 0.1);
      card.intervalDays =
        card.reps === 1 ? 1 : card.reps === 2 ? 6 : Math.round(card.intervalDays * card.ef);
      card.dueAt = new Date(Date.parse(at) + card.intervalDays * DAY_MS).toISOString();
    }
    this.write(profileId, cards);
    const { back: _back, ...schedule } = card;
    void _back;
    return schedule;
  }

  /**
   * Match a posed quiz question back to its card so a graded warm-up answer
   * moves the schedule. Tolerant: the model usually rephrases slightly, so a
   * containment match on the normalized fronts counts.
   */
  matchFront(
    profileId: string | null | undefined,
    question: string,
  ): { front: string } | undefined {
    const q = norm(question);
    if (!q) return undefined;
    for (const card of this.read(profileId)) {
      const f = norm(card.front);
      if (!f) continue;
      if (f === q || q.includes(f) || (f.length > 8 && f.includes(q))) {
        return { front: card.front };
      }
    }
    return undefined;
  }
}
