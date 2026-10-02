/**
 * Speech representation layer (user spec §5–§7): the blackboard keeps exact
 * notation; TTS receives natural spoken language. No window/speech engine —
 * offline and deterministic.
 */
import { describe, expect, it } from "vitest";

import { toSpeechChunks, toSpeechText } from "../src/lib/speechText.js";

describe("toSpeechText — math becomes words", () => {
  it("speaks a square root sentence naturally (user example)", () => {
    const out = toSpeechText("√25 = 5");
    expect(out.toLowerCase()).toContain("square root");
    expect(out.toLowerCase()).toContain("equals");
    expect(out).not.toContain("√");
  });

  it("speaks powers as squared/cubed", () => {
    const out = toSpeechText("x² + 3 = 12");
    expect(out.toLowerCase()).toContain("squared");
    expect(out.toLowerCase()).toContain("plus");
    expect(out.toLowerCase()).toContain("equals");
  });

  it("reads operators as plus/minus/times/divided by", () => {
    const out = toSpeechText("2x + 4 = 10");
    expect(out.toLowerCase()).toContain("plus");
    expect(out.toLowerCase()).toContain("equals");
    const div = toSpeechText("10 / 2 = 5");
    expect(div.toLowerCase()).toContain("divided by");
    const times = toSpeechText("3 × 4 = 12");
    expect(times.toLowerCase()).toContain("times");
    const minus = toSpeechText("9 − 3 = 6");
    expect(minus.toLowerCase()).toContain("minus");
  });

  it("never says symbol names like question mark or exclamation mark", () => {
    const out = toSpeechText("What is 2+2?");
    expect(out.toLowerCase()).not.toContain("question mark");
    expect(out.toLowerCase()).not.toContain("exclamation");
    expect(out.toLowerCase()).not.toContain("full stop");
  });
});

describe("toSpeechText — markup, labels, and metadata never reach TTS", () => {
  it("strips markdown and reads list structure as sentences", () => {
    const out = toSpeechText("**Step 1:** subtract four from both sides\n- Then divide by 2");
    expect(out).not.toContain("**");
    expect(out).not.toContain("-");
    expect(out.toLowerCase()).toContain("step 1");
  });

  it("drops internal meta annotations", () => {
    const out = toSpeechText("Good try!\n(Marked: not quite — expected sunlight)");
    expect(out).not.toContain("Marked");
    expect(out).toContain("Good try");
  });

  it("drops the quiz ride-along annotation", () => {
    const out = toSpeechText('Let me think.\n[Quiz question you asked: "X" — correct answer: "Y"]');
    expect(out).not.toContain("Quiz question");
  });

  it("converts UI prefixes into natural phrases", () => {
    expect(toSpeechText("Problem: 2x + 4 = 10").toLowerCase()).toContain("the problem");
    expect(toSpeechText("Quiz: What is photosynthesis?").toLowerCase()).toContain("quiz time");
    expect(toSpeechText("You: x = 6").toLowerCase()).not.toContain("you:");
  });

  it("never speaks raw URLs", () => {
    const out = toSpeechText("Look at this: https://image.pollinations.ai/prompt/water%20cycle — see how it loops.");
    expect(out).not.toContain("https://");
    expect(out.toLowerCase()).toContain("picture");
  });

  it("converts verdict glyphs to spoken words", () => {
    const out = toSpeechText("✓ Correct — matched the expected answer");
    expect(out.toLowerCase()).toContain("correct");
    expect(out).not.toContain("✓");
    const cross = toSpeechText("✗ Not quite — try again");
    expect(cross.toLowerCase()).toContain("not quite");
    expect(cross).not.toContain("✗");
  });
});

describe("toSpeechText — pacing and pauses", () => {
  it("turns Step 1: … Step 2: … into separated sentences", () => {
    const out = toSpeechText("Step 1: write the equation Step 2: subtract four");
    expect(out).toContain("Step 1.");
    expect(out).toContain("Step 2.");
  });
});

describe("toSpeechText — lesson languages", () => {
  it("speaks math in Hindi for a pinned Hindi lesson", () => {
    const out = toSpeechText("2x + 4 = 10", "hi");
    expect(out).toContain("जमा");
    expect(out).toContain("बराबर");
    expect(out).not.toContain("plus");
    expect(out).not.toContain("equals");
  });

  it("speaks math in Spanish for a pinned Spanish lesson", () => {
    const out = toSpeechText("3/4 + 1/2 = 5/4", "es");
    expect(out).toContain("más");
    expect(out).toContain("es igual a");
  });

  it("keeps native math symbols in CJK lessons (engines voice them)", () => {
    const out = toSpeechText("2x + 4 = 10", "zh");
    expect(out).toContain("＋");
    expect(out).toContain("＝");
    expect(out).not.toContain("plus");
  });

  it("defaults to English math words for auto lessons", () => {
    const out = toSpeechText("2 + 2 = 4");
    expect(out).toContain("plus");
    expect(out).toContain("equals");
  });

  it("splits Hindi danda-terminated sentences into chunks", () => {
    const chunks = toSpeechChunks(
      "पहले हम यह देखते हैं। अगला कदम आसान है। अब आप बताइए।",
      25, // the text is ~52 chars — a small cap forces per-sentence chunks
      "hi",
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain("।");
    expect(chunks.join("")).toContain("बताइए");
  });
});

describe("toSpeechChunks — breath-groups", () => {
  it("splits long explanations into chunks under the length cap", () => {
    const long =
      "Let's start with two x plus four equals ten. Now, let's subtract four from both sides, which gives two x equals six. Finally we divide both sides by two, and x equals three. Does that make sense so far?";
    const chunks = toSpeechChunks(long, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(140); // cap + one sentence's slack
    }
  });

  it("returns a single chunk for short text and none for empty", () => {
    expect(toSpeechChunks("Yes!")).toHaveLength(1);
    expect(toSpeechChunks("")).toHaveLength(0);
  });

  it("keeps the sentence order intact", () => {
    const chunks = toSpeechChunks("First comes one. Then comes two. Then comes three.");
    expect(chunks.join(" ")).toContain("one");
    expect(chunks.join(" ")).toContain("two");
    expect(chunks.join(" ")).toContain("three");
  });
});
