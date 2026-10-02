/**
 * Live speech extractor (user spec: pengi-style live conversation) — the
 * incremental "message" puller must survive arbitrary chunk boundaries,
 * string escapes, and never clip mid-sentence. Offline, deterministic.
 */
import { describe, expect, it } from "vitest";

import { LiveSpeechExtractor, completedSentences } from "../src/lib/liveSpeech";

/** Feed `raw` as DELTAS of chunkSize chars, collecting all sentences in order. */
function streamIn(raw: string, chunkSize: number): { sentences: string[]; extractor: LiveSpeechExtractor } {
  const extractor = new LiveSpeechExtractor("message");
  const sentences: string[] = [];
  for (let i = 0; i < raw.length; i += chunkSize) {
    sentences.push(...extractor.push(raw.slice(i, i + chunkSize)));
  }
  const rest = extractor.flush();
  if (rest) sentences.push(rest);
  return { sentences, extractor };
}

const reply = JSON.stringify({
  message: "Okay so, a fraction is just a division that hasn't happened yet. Three quarters means 3 divided by 4. Does that make sense so far?",
  response_type: "explanation",
  whiteboard_operations: [{ type: "write", payload: { x: 0, y: 0, text: "3/4 = 3 ÷ 4" } }],
});

describe("LiveSpeechExtractor", () => {
  it("extracts only the top-level message sentences, in order", () => {
    const { sentences } = streamIn(reply, 7);
    expect(sentences.join(" ")).toBe(
      "Okay so, a fraction is just a division that hasn't happened yet. Three quarters means 3 divided by 4. Does that make sense so far?",
    );
    // Board ops inside whiteboard_operations must NOT leak into speech.
    expect(sentences.join(" ")).not.toContain("÷ 4\"");
  });

  it("is chunk-size agnostic (every boundary from 1 to 23 chars)", () => {
    const expected = streamIn(reply, 1024).sentences;
    for (let size = 1; size <= 23; size++) {
      const { sentences } = streamIn(reply, size);
      expect(sentences).toEqual(expected);
    }
  });

  it("ignores a nested message-like field inside operations", () => {
    const raw = JSON.stringify({
      whiteboard_operations: [{ type: "write", payload: { text: "nested message should not speak" } }],
      message: "Real sentence here.",
    });
    const { sentences } = streamIn(raw, 5);
    expect(sentences.join(" ")).toBe("Real sentence here.");
  });

  it("handles escapes: quotes, newlines, backslashes, unicode", () => {
    const raw = `{"message":"Say \\"hi\\" friend.\\nThen continue. \\u0041 done."}`;
    const { sentences } = streamIn(raw, 3);
    expect(sentences.join(" ")).toContain('Say "hi" friend.');
    expect(sentences.join(" ")).toContain("Then continue.");
    expect(sentences.join(" ")).toContain("A done.");
  });

  it("does not split on decimals or common abbreviations", () => {
    const text = "Pi is about 3.14 roughly. Compare with e.g. circles in class. Dr. Smith agrees.";
    const sentences = completedSentences(text);
    // "3.14" and "e.g." must not split. The final sentence stays pending
    // (streaming: its separator hasn't arrived) — that is correct behavior.
    expect(sentences).toEqual([
      "Pi is about 3.14 roughly.",
      "Compare with e.g. circles in class.",
    ]);
  });

  it("emits the final sentence once the stream moves past it", () => {
    // A sentence only becomes speakable when text follows it (its separator
    // arrived) — the old no-past-the-end rule keeps "3." of "3.5" safe.
    expect(completedSentences("Dr. Smith agrees. And so does the class.")).toEqual([
      "Dr. Smith agrees.",
    ]);
    expect(
      completedSentences("Dr. Smith agrees. And so does the class. More next"),
    ).toEqual(["Dr. Smith agrees.", "And so does the class."]);
  });

  it("flush returns the trailing partial sentence", () => {
    const raw = JSON.stringify({ message: "First sentence. and it just stops" });
    const { sentences } = streamIn(raw, 4);
    expect(sentences[sentences.length - 1]).toContain("and it just stops");
  });

  it("returns nothing for a reply without a message field", () => {
    const raw = JSON.stringify({ response_type: "hint", hint_level: 2 });
    const { sentences } = streamIn(raw, 5);
    expect(sentences).toEqual([]);
  });
});
