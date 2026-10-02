# ADR-0012: Append-only board and the three-layer speech pipeline

Date: 2026-09-14
Status: Accepted (supersedes the rolling-erase behavior of ADR-0005/ADR-0009
for live lessons; the end-of-lesson ritual and the explicit Clear orb keep
their erase)

## Context

The blackboard behaved like a finite surface: when it filled up, the oldest
chalk was erased to make room (the "rolling chalkboard"), and starting a new
problem wiped the tutor ink. The user redefined the product: the blackboard is
the **permanent record of the student's entire learning session** — the
original question, every step, every attempt (right or wrong) must stay
visible for the whole session, growing as a timeline.

Separately, the voice sounded robotic because the raw board/chat text went
straight into the TTS engine: math symbols were read literally ("square root
symbol, two five"), UI labels leaked into speech ("Problem colon…",
"You: …"), markdown was spelled out, and delivery raced through whole
paragraphs with no pauses.

## Decision

**1. Append-only blackboard.** The board is a timeline:
`Question → Student Attempt → Feedback → Retry → Correction → Next Step →
Final Answer`. Nothing is automatically deleted, replaced, or overwritten:

- The renderer (`opsBridge.ts`) no longer erases anything to make room.
  `makeRoom` and the rolling `relayoutChalk` erase are gone; `rolling:` call
  flags remain accepted but ignored for compatibility. When the column grows
  past the viewport, the camera pans to the latest chalk (`panToLatestChalk`)
  — the student can scroll back to earlier steps at any time.
- The backend no longer injects `clear_region` on a new problem. A new problem
  opens a `─── New problem ───` section header and flows BELOW the existing
  chalk. `extractValidOps` also drops any model-emitted `clear_region` — the
  model can never erase the session record. Erasing is reserved for the
  explicit Clear orb and the end-of-lesson ritual, both constructed
  server-side.

**2. Attempts are kept and marked.** A graded attempt always produces a
deterministic verdict line chalked directly under the student's echoed answer:
`✓ Correct — …` or `✗ Not quite — try again. …` (server-side fact, never
trusted to the model). A wrong answer keeps the same quiz pending, so the next
message is graded as the retry; both attempts remain on the board. The quiz
score counts every graded attempt (`quizAskedDelta` per attempt).

**3. Three layers, separated.**

- **A. Board representation** — exact notation (`√25 = 5`, `2x + 4 = 10`),
  full history, verdict glyphs.
- **B. Tutor response** — natural-language explanation in the message
  transcript (grading feedback is appended as a spoken sentence, not a
  `(Marked: …)` annotation).
- **C. Speech representation** (`lib/speechText.ts`) — every TTS path (live
  `SpeechQueue` and the `speakTutor` fallback) converts through
  `toSpeechText`/`toSpeechChunks` before the engine sees it: `√` → "square
  root of", `²` → "squared", operators → "plus/minus/times/divided by",
  markdown/UI labels/meta stripped, URLs → "this picture", verdict glyphs →
  words. Raw board text never reaches TTS.

**4. Natural delivery.** Chunks are breath-groups (≤ ~180 chars), spoken at
rate 0.94 with a 220 ms pause between them — the tutor explains instead of
racing. Sentence-boundary streaming (ADR for live speech) is preserved; each
sentence passes through the speech layer as it arrives.

**5. Mic stays in context.** Pressing the mic no longer swaps the UI: the orb
keeps its place and shows a calm amber pulse (`mic-live`), and the speech
bubble keeps the tutor's last line with the interim transcript appended —
a conversation, not a mode change.

## Consequences

- Long sessions make the board long. The camera follows the newest chalk;
  the full history stays one scroll away. The PDF export and the op log
  already carried the whole session; the live board now matches them.
- Board layout work (relayout) is O(all chalk) per batch, but runs in
  requestAnimationFrame batches and stays well under frame budget for
  classroom-sized sessions.
- `tutorResponseSchema` still *accepts* model `clear_region` ops (schema
  unchanged for compatibility) — they are dropped in `extractValidOps`.
- Speech conversion is heuristic and line-based: a line containing math gets
  full symbol treatment; prose lines keep natural rhythm with inline-symbol
  conversions only.

## Acceptance criteria (from the user spec)

1–7: the question and every step/attempt stay visible; wrong answers keep ✗
and can be retried; long sessions never delete earlier content.
8: the mic does not replace the interface. 9–12: conversational voice, no
read-aloud punctuation, math spoken as words, TTS receives a speech-optimized
representation. 13: the board is the authoritative, complete session record.
