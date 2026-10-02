import { describe, expect, it } from "vitest";

import { COLORS } from "../src/features/whiteboard/opsBridge";

describe("chalk palette (ADR-0005)", () => {
  it("uses chalk white for the tutor and pink for the student", () => {
    expect(COLORS.tutor).toBe("#F4F7F2");
    expect(COLORS.student).toBe("#F9A8C2");
    expect(COLORS.highlight).toBe("#FBD870");
  });
});
