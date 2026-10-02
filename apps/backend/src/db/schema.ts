/**
 * Drizzle schema — PRD §7 data model (B3 of the execution plan).
 * WAL mode is enabled in db/client.ts.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title"),
  subject: text("subject").notNull(),
  gradeLevel: text("grade_level"),
  mode: text("mode").notNull(),
  helpLevel: text("help_level").notNull(),
  originalImagePath: text("original_image_path"),
  extractedProblem: text("extracted_problem"),
  currentGoal: text("current_goal"),
  status: text("status").notNull().default("active"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  // Gamification (ADR-0006).
  xp: integer("xp").notNull().default(0),
  quizCorrect: integer("quiz_correct").notNull().default(0),
  quizAsked: integer("quiz_asked").notNull().default(0),
  // Per-session persona & voice memory (roadmap): how THIS lesson is taught.
  persona: text("persona"),
  voice: text("voice"),
  language: text("language"),
  // Owning student profile (roadmap: multi-student local profiles).
  profileId: text("profile_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Local student profiles (roadmap: multi-student local profiles). */
export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  defaultPersona: text("default_persona"),
  defaultVoice: text("default_voice"),
  defaultLanguage: text("default_language"),
  defaultGradeLevel: text("default_grade_level"),
  createdAt: text("created_at").notNull(),
});

/** Student Tutoring Profile (self-improving personalization). */
export const tutorPreferences = sqliteTable("tutor_preferences", {
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  text: text("text").notNull(),
  category: text("category").notNull(),
  source: text("source").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Repeated-behavior signals (spec §8) — pattern → confirm → preference. */
export const behaviorPatterns = sqliteTable("behavior_patterns", {
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  kind: text("kind").notNull(),
  count: integer("count").notNull().default(0),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    inputType: text("input_type"),
    responseType: text("response_type"),
    hintLevel: integer("hint_level"),
    answerRevealed: integer("answer_revealed", { mode: "boolean" }),
    // Study-feature extras (ADR-0006), stored as JSON columns.
    xpAwarded: integer("xp_awarded"),
    quizGrading: text("quiz_grading", { mode: "json" }),
    flashcards: text("flashcards", { mode: "json" }),
    quiz: text("quiz", { mode: "json" }),
    isGreeting: integer("is_greeting", { mode: "boolean" }),
    /** The tutor's live subject classification for the pill (user spec). */
    subject: text("subject"),
    provider: text("provider"),
    model: text("model"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    messages_session_idx: index("messages_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);

export const whiteboardOps = sqliteTable(
  "whiteboard_ops",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    messageId: text("message_id"),
    actor: text("actor").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    seq: integer("seq").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    whiteboard_ops_session_idx: index("whiteboard_ops_session_idx").on(
      table.sessionId,
      table.seq,
    ),
  }),
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

/**
 * Engagement events (parent view: quiet/resume patterns per subject). One row
 * per inactivity nudge cycle: the tutor goes quiet-waiting, fires a nudge
 * (with how long the student was quiet and how far up the escalation ladder
 * it got), and the student eventually resumes (with the gap back to
 * activity). Local-only telemetry the FAMILY records about itself.
 */
export const engagementEvents = sqliteTable(
  "engagement_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    profileId: text("profile_id"),
    subject: text("subject"),
    /** "nudge_fired" | "resumed". */
    kind: text("kind").notNull(),
    /** Escalation rung: 1=space, 2=hint offer, 3+=sub-step offer. */
    rung: integer("rung"),
    /** Seconds the student was quiet before this event. */
    quietSeconds: integer("quiet_seconds"),
    /** Student's next action after resuming ("typed", "spoke", "tapped"). */
    resumedVia: text("resumed_via"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    engagementEventsCreatedIdx: index("engagement_events_created_idx").on(table.createdAt),
  }),
);

/** Per-question quiz outcomes for the gamified score and the lesson export. */
export const quizResults = sqliteTable(
  "quiz_results",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    messageId: text("message_id"),
    question: text("question").notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    feedback: text("feedback"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    quizResultsSessionIdx: index("quiz_results_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);

export const dbVersion = sql`SELECT 1`;
