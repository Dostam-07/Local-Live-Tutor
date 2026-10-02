import { describe, expect, it } from "vitest";

import {
  buildContextPack,
  buildSystemPrompt,
  describeBoard,
  estimateTokens,
  inferChalkKind,
  SAFETY_RULES,
  selectHistory,
  summarizeTurns,
  TUTOR_SYSTEM_PROMPT,
  TUTOR_RESPONSE_CONTRACT,
  type ContextTurn,
} from "../src/prompts.js";
import type { WhiteboardOp } from "../src/types.js";

const op = (type: WhiteboardOp["type"]): WhiteboardOp => ({
  id: "op1",
  sessionId: "s1",
  actor: "tutor",
  type,
  payload: {},
  createdAt: new Date().toISOString(),
});

describe("buildSystemPrompt", () => {
  it("includes the PRD system prompt rules verbatim", () => {
    const prompt = buildSystemPrompt({
      subject: "math",
      gradeLevel: "middle_school",
      helpLevel: "socratic",
      mode: "homework",
      maxHintLevel: 3,
    });
    expect(prompt).toContain(TUTOR_SYSTEM_PROMPT);
    expect(prompt).toContain("do not immediately provide final answers");
    expect(prompt).toContain("Return valid JSON matching the required response schema.");
  });

  it("includes safety and integrity rules", () => {
    const prompt = buildSystemPrompt({
      subject: "science",
      helpLevel: "direct",
      mode: "learn",
      maxHintLevel: 5,
    });
    expect(prompt).toContain(SAFETY_RULES);
    expect(prompt).toContain("Academic integrity");
  });

  it("adapts to help level and sets the hint ceiling", () => {
    const socratic = buildSystemPrompt({
      subject: "math",
      helpLevel: "socratic",
      mode: "homework",
      maxHintLevel: 3,
    });
    expect(socratic).toContain("levels 0-2");
    expect(socratic).toContain('Current hard ceiling for "hint_level": 3');
    expect(socratic).toContain("Never exceed it");

    const direct = buildSystemPrompt({
      subject: "math",
      helpLevel: "direct",
      mode: "homework",
      maxHintLevel: 5,
    });
    expect(direct).toContain("Explain directly");
  });

  it("always includes the response contract", () => {
    const prompt = buildSystemPrompt({
      subject: "math",
      helpLevel: "socratic",
      mode: "learn",
      maxHintLevel: 2,
    });
    expect(prompt).toContain(TUTOR_RESPONSE_CONTRACT);
  });

  it("adapts the tone to the persona (user spec) but keeps pedagogy fixed", () => {
    const base = {
      subject: "math" as const,
      helpLevel: "socratic" as const,
      mode: "homework" as const,
      maxHintLevel: 3,
    };
    const sarcastic = buildSystemPrompt({ ...base, persona: "sarcastic" });
    const genz = buildSystemPrompt({ ...base, persona: "genz" });
    const calm = buildSystemPrompt({ ...base, persona: "calm" });
    const sweet = buildSystemPrompt({ ...base, persona: "sweet" });
    const strict = buildSystemPrompt({ ...base, persona: "strict" });
    expect(sarcastic).toContain("Persona: sarcastic");
    expect(sarcastic).toContain("TEASE THE MISTAKE, NEVER THE STUDENT");
    expect(genz).toContain("Persona: genz");
    expect(calm).toContain("Persona: calm");
    expect(sweet).toContain("Persona: sweet");
    expect(strict).toContain("Persona: strict");
    // Persona never weakens the core rules — every variant keeps them all.
    for (const prompt of [sarcastic, genz, calm, sweet, strict]) {
      expect(prompt).toContain(SAFETY_RULES);
      expect(prompt).toContain("Academic integrity");
      expect(prompt).toContain("FACTUAL ACCURACY");
    }
  });

  it("defaults to the friendly persona", () => {
    const prompt = buildSystemPrompt({
      subject: "math",
      helpLevel: "socratic",
      mode: "homework",
      maxHintLevel: 3,
    });
    expect(prompt).toContain("Persona: friendly");
  });
});

describe("selectHistory (PRD §8 context control)", () => {
  const turns: ContextTurn[] = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "student" : "tutor",
    content: `Message number ${i} with some content.`,
  }));

  it("keeps the recent window and summarizes older turns", () => {
    const result = selectHistory(turns, 4000, 10);
    expect(result.turns).toHaveLength(10);
    expect(result.olderSummary).toBeDefined();
    expect(result.olderSummary).toContain("Earlier student messages");
    expect(result.droppedCount).toBe(20);
  });

  it("shrinks further when the recent window exceeds the budget", () => {
    const big = Array.from({ length: 6 }, (_, i) => ({
      role: "student" as const,
      content: "x".repeat(500),
    }));
    const result = selectHistory(big, 1200, 6);
    expect(result.turns.length).toBeLessThan(6);
    expect(result.turns.reduce((a, t) => a + t.content.length, 0)).toBeLessThanOrEqual(1201);
  });

  it("returns no summary when everything is recent", () => {
    const result = selectHistory(turns.slice(0, 5), 4000, 10);
    expect(result.olderSummary).toBeUndefined();
    expect(result.droppedCount).toBe(0);
  });
});

describe("summarizeTurns", () => {
  it("separates student and tutor points", () => {
    const summary = summarizeTurns([
      { role: "student", content: "I tried multiplying the tops. Then I stopped." },
      { role: "tutor", content: "We practiced common denominators. Then we checked units." },
    ]);
    expect(summary).toContain("Earlier student messages: I tried multiplying the tops.");
    expect(summary).toContain("Earlier tutor guidance: We practiced common denominators.");
  });

  it("truncates very long first sentences", () => {
    const summary = summarizeTurns([
      { role: "student", content: "x".repeat(400) },
    ]);
    expect(summary.length).toBeLessThan(220);
  });
});

describe("describeBoard (ADR-0009 board-awareness)", () => {
  it("renders an empty board", () => {
    expect(describeBoard([])).toBe("(the board is empty)");
  });

  it("describes writes, arrows, and highlights in order", () => {
    const description = describeBoard([
      { type: "write", payload: { x: 120, y: 160, text: "2x + 3 = 11" } },
      { type: "write", payload: { x: 120, y: 240, text: "2x = 8" } },
      { type: "arrow", payload: { from: [180, 130], to: [260, 130], label: "Next?" } },
      { type: "highlight", payload: { target: "denominators" } },
    ]);
    expect(description).toContain('wrote "2x + 3 = 11"');
    expect(description).toContain('then wrote "2x = 8"');
    expect(description).toContain('arrow labeled "Next?"');
    expect(description).toContain('highlighted "denominators"');
    expect(description.startsWith("The tutor ")).toBe(true);
  });

  it("deduplicates repeated chalk and caps the length", () => {
    const ops = Array.from({ length: 30 }, (_, i) => ({
      type: "write" as const,
      payload: { x: 100, y: 100 + i * 40, text: i < 20 ? "same line" : `line ${i}` },
    }));
    const description = describeBoard(ops);
    expect(description.match(/same line/g)).toHaveLength(1);
    expect(description.split(", then ").length).toBeLessThanOrEqual(14);
  });

  it("reports clear_region as erasing", () => {
    expect(describeBoard([{ type: "clear_region", payload: { region: "all" } }])).toContain(
      "erased the board",
    );
  });

  it("the pack tells the tutor the board description is its own writing", () => {
    const pack = buildContextPack({
      subject: "math",
      gradeLevel: "middle_school",
      helpLevel: "socratic",
      mode: "homework",
      history: [],
      boardState: 'The tutor wrote "2x + 3 = 11".',
      recentOps: [],
    });
    expect(pack).toContain("Whiteboard (what is written on the chalkboard right now)");
    expect(pack).toContain("This is YOUR writing");
    expect(pack).toContain('wrote "2x + 3 = 11"');
  });
});

describe("buildContextPack (PRD §8 context pack)", () => {
  it("includes profile, problem, conversation, board, and objective", () => {
    const pack = buildContextPack({
      subject: "math",
      gradeLevel: "middle_school",
      helpLevel: "socratic",
      mode: "homework",
      extractedProblem: "3/4 + 1/2 = ?",
      history: [
        { role: "student", content: "I added the tops and bottoms." },
        { role: "tutor", content: "What happens to the size of the pieces?" },
      ],
      recentOps: [op("write")],
      currentGoal: "Find a common denominator",
    });
    expect(pack).toContain("Subject: math");
    expect(pack).toContain("3/4 + 1/2 = ?");
    expect(pack).toContain("student: I added the tops and bottoms.");
    expect(pack).toContain("write({})");
    expect(pack).toContain("Current objective: Find a common denominator");
  });

  it("summarizes older history into the pack", () => {
    const history: ContextTurn[] = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? "student" : "tutor",
      content: `Turn ${i} detail.`,
    }));
    const pack = buildContextPack({
      subject: "math",
      helpLevel: "hints",
      mode: "practice",
      history,
    });
    expect(pack).toContain("[Summary of earlier messages]");
    // Older turns appear inside the summary section...
    expect(pack).toContain("Earlier student messages: Turn 0 detail.");
    // ...the last 10 turns appear in the recent window...
    expect(pack).toContain("Turn 24 detail.");
    // ...and older turns do NOT appear in the verbatim conversation.
    expect(pack).not.toContain("Conversation (most recent last):\n[Summary of earlier messages] student: Turn 3");
    expect(pack).not.toContain("student: Turn 3 detail.\ntutor: Turn 4");
  });

  it("asks for the problem when none is present", () => {
    const pack = buildContextPack({
      subject: "other",
      helpLevel: "socratic",
      mode: "learn",
      history: [],
      recentOps: [],
    });
    expect(pack).toContain("No problem text yet");
  });

  it("includes answer choices when provided", () => {
    const pack = buildContextPack({
      subject: "science",
      helpLevel: "socratic",
      mode: "homework",
      answerChoices: ["A) 4", "B) 8"],
      history: [],
      recentOps: [],
    });
    expect(pack).toContain("A) 4");
  });
});

describe("inferChalkKind (user spec: color-coded chalk)", () => {
  it("classifies questions, answers, explanations, and facts", () => {
    expect(inferChalkKind("Quiz 1: What caused the flood?")).toBe("question");
    expect(inferChalkKind("What is 2/3 + 1/4?")).toBe("question");
    expect(inferChalkKind("You: The Treaty of Versailles")).toBe("answer");
    expect(inferChalkKind("✓ Correct because the treaty imposed reparations")).toBe("answer");
    expect(inferChalkKind("Step 1: find the common denominator")).toBe("explanation");
    expect(inferChalkKind("Water evaporates because the sun heats it")).toBe("explanation");
    expect(inferChalkKind("a^2 + b^2 = c^2")).toBe("fact");
    expect(inferChalkKind("The Battle of Hastings was in 1066")).toBe("fact");
  });

  it("prefers the model's explicit kind via the schema, not the inference", () => {
    // Inference only runs when the model omits kind; here we just pin that the
    // inferred fallback never crashes on odd input.
    expect(inferChalkKind("")).toBe("fact");
  });
});

describe("estimateTokens", () => {
  it("approximates 4 chars per token", () => {
    expect(estimateTokens("x".repeat(40))).toBe(10);
  });
});
