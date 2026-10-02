/**
 * First-input handoff (welcome board → workspace): consumed exactly once,
 * survives client-side navigation, and carries the optional lesson-settings
 * prefs chosen on the welcome board's 📖 pill.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { consumeFirstMessage, stashFirstMessage } from "../src/lib/firstMessage";

describe("firstMessage handoff", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("consumes a stashed text input exactly once", () => {
    stashFirstMessage("s1", { text: "I want to learn about photosynthesis" });
    expect(consumeFirstMessage("s1")).toEqual({
      text: "I want to learn about photosynthesis",
    });
    expect(consumeFirstMessage("s1")).toBeNull();
  });

  it("carries upload and lesson-settings prefs together", () => {
    const input = {
      upload: { name: "worksheet.png", dataUrl: "data:image/png;base64,AAA" },
      prefs: { subject: "history", gradeLevel: "high_school", helpLevel: "direct" },
    };
    stashFirstMessage("s2", input);
    expect(consumeFirstMessage("s2")).toEqual(input);
    expect(consumeFirstMessage("s2")).toBeNull();
  });

  it("returns null for sessions without a handoff", () => {
    expect(consumeFirstMessage("nope")).toBeNull();
  });
});
