# ADR-0007: Gamified study stats — XP, streaks, badges, flashcard mastery

Date: 2026-09-10
Status: Accepted (extends ADR-0005/0006 presentation with a motivation
layer; the tutoring contract §9 and integrity gate §15 are unchanged)

## Context

The user asked for a gamified tutor: marks after quizzes, XP, streaks,
badges, encouragement that reacts to performance ("You're doing great!" on
hints and correct answers), and flashcards that track mastery across
sessions. The existing system had per-session XP and quiz scores only —
nothing cumulative, nothing that survives a session.

## Decision

### 1. One cumulative stats record

`StudyStats` lives in the `app_settings` KV store under a dedicated key —
no schema migration. Shape (shared schema, single source of truth):

- `dailyStreak` / `bestDailyStreak` — consecutive **calendar days** with at
  least one correct answer (local clock, computed from `lastStudyDate`).
- `answerStreak` / `bestAnswerStreak` — consecutive correct quiz answers
  (across sessions); a wrong answer resets it.
- `totalCorrect`, `totalXp` — lifetime totals.
- `badges[]` — unlocked badge ids (see below).
- `masteredFlashcards[]` — flashcard **front texts** marked mastered.

A single repo (`StudyStatsRepo`) owns every read/write and all award logic;
services never mutate stats directly.

### 2. Award points are centralized

Quiz grading in the tutoring pipeline is the only place that records
answers: `recordAnswer(correct, xp)` updates streaks/totals and returns
`newBadges[]`, which flow through the turn result (`stats`, `newBadges`)
to the frontend. Deck completion and manual XP record through `recordXp`.

Because free models sometimes omit the grading JSON, a **server-side
fallback grader** (token-overlap against the quiz's stored answer) grades
any pending quiz the model failed to grade — an answer can never silently
cost the student their marks.

### 3. Badges are a fixed, documented set

`first_correct` 🌟 · `streak_3` 🔥 · `streak_5` ⚡ · `quiz_5` 🎯 ·
`xp_100` 💯 · `cards_10` 🃏. Badge metadata (label/icon/description) lives
in shared (`BADGES`) so backend and frontend render the same names. Badges
are unlock-once; re-unlocks are suppressed by idempotent checks.

### 4. Escalating encouragement note

The sticky note is **event-driven** — it appears only on a hint or a
correct answer and auto-hides after 8 s. Variants escalate:

- Correct answers follow the streak: 1–2 → "🎉 You're doing great!",
  3–4 → "🔥 On fire!", 5+ → "⚡ UNSTOPPABLE!".
- Hints follow repeat count: 1 → "💡 Keep going!", 2 → "💪 You're close
  now", 3+ → "🧠 Every expert was once stuck" (asking for help is framed
  as a strength).

### 5. Level-up and badge toasts

Level = `floor(totalXp / 50) + 1`. When a turn's stats cross a level
boundary the pill shows an animated "✨ LEVEL n!" pop; the first new badge
of a turn shows an "🏅 Badge unlocked" toast. Animations are pure CSS
(`level-pop`, `badge-pop`).

### 6. Voice-driven flashcards with mastery

The flashcards modal gains a 🎙 *Speak it* button (one-shot Web Speech
recognition; the spoken answer is shown for self-check) and two
self-assessment buttons after flipping: **✅ I knew it** (marks the card
mastered, syncs to `POST /api/stats/mastered`, advances) and **🔄 Show me
again** (advances, stays unmastered). Mastery persists across sessions and
feeds the `cards_10` badge; the lesson export lists mastered vs
unmastered cards.

## Consequences

- Stats are global, not per-student — the local-first single-user model
  makes this correct (PRD §13: no accounts).
- `masteredFlashcards` matches by front text; regenerating an identical
  card inherits mastery, a reworded card starts fresh (acceptable and
  arguably desired).
- Badge ids are a closed enum; adding one requires a shared-schema change
  plus unlock logic in the repo, keeping award rules auditable in one
  file.
- Streak math uses UTC calendar days of local time from `toISOString`
  slices; a stricter timezone-aware day boundary is a possible refinement.
