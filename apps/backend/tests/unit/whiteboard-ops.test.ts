import { describe, expect, it } from "vitest";
import { whiteboardOpSchema } from "@local-live-tutor/shared";

import { extractJsonObject, stripFences, tryParseJsonObject } from "../../src/services/tutoring/json.js";

describe("whiteboard operation validation (PRD §5.4, §9)", () => {
  it("validates every PRD op type with normalized coordinates", () => {
    const ops = [
      { type: "write", payload: { x: 100, y: 100, text: "3/4 + 1/2" } },
      { type: "draw_equation", payload: { x: 100, y: 140, latex: "\\frac{3}{4}" } },
      { type: "highlight", payload: { target: "denominators" } },
      { type: "circle", payload: { cx: 300, cy: 100, rx: 50, ry: 30 } },
      { type: "underline", payload: { from: [10, 10], to: [200, 10] } },
      { type: "arrow", payload: { from: [180, 100], to: [240, 100], label: "common denominator" } },
      { type: "line", payload: { from: [0, 500], to: [1000, 500] } },
      { type: "rectangle", payload: { x: 10, y: 10, w: 200, h: 100 } },
      { type: "clear_region", payload: { region: "tutor" } },
    ];
    for (const op of ops) {
      expect(whiteboardOpSchema.safeParse(op).success).toBe(true);
    }
  });

  it("rejects executable code masquerading as an op", () => {
    const malicious = [
      { type: "eval", payload: { code: "process.exit(1)" } },
      { type: "write", payload: { x: 1, y: 1, text: "<script>alert(1)</script>", color: "#FF0000" } },
      { type: "arrow", payload: { from: [-50, 0], to: [100, 100] } },
    ];
    expect(whiteboardOpSchema.safeParse(malicious[0]).success).toBe(false);
    expect(whiteboardOpSchema.safeParse(malicious[1]).success).toBe(true); // text is plain content, rendered as text
    expect(whiteboardOpSchema.safeParse(malicious[2]).success).toBe(false);
  });
});

describe("JSON extraction helpers (PRD §9)", () => {
  it("strips markdown fences", () => {
    expect(stripFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  it("extracts balanced JSON from mixed prose", () => {
    expect(extractJsonObject('Sure! {"message":"hi"} hope that helps')).toBe('{"message":"hi"}');
  });

  it("handles nested braces and strings with braces", () => {
    const raw = '{"message":"use { } carefully","ops":[{"payload":{"x":1}}]}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("returns undefined for broken JSON", () => {
    expect(tryParseJsonObject("this is not json at all")).toBeUndefined();
  });
});
