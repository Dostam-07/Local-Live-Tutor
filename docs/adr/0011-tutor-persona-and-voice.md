# ADR-0011: Tutor persona and voice selection

Date: 2026-09-13
Status: Accepted (extends the ADR-0006 conversational tutor; the tutoring
contract §9, safety rules §13/§15, and the academic-integrity gate are
unchanged)

## Context

The tutor spoke with one fixed tone and — because browsers fall back to
whichever TTS voice the OS picks — was effectively male-only. The user asked
for a tutor that can be "sarcastic, genz, calm, sweet, or whatever a teacher
is that is good for their students," and explicitly for a female voice option.

## Decision

**Persona is a prompt-level knob, not a different model.** A single
`tutorPersona` app setting (`friendly | calm | sweet | sarcastic | genz |
strict`) is resolved from settings on every turn and rendered into the system
prompt as a `PERSONA_GUIDANCE` block (`personaBlock()` in
`packages/shared/src/prompts.ts`). Each block:

- describes the tone (dry wit for sarcastic, internet-native slang for genz,
  unhurried reassurance for calm, rare-but-meaningful praise for strict…);
- is hard-bounded: every persona repeats that the safety rules, the
  factual-accuracy rule, and the Socratic pedagogy are unchanged — only tone
  adapts. The sarcastic persona adds "TEASE THE MISTAKE, NEVER THE STUDENT"
  and drops jokes when the student is stuck; genz requires clarity-first.

Because the block rides along in `buildSystemPrompt()`, all four turn paths
(student message, lesson opener, summary, recap ritual) get it for free.

**Voice is a browser-side selection, persisted app-wide.** The Web Speech API
only exposes its voice list to the client, so `tutorVoice`
(`female | male | auto`) is stored in settings (SQLite, same KV store) but
*applied* in `apps/frontend/src/lib/tutorVoice.ts`:

- Voice names are classified by curated marker lists covering Windows
  (Zira/Hazel/Aria/Jenny…, David/Mark/Ryan…), macOS (Samantha/Victoria/Karen…,
  Alex/Daniel/Fred…), and Chrome/Google voices, with explicit
  "female"/"male" name markers taking precedence;
- "natural/online/neural" tier voices are preferred (they sound markedly
  better than the legacy SAPI voices);
- the chosen voice URI is remembered in localStorage and reused while it
  keeps matching the preference, so the tutor's voice never shuffles
  mid-conversation (Chrome otherwise re-picks its default per utterance);
- matching always falls through to *some* English voice — a missing
  gendered match degrades to "still speaks," never to silence.

`WorkspacePage` passes the picked voice to every `SpeechSynthesisUtterance`;
Settings offers both controls plus a ▶ Preview button, and the board-side 📖
popover exposes Style and Voice so they can be changed mid-lesson.

## Consequences

- One setting drives both surfaces; no per-session persona drift.
- The marker lists are heuristic: a genuinely unisex OS voice may classify as
  auto. Explicit "female"/"male" name markers cover the common defaults on
  all three platforms.
- Server-side TTS (Piper) can later consume the same `tutorVoice` setting;
  the setting is already the single source of truth.
