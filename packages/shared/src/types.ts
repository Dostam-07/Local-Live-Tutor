/**
 * Shared domain types — single source of truth (PRD §7).
 * Types are derived from the Zod schemas in schemas.ts where possible.
 */
import type {
  ChalkKind,
  LessonLanguage,
  Profile,
  StudyStatsSchema,
  TutorPersona,
  TutorVoice,
} from "./schemas.js";

export type StudyStats = StudyStatsSchema;
export type { Profile, LessonLanguage };

// ---------- Session (PRD §7 Session) ----------

export const SUBJECTS = [
  "math",
  "science",
  "english",
  "history",
  "geography",
  "computer_science",
  "languages",
  "other",
] as const;
export type Subject = (typeof SUBJECTS)[number];

export const GRADE_LEVELS = [
  "elementary",
  "middle_school",
  "high_school",
  "college",
] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const SESSION_MODES = [
  "learn",
  "homework",
  "practice",
  "review",
] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const HELP_LEVELS = [
  "socratic",
  "hints",
  "step_by_step",
  "direct",
] as const;
export type HelpLevel = (typeof HELP_LEVELS)[number];

export const SESSION_STATUSES = ["active", "completed", "abandoned"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type Session = {
  id: string;
  title?: string;
  subject: Subject;
  gradeLevel?: GradeLevel;
  mode: SessionMode;
  helpLevel: HelpLevel;
  originalImagePath?: string;
  extractedProblem?: string;
  currentGoal?: string;
  status: SessionStatus;
  provider: string;
  model: string;
  /** Cumulative XP (ADR-0006). */
  xp: number;
  /** Cumulative quiz results: [correct, asked]. */
  quizScore: [number, number];
  /** Per-session persona & voice memory (roadmap): how THIS lesson is taught.
   *  Falls back to app settings when unset (older sessions). */
  persona?: TutorPersona;
  voice?: TutorVoice;
  language?: LessonLanguage;
  /** Owning student profile (roadmap: multi-student local profiles). */
  profileId?: string;
  createdAt: string;
  updatedAt: string;
};

// ---------- Message (PRD §7 Message) ----------

export const MESSAGE_ROLES = ["student", "tutor", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const INPUT_TYPES = ["text", "voice", "image"] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const RESPONSE_TYPES = [
  "diagnostic",
  "question",
  "hint",
  "partial_step",
  "explanation",
  "summary",
] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

// ---------- Study features & gamification (ADR-0006) ----------

export type Quiz = {
  question: string;
  choices?: string[];
  answer: string;
};

export type QuizGrading = {
  correct: boolean;
  feedback: string;
};

export type Flashcard = { front: string; back: string };

/** Badge metadata for the gamification UI (ADR-0007). */
export type BadgeInfo = { id: string; label: string; icon: string; description: string };

export const BADGES: BadgeInfo[] = [
  { id: "first_correct", label: "First Win", icon: "🌟", description: "Answered a quiz question correctly" },
  { id: "streak_3", label: "On Fire", icon: "🔥", description: "3 correct answers in a row" },
  { id: "streak_5", label: "Unstoppable", icon: "⚡", description: "5 correct answers in a row" },
  { id: "quiz_5", label: "Quiz Regular", icon: "🎯", description: "5 quiz questions answered" },
  { id: "xp_100", label: "Century", icon: "💯", description: "Earned 100 XP total" },
  { id: "cards_10", label: "Card Shark", icon: "🃏", description: "Mastered 10 flashcards" },
];

export type LessonExport = {
  session: Session;
  title: string;
  problem: string | null;
  transcript: Array<{
    role: "student" | "tutor";
    content: string;
    responseType?: ResponseType;
    createdAt: string;
  }>;
  boardLines: string[];
  /** Every board op in order (actor + text + content kind) — how the lesson
   *  unfolded. Kind drives both board chalk colors and the PDF color coding. */
  chalkLog: Array<{
    actor: "student" | "tutor";
    type: string;
    text: string;
    kind?: ChalkKind;
  }>;
  quizResults: Array<{ question: string; correct: boolean; feedback: string }>;
  flashcards: Array<Flashcard & { mastered?: boolean }>;
  xp: number;
  quizScore: [number, number];
  /** Cumulative study stats (ADR-0007): streaks, badges, mastered cards. */
  stats: StudyStats;
  /** How many times the student asked for a hint this session. */
  hintsTaken: number;
};

export type Message = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  inputType?: InputType;
  responseType?: ResponseType;
  hintLevel?: number;
  answerRevealed?: boolean;
  /** Study-feature extras (ADR-0006). */
  xpAwarded?: number;
  quizGrading?: { correct: boolean; feedback: string };
  flashcards?: Flashcard[];
  quiz?: Quiz;
  /** True on the tutor's opening greeting turn for a fresh session. */
  isGreeting?: boolean;
  /** The tutor's live subject classification for the pill (user spec). */
  subject?: Subject;
  createdAt: string;
};

// ---------- Whiteboard (PRD §7 WhiteboardOperation, §5.4 op format) ----------

/**
 * Model-facing vocabulary is the nine PRD §5.4 types; "draw" (freehand ink)
 * exists for student input persistence only (ADR-0003).
 */
export const WHITEBOARD_OP_TYPES = [
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
] as const;
export type WhiteboardOpType = (typeof WHITEBOARD_OP_TYPES)[number];

export const WHITEBOARD_ACTORS = ["student", "tutor"] as const;
export type WhiteboardActor = (typeof WHITEBOARD_ACTORS)[number];

/** Chalk color palette (user spec): color-coded content kinds so a glance
 *  separates questions from facts, verdicts, and explanations. Student ink
 *  stays pink regardless of kind. Consumed by the board renderer AND the
 *  PDF export headings/accents. */
export const CHALK_KIND_COLORS = {
  question: "#7FD1FF",
  fact: "#F4F7F2",
  answer: "#8CE99A",
  explanation: "#FBD870",
} as const;
export type ChalkKindColor = (typeof CHALK_KIND_COLORS)[ChalkKind];

export type WhiteboardOperation = {
  id: string;
  sessionId: string;
  messageId?: string;
  actor: WhiteboardActor;
  type: WhiteboardOpType;
  payload: Record<string, unknown>;
  createdAt: string;
};

// ---------- App settings (PRD §7 AppSettings) ----------

export const LLM_PROVIDER_IDS = ["ollama", "openrouter", "mock"] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export const STT_PROVIDER_IDS = ["browser", "whisper_local", "none"] as const;
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

export const TTS_PROVIDER_IDS = ["browser", "piper_local", "none"] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

export type AppSettings = {
  llmProvider: LlmProviderId;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaVisionModel?: string;
  openRouterModel?: string;
  /** Boolean only — the raw key never leaves the backend. */
  openRouterApiKeyConfigured: boolean;
  sttProvider: SttProviderId;
  ttsProvider: TtsProviderId;
  autoSpeak: boolean;
  /** Continuous voice conversation (ADR-0005): auto-listen, caption, auto-commit. */
  voiceMode: boolean;
  /** Tutor teaching persona (user spec) — shapes the prompt's tone. */
  tutorPersona: TutorPersona;
  /** Tutor TTS voice gender preference (user spec: female option). */
  tutorVoice: TutorVoice;
  /** Lesson language (roadmap: multilingual lessons). "auto" mirrors the student. */
  lessonLanguage: LessonLanguage;
  /** Adaptive persona (roadmap): tutor reads the room around the base persona. */
  adaptivePersona: boolean;
  /**
   * Student-inactivity nudge (seconds the tutor waits before gently checking
   * in while a student response is awaited; 0 disables). Default 120.
   */
  nudgeTimeoutSeconds: number;
  telemetryEnabled: boolean;
};

// ---------- Provider health (PRD §12) ----------

export type ProviderHealth = {
  provider: LlmProviderId;
  available: boolean;
  detail?: string;
  models?: ModelInfo[];
};

export type ModelInfo = {
  name: string;
  supportsVision?: boolean;
  supportsStreaming?: boolean;
};

export type ModelCapabilities = {
  text: boolean;
  vision: boolean;
  streaming: boolean;
  structuredOutput: boolean;
};

// ---------- Extraction (PRD §5.2) ----------

export type DetectedEntity = {
  kind: "variable" | "equation" | "diagram" | "answer_choice";
  value: string;
};

export type ExtractionResult = {
  text: string;
  entities: DetectedEntity[];
  unclear: boolean;
  unclearNote?: string;
};

// ---------- Speech (PRD §5.5, §5.6) ----------

export type Transcription = {
  text: string;
  confidence?: number;
};

// ---------- Engagement events (parent view: quiet/resume patterns) ----------

/** A local engagement event the tutor records about a quiet spell. */
export type EngagementEvent = {
  id: string;
  sessionId: string;
  profileId?: string;
  subject?: string;
  /** "nudge_fired" = tutor checked in; "resumed" = student came back. */
  kind: "nudge_fired" | "resumed";
  /** Escalation rung reached (1=space, 2=hint offer, 3+=sub-step offer). */
  rung?: number;
  /** Seconds quiet before the event. */
  quietSeconds?: number;
  /** How the student resumed ("typed" | "spoke" | "tapped"). */
  resumedVia?: string;
  createdAt: string;
};

export type EngagementEventInput = Omit<EngagementEvent, "id" | "createdAt">;

/** Aggregated engagement patterns for the parent view. */
export type EngagementSummary = {
  quietSpells: number;
  avgQuietSeconds: number;
  longestQuietSeconds: number;
  resumes: number;
  avgResumeSeconds: number;
  perSubject: Array<{
    subject: string;
    quietSpells: number;
    avgQuietSeconds: number;
    resumes: number;
    deepestRung: number;
  }>;
  recentQuietSpells: Array<{
    sessionId: string;
    subject?: string;
    rung: number;
    quietSeconds: number;
    resumed: boolean;
    at: string;
  }>;
};

// ---------- API error envelope ----------

export type ApiErrorCode =
  | "ollama_unreachable"
  | "model_missing"
  | "vision_unsupported"
  | "invalid_model_response"
  | "ocr_unclear"
  | "speech_unavailable"
  | "tts_unavailable"
  | "rate_limited"
  | "validation_error"
  | "not_found"
  | "internal_error";

export type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};
