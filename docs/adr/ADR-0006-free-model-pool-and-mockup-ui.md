# ADR-0006: OpenRouter free-model pool and mockup-first UI architecture

Date: 2026-09-10
Status: Accepted (amends ADR-0004 provider seam and ADR-0005 chalkboard UX;
preserves all PRD invariants — tutoring contract §9, integrity gate §15,
privacy §13)

## Context

Two user-directed changes reshaped the provider and presentation layers:

1. **Free models only on OpenRouter.** The original OpenRouter provider used a
   single configurable model (`OPENROUTER_MODEL`). Free-model availability on
   OpenRouter changes weekly — models are renamed, retired, or converted to
   paid — so any hardcoded model is guaranteed to break. The user requirement
   is: *use all the free LLMs, exclusively*.

2. **Mockup-first UI.** A provided visual mockup defines the session UI: an
   "AI Teacher" top bar, a wooden-framed green chalkboard, handwritten chalk
   text, an encouragement sticky note, a subject pill, a dark conversational
   answer bar with mic, and a row of round action orbs. The PRD §10 layout and
   the first ADR-0005 implementation were replaced pixel-for-pixel by this
   mockup.

## Decision

### 1. Dynamic free-model pool (chat)

The OpenRouter provider resolves its chat pool **live from the OpenRouter
catalog** at request time:

- Fetch `/api/v1/models` (10-minute cache) and keep models where:
  - id ends with `:free`,
  - `pricing.prompt === "0"` and `pricing.completion === "0"` (true zero
    cost, not merely a free-tier trial),
  - the id does not match a non-chat exclusion pattern (moderation, embed,
    rerank, guard, TTS/ASR, CLIP-like).
- Prefer general instruct-style models (`gemma`, `nemotron`, …) for tutoring
  JSON quality; cap the pool at 8 models so rotation stays fast but wide
  enough to absorb per-model rate limits.
- **Rotate per call** through the pool with a 60 s per-model cooldown on
  failure; on any single-model error, try the next. Auth/validation errors
  are model-independent and fail fast.
- If the catalog itself is unreachable, fall back to a small hardcoded list
  of known-good `:free` ids (best-effort, refreshed by hand).

This makes "free models retired" a non-event: the pool self-heals on the
next cache expiry.

### 2. Dedicated free vision pool (photo of homework)

Vision requests must not rotate the chat pool — most free chat models are
text-only and fail on image parts, burning cooldowns. The provider therefore
resolves a **separate pool** filtered by
`architecture.input_modalities ∋ "image"` (same zero-cost + exclusion
rules). `provider.vision()` rotates only that pool. Photo extraction
(document upload) therefore works out of the box with free multimodal
models, and the fallback list is free multimodal ids.

### 3. Streaming resilience

Local/free models are slow and verbose. The streaming path raises its
timeout, maps timeout to a typed error, and — critically — **falls back to a
non-streaming completion** if the stream aborts mid-generation, then
continues the normal validation/repair pipeline (ADR-0003). A dropped
connection no longer loses a turn.

### 4. Mockup-first session UI

The workspace is rebuilt to the mockup, one component per visual element:

- **Top bar** — "AI Teacher" wordmark, subtitle (current topic), XP/level
  pill (ADR-0007 gamification), New session, Transcript.
- **Board** — `chalk-frame` (wooden border) around the `board-green` tldraw
  surface. All ops render through the ops bridge (ADR-0002); the tutor's
  chalk is white, the student's pink.
- **Op-layout hygiene** — write ops are clamped below the toolbar zone and
  row-nudged to avoid collisions; shapes and arrow labels are slid fully
  inside the board (`fitXInsideBoard`) because models emit coordinates that
  overflow the frame.
- **Answer bar** — a dark, rounded, always-conversational input ("Ask
  anything — or answer the tutor…") with mic. It is a conversation, not chat
  bubbles; the student can interject at any time.
- **Action orb row** — round buttons under the board: Voice · Type · Upload
  (photo/PDF) · Hint · Explain · Check (quiz me) · Cards (flashcards) · Save
  (export) · Clear. Each orb sends a conversational turn, keeping one
  interaction model (no mode switching).
- **Speech bubble** — the tutor's current line in a dark bottom bar, spoken
  aloud when voice mode is on.
- **Encouragement note** — the sticky note appears **only** on a hint or a
  correct quiz answer (event-driven, 8 s auto-hide), with escalating variants
  (streak 🔥, repeated hints).
- **Confirmation gate** — material attached before the session (photo on the
  home page) leaves the workspace on the confirmation overlay until the
  student confirms what the vision model read. The lesson opener runs only
  after confirmation (integrity gate §15 preserved).

### 5. Test/preview isolation

Playwright E2E runs on its own ports (Vite 5174 → mock backend 8790) so the
suite never touches the live dev servers or the real provider. The Vite
`/api` proxy is overridable via `VITE_API_PROXY`.

## Consequences

- No model names are configurable for OpenRouter chat/vision by default; the
  pool is the configuration. `OPENROUTER_MODEL` remains only as an override
  pinned in `.env` for debugging.
- Free models are weaker than paid ones; the pipeline compensates with the
  validation/repair pass and the server-side fallback quiz grader — a quiz
  answer can never go ungraded.
- Rate limits are the new failure mode: rotation + cooldowns absorb them;
  the health endpoint reports the usable fraction of the pool.
- The UI is mockup-locked: new affordances land as new orbs or pills, not as
  panes, to preserve the mockup's simplicity.
- Vision quality depends on the current free multimodal catalog; scanned
  PDFs (no text layer) return a clear "upload a screenshot instead" error
  because rendering PDF pages to images would need native dependencies.
