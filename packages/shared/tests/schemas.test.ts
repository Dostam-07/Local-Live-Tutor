import { describe, expect, it } from "vitest";

import {
  studentMessageSchema,
  tutorResponseSchema,
  whiteboardOpSchema,
} from "../src/schemas.js";

describe("tutorResponseSchema (PRD §9)", () => {
  it("accepts a valid structured response", () => {
    const parsed = tutorResponseSchema.safeParse({
      message: "What do you notice about the two denominators?",
      response_type: "question",
      student_action: "Identify a common denominator",
      hint_level: 1,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the PRD §5.4 example with operations", () => {
    const parsed = tutorResponseSchema.safeParse({
      message: "Let's set this up on the board.",
      response_type: "hint",
      hint_level: 2,
      should_draw: true,
      whiteboard_operations: [
        { type: "write", payload: { x: 120, y: 80, text: "3/4 + 1/2" } },
        {
          type: "arrow",
          payload: { from: [180, 100], to: [240, 100], label: "common denominator" },
        },
        { type: "highlight", payload: { target: "denominators" } },
      ],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("normalizes flat-shaped whiteboard ops to { type, payload }", () => {
    // Exact shape a free model emitted live (2026-09): flat fields, no payload.
    const parsed = tutorResponseSchema.safeParse({
      message: "Let's start with the first one.",
      response_type: "diagnostic",
      hint_level: 0,
      should_draw: true,
      whiteboard_operations: [
        { type: "write", x: 60, y: 70, text: "Solving Equations for x" },
        { type: "write", x: 60, y: 160, text: "3x + 5 = 20" },
      ],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.whiteboard_operations).toEqual([
      { type: "write", payload: { x: 60, y: 70, text: "Solving Equations for x" } },
      { type: "write", payload: { x: 60, y: 160, text: "3x + 5 = 20" } },
    ]);
  });

  it("keeps the response valid when a model invents an op type (per-op drop, not per-turn)", () => {
    const parsed = tutorResponseSchema.safeParse({
      message: "Working on it.",
      response_type: "hint",
      hint_level: 1,
      should_draw: true,
      whiteboard_operations: [
        { type: "write", payload: { x: 10, y: 10, text: "hello" } },
        { type: "draw", x: 0, y: 0 }, // unknown type + flat shape
      ],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown response_type", () => {
    const parsed = tutorResponseSchema.safeParse({
      message: "hi",
      response_type: "solved_it_for_them",
      hint_level: 0,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects hint_level outside 0-5", () => {
    const parsed = tutorResponseSchema.safeParse({
      message: "hi",
      response_type: "hint",
      hint_level: 9,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing message", () => {
    const parsed = tutorResponseSchema.safeParse({
      response_type: "hint",
      hint_level: 0,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps unknown op types envelope-valid; whiteboardOpSchema drops them per-op", () => {
    // Envelope stays valid (the turn survives); the unknown op is rejected
    // later by whiteboardOpSchema in the backend's extractValidOps.
    const parsed = tutorResponseSchema.safeParse({
      message: "hi",
      response_type: "hint",
      hint_level: 0,
      should_draw: true,
      whiteboard_operations: [
        { type: "run_javascript", payload: { code: "alert(1)" } },
      ],
      answer_revealed: false,
    });
    expect(parsed.success).toBe(true);
    const dropped = whiteboardOpSchema.safeParse(parsed.success ? parsed.data.whiteboard_operations[0] : null);
    expect(dropped.success).toBe(false);
  });
});

describe("whiteboardOpSchema (PRD §5.4, normalized coordinates)", () => {
  it("accepts all nine op types", () => {
    const ops = [
      { type: "write", payload: { x: 10, y: 20, text: "3/4" } },
      { type: "draw_equation", payload: { x: 10, y: 40, latex: "\\frac{3}{4}" } },
      { type: "highlight", payload: { target: "denominators" } },
      { type: "circle", payload: { cx: 100, cy: 100, rx: 40, ry: 40 } },
      { type: "underline", payload: { from: [10, 10], to: [100, 10] } },
      { type: "arrow", payload: { from: [10, 10], to: [100, 60], label: "step" } },
      { type: "line", payload: { from: [0, 500], to: [1000, 500] } },
      { type: "rectangle", payload: { x: 10, y: 10, w: 200, h: 80 } },
      { type: "clear_region", payload: { region: "all" } },
    ];
    for (const op of ops) {
      const parsed = whiteboardOpSchema.safeParse(op);
      expect(parsed.success, `op ${op.type} should parse`).toBe(true);
    }
  });

  it("rejects out-of-range coordinates", () => {
    const parsed = whiteboardOpSchema.safeParse({
      type: "arrow",
      payload: { from: [10, 10], to: [5000, 10] },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-integer coordinates", () => {
    const parsed = whiteboardOpSchema.safeParse({
      type: "write",
      payload: { x: 10.5, y: 20, text: "hi" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown op types", () => {
    const parsed = whiteboardOpSchema.safeParse({
      type: "iframe",
      payload: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid colors", () => {
    const parsed = whiteboardOpSchema.safeParse({
      type: "write",
      payload: { x: 1, y: 1, text: "hi", color: "javascript:alert(1)" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("studentMessageSchema", () => {
  it("defaults inputType to text and forceDirectAnswer to false", () => {
    const parsed = studentMessageSchema.parse({ content: "I think it's 12" });
    expect(parsed.inputType).toBe("text");
    expect(parsed.forceDirectAnswer).toBe(false);
  });

  it("rejects empty content", () => {
    expect(studentMessageSchema.safeParse({ content: "" }).success).toBe(false);
  });

  it("rejects content over 4000 chars", () => {
    expect(
      studentMessageSchema.safeParse({ content: "x".repeat(4001) }).success,
    ).toBe(false);
  });
});
