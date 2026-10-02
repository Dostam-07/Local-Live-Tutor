/**
 * Unit tests for the personalization building blocks (user spec: the
 * self-improving tutor). Runs the pure logic — the FALLBACK_RULES pipeline,
 * the preference dedupe/replace math, and the pattern threshold — offline
 * and deterministically by exercising the compiled service through a stub
 * registry (no network, no model).
 */
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../src/db/schema.js";

import { FeedbackInterpreter } from "../../src/services/tutoring/feedback.js";
import { PreferencesRepo } from "../../src/db/repos/preferences.js";
import { buildSystemPrompt } from "@local-live-tutor/shared";
import type { LLMProvider } from "../../src/services/llm/types.js";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE tutor_preferences (
      id TEXT PRIMARY KEY, profile_id TEXT, text TEXT NOT NULL,
      category TEXT NOT NULL, source TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE behavior_patterns (
      id TEXT PRIMARY KEY, profile_id TEXT, kind TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("feedback interpreter (deterministic fallback)", () => {
  const interpreter = new FeedbackInterpreter({
    resolve: async () => ({ provider: { chat: async () => { throw new Error("offline"); } } }),
  } as never);

  it("converts 'too quickly' feedback into a long-term pacing preference", async () => {
    const result = await interpreter.interpret(
      "You explain things too quickly. Give me more time to think before telling me the answer.",
    );
    expect(result.scope).toBe("long_term");
    expect(result.preferences.some((p) => /time|think/i.test(p.text))).toBe(true);
  });

  it("converts real-life-example feedback into an examples preference", async () => {
    const result = await interpreter.interpret(
      "I like when you explain maths with simple real-life examples.",
    );
    expect(result.scope).toBe("long_term");
    expect(result.preferences.some((p) => p.category === "examples")).toBe(true);
  });

  it("treats session-only wishes as session scope (spec §3)", async () => {
    const result = await interpreter.interpret(
      "Today I don't want hints because I'm testing myself.",
    );
    expect(result.scope).toBe("session");
  });

  it("resolves ambiguous feedback to session scope with zero preferences", async () => {
    const result = await interpreter.interpret("nice weather today");
    expect(result.scope).toBe("session");
    expect(result.preferences).toHaveLength(0);
  });
});

describe("preferences repo", () => {
  it("dedupes exact repeats and replaces near-duplicates (spec §5)", () => {
    const repo = new PreferencesRepo(makeDb());
    const first = repo.add({
      text: "Prefer concise explanations with simple language",
      category: "explanation",
      source: "feedback",
    });
    expect(first.replacedCount).toBe(0);

    // Same category + overlapping words → replaces.
    const second = repo.add({
      text: "Use concise simple-language explanations, expand only when I ask",
      category: "explanation",
      source: "feedback",
    });
    expect(second.replacedCount).toBe(1);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]!.text).toContain("expand only");

    // A different category coexists.
    repo.add({ text: "Give hints before solutions", category: "problem_solving", source: "feedback" });
    expect(repo.list()).toHaveLength(2);
  });

  it("supports edit, remove, and full reset (spec §7)", () => {
    const repo = new PreferencesRepo(makeDb());
    const a = repo.add({ text: "Use real-world examples", category: "examples", source: "feedback" }).preference;
    repo.add({ text: "Speak slower", category: "pacing", source: "feedback" });

    repo.update(a.id, "Use cricket real-world examples");
    expect(repo.list().find((p) => p.id === a.id)?.text).toContain("cricket");

    expect(repo.remove(a.id)).toBe(true);
    expect(repo.list()).toHaveLength(1);

    expect(repo.reset()).toBe(1);
    expect(repo.list()).toHaveLength(0);
  });

  it("patterns count up, are confirmable once, and never auto-save", () => {
    const repo = new PreferencesRepo(makeDb());
    expect(repo.bumpPattern(undefined, "hints")).toBe(1);
    expect(repo.bumpPattern(undefined, "hints")).toBe(2);
    expect(repo.bumpPattern(undefined, "hints")).toBe(3);
    expect(repo.listPatterns().find((p) => p.kind === "hints")?.count).toBe(3);
    expect(repo.list()).toHaveLength(0); // never auto-saved

    const pref = repo.confirmPattern(undefined, "hints", "Offer hints first", "problem_solving");
    expect(pref.source).toBe("pattern");
    expect(repo.list()).toHaveLength(1);
    expect(repo.listPatterns().find((p) => p.kind === "hints")).toBeUndefined();
  });
});

describe("prompt integration", () => {
  it("injects the personalization block into the system prompt", () => {
    const withPrefs = buildSystemPrompt({
      subject: "math",
      helpLevel: "socratic",
      mode: "homework",
      maxHintLevel: 5,
      studentPreferences: ["Give hints before solutions", "Use real-world examples"],
    });
    expect(withPrefs).toContain("HOW THIS STUDENT LEARNS BEST");
    expect(withPrefs).toContain("- Give hints before solutions");
    expect(withPrefs).toContain("- Use real-world examples");
    // Safety still outranks preferences.
    expect(withPrefs.indexOf("Safety")).toBeLessThan(withPrefs.indexOf("HOW THIS STUDENT LEARNS BEST"));

    // No preferences → no block (brand-new student stays generic).
    const without = buildSystemPrompt({
      subject: "math",
      helpLevel: "socratic",
      mode: "homework",
      maxHintLevel: 5,
    });
    expect(without).not.toContain("HOW THIS STUDENT LEARNS BEST");
  });

  it("LLM path: parses a well-formed interpretation instead of the fallback", async () => {
    const canned = {
      content: JSON.stringify({
        scope: "long_term",
        preferences: [{ text: "Prefer cricket analogies", category: "examples" }],
        confirmation: "I'll use cricket analogies from now on.",
        replacedCount: 0,
      }),
    };
    const provider = { chat: async () => canned } as unknown as LLMProvider;
    const interpreter = new FeedbackInterpreter({
      resolve: async () => ({ provider }),
    } as never);
    const result = await interpreter.interpret("teach me with cricket stuff");
    expect(result.preferences[0]?.text).toBe("Prefer cricket analogies");
    expect(result.confirmation).toContain("cricket");
  });
});
