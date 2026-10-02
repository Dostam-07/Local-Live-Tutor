/**
 * Zod schemas — PRD §9 (strict tutor response schema), §5.4 (whiteboard op
 * payloads), §7 (entities), §5.1 (session setup), §5.2 (extraction).
 *
 * Whiteboard op coordinates use a normalized 0–1000 space (Decision Log B7.3);
 * the renderer scales them to the actual canvas.
 */
import { z } from "zod";

// ---------- Tutor persona, adaptation & language (referenced throughout) ----------

/**
 * Tutor persona (user spec): the tutor's teaching character. This shapes the
 * system prompt's tone guidance — it is a prompt-level knob, not a different
 * model. "friendly" is the warm default.
 */
export const tutorPersonaSchema = z.enum([
  "friendly",
  "calm",
  "sweet",
  "sarcastic",
  "genz",
  "strict",
]);
export type TutorPersona = z.infer<typeof tutorPersonaSchema>;

/**
 * Adaptive persona (roadmap: "the tutor reads the room"). The BASE persona is
 * what the student picked; the ADAPTATION is a deterministic overlay computed
 * per turn from how the student is actually doing:
 * - cruising → a playful nudge is layered on
 * - struggling → the joke is dropped and the tone becomes extra encouraging
 * - neutral → the base persona speaks as-is.
 * The overlay never changes the pedagogy — only tone.
 */
export const personaAdaptationSchema = z.enum(["neutral", "cruising", "struggling"]);
export type PersonaAdaptation = z.infer<typeof personaAdaptationSchema>;

/**
 * Lesson language (roadmap: multilingual lessons). "auto" mirrors the
 * student: the tutor replies in the language the student wrote/spoke in.
 * An explicit value pins the lesson to that language (teaching, chalk, and
 * speech all switch), while subject CONTENT may still quote English source
 * material when the student asks.
 */
export const lessonLanguageSchema = z.enum([
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "hi",
  "pt",
  "it",
  "zh",
  "ja",
  "ko",
  "ar",
  "he",
  "ru",
]);
export type LessonLanguage = z.infer<typeof lessonLanguageSchema>;

/**
 * Right-to-left lesson languages (roadmap: RTL board layout). Chalk flows
 * right-to-left, text shapes are right-aligned, and bidi text surfaces get
 * dir=auto. Arabic and Hebrew are the shipped set.
 */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set(["ar", "he"]);

/** True when the lesson language writes right-to-left. */
export function isRtlLanguage(language: LessonLanguage | undefined | null): boolean {
  return language !== undefined && language !== null && RTL_LANGUAGES.has(language);
}

/**
 * Tutor speaking voice (user spec: not only a male voice). Selects the
 * browser TTS voice gender; "auto" lets the browser pick its default.
 * Voice SELECTION happens in the browser (the Web Speech API voice list is
 * client-side); this setting is persisted so it applies everywhere.
 */
export const tutorVoiceSchema = z.enum(["female", "male", "auto"]);
export type TutorVoice = z.infer<typeof tutorVoiceSchema>;

// ---------- Session setup (PRD §5.1, §7) ----------

export const createSessionSchema = z.object({
  title: z.string().max(200).optional(),
  // Per-lesson knobs (user bug: the welcome board sent these but zod
  // silently stripped them — pinned languages like Hindi never applied).
  // Also settable via PATCH after creation.
  persona: tutorPersonaSchema.optional(),
  voice: tutorVoiceSchema.optional(),
  language: lessonLanguageSchema.optional(),
  subject: z
    .enum([
      "math",
      "science",
      "english",
      "history",
      "geography",
      "computer_science",
      "languages",
      "other",
    ])
    // "other" = adapt-to-the-material: honest default for the conversational
    // flow (the tutor infers the subject), and it matches the welcome board's
    // "Auto / other" pill. Explicit selection stays available board-side.
    .default("other"),
  // Optional (not defaulted) so a student profile's grade-level default can
  // win; the route falls back to middle_school when neither is set.
  gradeLevel: z
    .enum(["elementary", "middle_school", "high_school", "college"])
    .optional(),
  mode: z.enum(["learn", "homework", "practice", "review"]).default("homework"),
  helpLevel: z
    .enum(["socratic", "hints", "step_by_step", "direct"])
    .default("socratic"),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z.object({
  title: z.string().max(200).optional(),
  extractedProblem: z.string().optional(),
  currentGoal: z.string().optional(),
  originalImagePath: z.string().optional(),
  status: z.enum(["active", "completed", "abandoned"]).optional(),
  subject: z
    .enum([
      "math",
      "science",
      "english",
      "history",
      "geography",
      "computer_science",
      "languages",
      "other",
    ])
    .optional(),
  gradeLevel: z
    .enum(["elementary", "middle_school", "high_school", "college"])
    .optional(),
  helpLevel: z.enum(["socratic", "hints", "step_by_step", "direct"]).optional(),
  mode: z.enum(["learn", "homework", "practice", "review"]).optional(),
  /** Per-session persona & voice memory (roadmap): board pill edits the lesson. */
  persona: tutorPersonaSchema.optional(),
  voice: tutorVoiceSchema.optional(),
  language: lessonLanguageSchema.optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

// ---------- Problem input (PRD §5.2) ----------

export const textProblemSchema = z.object({
  text: z.string().min(1).max(5000),
});
export type TextProblemInput = z.infer<typeof textProblemSchema>;

export const extractionResultSchema = z.object({
  text: z.string(),
  entities: z.array(
    z.object({
      kind: z.enum(["variable", "equation", "diagram", "answer_choice"]),
      value: z.string(),
    }),
  ),
  unclear: z.boolean(),
  unclearNote: z.string().optional(),
});
export type ExtractionResultSchema = z.infer<typeof extractionResultSchema>;

// ---------- Whiteboard operations (PRD §5.4) ----------
// All coordinates are integers in the normalized 0–1000 space.

const coord = z.number().int().min(0).max(1000);
const point = z.tuple([coord, coord]);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();
const label = z.string().max(300).optional();

/**
 * Chalk content kind (user spec): every line of chalk declares what it IS —
 * a question, a fact, an answer/verdict, or an explanation — and the board
 * renders each kind in its own chalk color (also used by the PDF export).
 */
export const chalkKindSchema = z.enum(["question", "fact", "answer", "explanation"]);
export type ChalkKind = z.infer<typeof chalkKindSchema>;

export const whiteboardOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("write"),
    payload: z.object({
      x: coord,
      y: coord,
      text: z.string().min(1).max(600),
      color,
      kind: chalkKindSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("draw_equation"),
    payload: z.object({
      x: coord,
      y: coord,
      latex: z.string().min(1).max(600),
      color,
      kind: chalkKindSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("highlight"),
    payload: z.object({ target: z.string().min(1).max(600) }),
  }),
  z.object({
    type: z.literal("circle"),
    payload: z.object({ cx: coord, cy: coord, rx: coord, ry: coord, label, color }),
  }),
  z.object({
    type: z.literal("underline"),
    payload: z.object({ from: point, to: point, label, color }),
  }),
  z.object({
    type: z.literal("arrow"),
    payload: z.object({ from: point, to: point, label, color }),
  }),
  z.object({
    type: z.literal("line"),
    payload: z.object({ from: point, to: point, label, color }),
  }),
  z.object({
    type: z.literal("rectangle"),
    payload: z.object({ x: coord, y: coord, w: coord, h: coord, label, color }),
  }),
  z.object({
    type: z.literal("clear_region"),
    payload: z.object({ region: z.enum(["all", "tutor", "student"]) }),
  }),
  z.object({
    // Tutor-fetched lesson visual (user spec §6–§11): a real educational
    // image (Wikipedia/Wikimedia) or generated illustration pinned to the
    // board. The URL must be https and point at an image; the renderer
    // sizes it defensively (no layout trust in model-provided dimensions).
    // `credit` carries the source attribution (spec §11); `focus` is a
    // relative (0–1) rectangle the tutor is currently explaining — the
    // renderer draws an annotation ring there so speech and visual stay
    // synchronized (spec §8–§9).
    type: z.literal("image"),
    payload: z.object({
      url: z.string().url().regex(/^https:\/\//),
      x: coord,
      y: coord,
      w: coord,
      label: z.string().max(300).optional(),
      credit: z.string().max(200).optional(),
      focus: z
        .object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0).max(1),
          h: z.number().min(0).max(1),
        })
        .optional(),
    }),
  }),
]);
export type WhiteboardOp = z.infer<typeof whiteboardOpSchema>;

// ---------- Tutor response (PRD §9 — strict schema) ----------

/**
 * Accepts both op shapes and normalizes to { type, payload }:
 * - nested:   { type: "write", payload: { x, y, text } }  (canonical)
 * - flat:     { type: "write", x, y, text }               (free models emit this often)
 * Free models frequently use the flat shape (and sometimes invent op types);
 * without normalization one malformed op would fail the whole response and
 * drop the turn into the text fallback, losing both the message formatting
 * and the chalk. Envelope-level validation stays permissive (type: string) so
 * a bad op is dropped per-op by whiteboardOpSchema instead of killing the
 * turn — whiteboard correctness is enforced there, not here.
 */
const opEnvelope = z
  .object({
    type: z.string(),
    payload: z.record(z.unknown()).optional(),
  })
  .passthrough()
  .transform(({ type, payload, ...rest }) => ({
    type,
    payload: payload ?? (rest as Record<string, unknown>),
  }));

export const tutorResponseSchema = z.object({
  message: z.string().min(1),
  response_type: z.enum([
    "diagnostic",
    "question",
    "hint",
    "partial_step",
    "explanation",
    "summary",
  ]),
  student_action: z.string().optional(),
  hint_level: z.number().int().min(0).max(5),
  detected_progress: z.string().optional(),
  misconception: z.string().optional(),
  should_draw: z.boolean(),
  whiteboard_operations: z.array(opEnvelope),
  answer_revealed: z.boolean(),
  // --- Conversational study features (user expansion, ADR-0006) ---
  /** The learning topic the student stated, when the session had none yet. */
  topic: z.string().max(300).optional(),
  /** The tutor's live subject classification (user spec: pill reflects it). */
  subject: z
    .enum([
      "math",
      "science",
      "english",
      "history",
      "geography",
      "computer_science",
      "languages",
      "other",
    ])
    .optional(),
  /** A quiz question the tutor wants answered by the student. */
  quiz: z
    .object({
      question: z.string().min(1).max(600),
      choices: z.array(z.string().max(200)).max(6).optional(),
      answer: z.string().min(1).max(600),
    })
    .optional(),
  /** The tutor's grading of the previously posed quiz question. */
  quiz_grading: z
    .object({
      correct: z.boolean(),
      feedback: z.string().min(1).max(1000),
    })
    .optional(),
  /** Flashcards generated from the material covered so far. */
  flashcards: z
    .array(z.object({ front: z.string().min(1).max(300), back: z.string().min(1).max(600) }))
    .max(12)
    .optional(),
});
export type TutorResponse = z.infer<typeof tutorResponseSchema>;

/** Loose variant used for the repair attempt (more permissive, still typed). */
export const tutorRepairSchema = tutorResponseSchema.partial({
  response_type: true,
  hint_level: true,
  should_draw: true,
  whiteboard_operations: true,
  answer_revealed: true,
});

// ---------- Student message (PRD §5.3) ----------

// ---------- Student tutoring profile (self-improving personalization) ----------

/**
 * One saved tutoring preference (user spec: "Student Tutoring Profile").
 * Stored as a short imperative line the prompt can quote verbatim, with a
 * category so the manager UI groups them, and a source so the student can
 * see WHY it exists (their own feedback vs a confirmed repeated pattern).
 * The core tutor never changes — this layer only personalizes it.
 */
export const tutorPreferenceSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(3).max(240),
  category: z.enum([
    "explanation",
    "pacing",
    "problem_solving",
    "examples",
    "interaction",
    "voice",
    "other",
  ]),
  source: z.enum(["feedback", "pattern"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TutorPreference = z.infer<typeof tutorPreferenceSchema>;

/**
 * Feedback interpretation result (the pipeline: feedback → intent →
 * preference → behavior). `scope` decides where it lands:
 * - "session": a one-off wish for THIS lesson only ("today I want to test
 *   myself, no hints") — never saved to the profile;
 * - "long_term": a durable teaching preference — saved (deduped).
 * Ambiguous feedback resolves to "session" (safer, per spec §3).
 */
export const feedbackInterpretationSchema = z.object({
  scope: z.enum(["session", "long_term"]),
  preferences: z
    .array(
      z.object({
        text: z.string().min(3).max(240),
        category: tutorPreferenceSchema.shape.category,
      }),
    )
    .max(6),
  /** Short human confirmation of what changed (spec §6). */
  confirmation: z.string().min(3).max(300),
  /** Set when new feedback REPLACES an older preference (spec §5). */
  replacedCount: z.number().int().min(0).default(0),
});
export type FeedbackInterpretation = z.infer<typeof feedbackInterpretationSchema>;

export const feedbackInputSchema = z.object({
  text: z.string().min(3).max(2000),
  /** Which session the feedback came from (context for the interpreter). */
  sessionId: z.string().optional(),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export const studentMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  inputType: z.enum(["text", "voice", "image"]).default("text"),
  requestedHintLevel: z.number().int().min(0).max(5).optional(),
  forceDirectAnswer: z.boolean().default(false),
  /**
   * Warm re-entry (user spec): the student was away long enough that the
   * tutor nudged them, and this message is their return. The tutor then
   * OPENS with a one-breath recap of the last board step before answering,
   * so the student never re-enters the lesson lost.
   */
  returnedAfterAbsence: z.boolean().default(false),
});
export type StudentMessageInput = z.infer<typeof studentMessageSchema>;

// ---------- Student whiteboard ops (PRD §5.4 student drawing) ----------

/**
 * Student ops extend the model vocabulary with freehand ink ("draw").
 * The MODEL is restricted to the nine PRD §5.4 types (tutorResponseSchema);
 * "draw" exists so student pen strokes can persist (ADR-0003).
 */
export const studentOpSchema = z.object({
  type: z.enum([
    "write",
    "draw_equation",
    "highlight",
    "circle",
    "underline",
    "arrow",
    "line",
    "rectangle",
    "clear_region",
    "image",
    "draw",
  ]),
  payload: z.record(z.unknown()),
});
export type StudentOpInput = z.infer<typeof studentOpSchema>;

// ---------- App settings (PRD §7 AppSettings) ----------

export const appSettingsSchema = z.object({
  llmProvider: z.enum(["ollama", "openrouter", "mock"]).default("ollama"),
  ollamaBaseUrl: z.string().url().optional(),
  ollamaModel: z.string().optional(),
  ollamaVisionModel: z.string().optional(),
  openRouterModel: z.string().optional(),
  openRouterApiKeyConfigured: z.boolean().default(false),
  sttProvider: z.enum(["browser", "whisper_local", "none"]).default("browser"),
  ttsProvider: z.enum(["browser", "piper_local", "none"]).default("browser"),
  // On by default (user spec): the tutor SPEAKS unless explicitly muted —
  // this is a voice-first product; off was the silent-tutor bug.
  autoSpeak: z.boolean().default(true),
  /** Continuous voice conversation (ADR-0005): auto-listen, caption, auto-commit. */
  voiceMode: z.boolean().default(false),
  /** Tutor teaching persona — shapes the prompt's tone guidance. */
  tutorPersona: tutorPersonaSchema.default("friendly"),
  /** Tutor TTS voice gender preference (user spec: female option). */
  tutorVoice: tutorVoiceSchema.default("auto"),
  /**
   * Lesson language (roadmap: multilingual). "auto" mirrors the student's
   * language; an explicit code pins the whole lesson to it.
   */
  lessonLanguage: lessonLanguageSchema.default("auto"),
  /**
   * Adaptive persona (roadmap): let the tutor read the room — encouraging
   * when the student struggles, playful when they cruise. The base persona
   * above stays the student's choice; this toggles only the overlay.
   */
  adaptivePersona: z.boolean().default(true),
  /**
   * Student-inactivity nudge (human tutor patience): how long the tutor waits
   * after asking something before it gently checks in — conversational, one
   * time, never marking the student wrong and never revealing the answer.
   * 0 disables the nudge entirely. Clamped to a sane band in the repo.
   */
  nudgeTimeoutSeconds: z.number().int().min(0).max(600).default(120),
  telemetryEnabled: z.boolean().default(false),
});
export type AppSettingsSchema = z.infer<typeof appSettingsSchema>;

export const updateAppSettingsSchema = appSettingsSchema.partial();
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

// ---------- Engagement events (parent view: quiet/resume patterns) ----------

export const engagementEventSchema = z.object({
  sessionId: z.string().min(1),
  profileId: z.string().optional(),
  subject: z.string().max(60).optional(),
  kind: z.enum(["nudge_fired", "resumed"]),
  rung: z.number().int().min(1).max(9).optional(),
  quietSeconds: z.number().int().min(0).max(86_400).optional(),
  resumedVia: z.enum(["typed", "spoke", "tapped"]).optional(),
});
export type EngagementEventInputSchema = z.infer<typeof engagementEventSchema>;

// ---------- Messages ----------

export const messageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(["student", "tutor", "system"]),
  content: z.string(),
  inputType: z.enum(["text", "voice", "image"]).optional(),
  responseType: z
    .enum([
      "diagnostic",
      "question",
      "hint",
      "partial_step",
      "explanation",
      "summary",
    ])
    .optional(),
  hintLevel: z.number().int().min(0).max(5).optional(),
  answerRevealed: z.boolean().optional(),
  // Gamification / study-tool extras (ADR-0006).
  /** Award XP for a correct quiz answer or good progress (server-computed). */
  xpAwarded: z.number().int().min(0).optional(),
  quizGrading: z.object({ correct: z.boolean(), feedback: z.string() }).optional(),
  flashcards: z
    .array(z.object({ front: z.string(), back: z.string() }))
    .optional(),
  quiz: z
    .object({
      question: z.string(),
      choices: z.array(z.string()).optional(),
      answer: z.string(),
    })
    .optional(),
  /** True when this turn is the tutor's opening greeting for a fresh session. */
  isGreeting: z.boolean().optional(),
  /** The tutor's live subject guess (user spec: pill must reflect the actual material). */
  subject: z
    .enum([
      "math",
      "science",
      "english",
      "history",
      "geography",
      "computer_science",
      "languages",
      "other",
    ])
    .optional(),
  createdAt: z.string(),
});
export type MessageSchema = z.infer<typeof messageSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  subject: z
    .enum([
      "math",
      "science",
      "english",
      "history",
      "geography",
      "computer_science",
      "languages",
      "other",
    ]),
  gradeLevel: z
    .enum(["elementary", "middle_school", "high_school", "college"])
    .optional(),
  mode: z.enum(["learn", "homework", "practice", "review"]),
  helpLevel: z.enum(["socratic", "hints", "step_by_step", "direct"]),
  originalImagePath: z.string().optional(),
  extractedProblem: z.string().optional(),
  currentGoal: z.string().optional(),
  status: z.enum(["active", "completed", "abandoned"]),
  provider: z.string(),
  model: z.string(),
  /** Cumulative XP for gamification (ADR-0006). */
  xp: z.number().int().min(0).default(0),
  /** Cumulative quiz score: [correct, asked]. */
  quizScore: z.tuple([z.number().int().min(0), z.number().int().min(0)]).default([0, 0]),
  /** Per-session persona & voice memory (roadmap): snapshot of how this
   *  lesson was taught, so reopening restores the exact experience. */
  persona: tutorPersonaSchema.optional(),
  voice: tutorVoiceSchema.optional(),
  language: lessonLanguageSchema.optional(),
  /** Owning student profile (roadmap: multi-student local profiles). */
  profileId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionSchema = z.infer<typeof sessionSchema>;

export const whiteboardOperationSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  messageId: z.string().optional(),
  actor: z.enum(["student", "tutor"]),
  type: z.enum([
    "write",
    "draw_equation",
    "highlight",
    "circle",
    "underline",
    "arrow",
    "line",
    "rectangle",
    "clear_region",
    "image",
    "draw",
  ]),
  payload: z.record(z.unknown()),
  createdAt: z.string(),
});
export type WhiteboardOperationSchema = z.infer<typeof whiteboardOperationSchema>;

// ---------- Student profiles (roadmap: multi-student local profiles) ----------

/** A local student profile: who is standing at the chalkboard right now. */
export const profileSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  /** Optional per-profile defaults applied when this student starts a lesson. */
  defaultPersona: tutorPersonaSchema.optional(),
  defaultVoice: tutorVoiceSchema.optional(),
  defaultLanguage: lessonLanguageSchema.optional(),
  defaultGradeLevel: z
    .enum(["elementary", "middle_school", "high_school", "college"])
    .optional(),
  createdAt: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

export const createProfileSchema = z.object({
  name: z.string().min(1).max(60),
  defaultPersona: tutorPersonaSchema.optional(),
  defaultVoice: tutorVoiceSchema.optional(),
  defaultLanguage: lessonLanguageSchema.optional(),
  defaultGradeLevel: z
    .enum(["elementary", "middle_school", "high_school", "college"])
    .optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = createProfileSchema.partial();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------- Spaced repetition (roadmap: SRS flashcard review) ----------

/**
 * SM-2-inspired interval bookkeeping for one flashcard. Stored keyed by
 * (profile, front) so mastery scheduling survives restarts without a new
 * table (same KV pattern as stats).
 */
export const srsCardSchema = z.object({
  front: z.string(),
  /** Consecutive correct reviews (0 = new/learning). */
  reps: z.number().int().min(0).default(0),
  /** SM-2 easiness factor, clamped to [1.3, 2.5]. */
  ef: z.number().min(1.3).max(2.5).default(2.5),
  /** Current interval in days (0 = due immediately). */
  intervalDays: z.number().int().min(0).default(0),
  /** ISO date-time when the card is next due. */
  dueAt: z.string(),
  lastReviewedAt: z.string().optional(),
});
export type SrsCard = z.infer<typeof srsCardSchema>;

export const srsGradeSchema = z.object({
  /** The card's front text (cards are identified by their front). */
  front: z.string().min(1).max(300),
  /** 0 = forgot · 1 = hard · 2 = good · 3 = easy (matches the flashcard modal). */
  grade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});
export type SrsGradeInput = z.infer<typeof srsGradeSchema>;

// ---------- Handwriting practice (roadmap: student chalks, tutor grades) ----------

export const handwritingGradeSchema = z.object({
  /** What the student was asked to write (the prompt they saw). */
  prompt: z.string().min(1).max(1000),
  /** The student's expected answer, if the tutor knows it (guides grading). */
  expected: z.string().max(1000).optional(),
  /** What the student actually wrote on the board (free text/ink). */
  written: z.string().min(1).max(2000),
  /**
   * Optional capture of the actual board (PNG data URL). Vision-capable
   * providers read the real handwriting from it; without it, grading works
   * from the typed transcription alone.
   */
  imageDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
});
export type HandwritingGradeInput = z.infer<typeof handwritingGradeSchema>;

export const handwritingFeedbackSchema = z.object({
  /** What the tutor read from the board — the student confirms the reading. */
  readAs: z.string().min(1).max(2000),
  /** Overall verdict. */
  verdict: z.enum(["correct", "partially_correct", "incorrect", "unreadable"]),
  /** Encouraging, specific feedback: legibility, accuracy, next step. */
  feedback: z.string().min(1).max(1000),
  /** Did the answer content match what was asked? */
  correct: z.boolean(),
  /** Legibility score 0–100 (model-estimated from the written text). */
  legibility: z.number().int().min(0).max(100),
});
export type HandwritingFeedback = z.infer<typeof handwritingFeedbackSchema>;

// ---------- Study link import (roadmap: Classroom / Moodle / any URL) ----------

export const importLinkSchema = z.object({
  url: z.string().url().max(2000),
});
export type ImportLinkInput = z.infer<typeof importLinkSchema>;

// ---------- Study stats (ADR-0007 gamification) ----------

export const badgeIdSchema = z.enum([
  "first_correct",
  "streak_3",
  "streak_5",
  "quiz_5",
  "xp_100",
  "cards_10",
]);
export type BadgeId = z.infer<typeof badgeIdSchema>;

export const studyStatsSchema = z.object({
  /** Consecutive days with at least one correct answer. */
  dailyStreak: z.number().int().min(0).default(0),
  bestDailyStreak: z.number().int().min(0).default(0),
  /** Local calendar day (YYYY-MM-DD) of the last correct answer. */
  lastStudyDate: z.string().optional(),
  /** Current / best consecutive correct answers (across sessions). */
  answerStreak: z.number().int().min(0).default(0),
  bestAnswerStreak: z.number().int().min(0).default(0),
  totalCorrect: z.number().int().min(0).default(0),
  totalXp: z.number().int().min(0).default(0),
  badges: z.array(badgeIdSchema).default([]),
  /** Flashcard fronts the student has marked as mastered (voice or manual). */
  masteredFlashcards: z.array(z.string()).default([]),
  updatedAt: z.string().optional(),
});
export type StudyStatsSchema = z.infer<typeof studyStatsSchema>;
