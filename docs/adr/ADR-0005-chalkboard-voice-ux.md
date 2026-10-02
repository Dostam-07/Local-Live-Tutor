# ADR-0005: Chalkboard-first voice tutoring UX

Date: 2026-09-09
Status: Accepted (supersedes the presentation aspects of PRD §10; all PRD
invariants — tutoring contract §9, integrity gate §15, persistence §7 — are
preserved)

## Context

The PRD's workspace layout (§10) is a three-pane chat workspace — Problem |
Whiteboard | Tutor — with a text input as the primary interaction. User feedback
after the first working build: the desired product is a **live tutor in the
spirit of tutor.pengi.ai** — the tutor writes on a chalkboard with chalk while
speaking, and the student solves problems **verbally**, as with a human tutor.

## Decision

1. **The board is the lesson.** The session workspace is a full-screen dark
   chalkboard (slate-green `#243B35`). tldraw remains the rendering/persistence
   engine (ADR-0002 unchanged) but runs in dark color scheme with its default
   UI hidden, replaced by a minimal chalk toolbar (select / draw / erase /
   undo / clear).

2. **Chalk palette.** Tutor ink = chalk white (`#F4F7F2`), highlights = chalk
   yellow (`#FBD870`), student ink = chalk pink (`#F9A8C2`). The PRD's paper
   palette remains for non-session chrome (setup, settings, history).

3. **Writing-while-talking.** Tutor ops from each turn are revealed with a
   staggered chalk-in animation (`chalkSequencer`, 550 ms per op) while the
   tutor's message is spoken via TTS. A caption bar shows the tutor's line
   (or the student's live interim speech).

4. **Continuous voice conversation.** Web Speech recognition runs continuously
   (`useVoiceConversation`); ~1.2 s of silence commits the utterance as a
   voice turn. Recognition pauses while TTS plays (echo control) and resumes
   automatically. Barge-in: clicking the mic orb while the tutor speaks stops
   playback. Voice turns are sent as `inputType: "voice"`.

5. **Proactive lesson opener.** `POST /api/sessions/:id/open` streams the
   tutor's first turn (chalks the problem, asks the diagnostic question)
   without a preceding student message. `TutorTurnResult.studentMessage` is
   `null` for opener turns.

6. **Fallbacks preserved.** Push-to-talk (PRD §5.5) remains for per-message
   voice; the transcript drawer keeps the full history and a type-instead
   input for browsers without Web Speech (PRD §14 degrade states).

## Consequences

- The three-pane layout and mobile tab bar are removed; the board, captions,
  and mic orb are inherently responsive.
- `voiceMode` joins `AppSettings` (default **on**); session setup offers a
  voice-conversation checkbox that also enables `autoSpeak`.
- The mock provider now emits at least one board op per turn so every turn
  visibly writes.
- PRD §10's "tutor tab stays default" rule is moot (no tabs); the PRD §16
  tests are unchanged in meaning — the loop is driven through the drawer.
