/**
 * SQLite connection (WAL) with schema bootstrap. For a local single-user app,
 * idempotent CREATE IF NOT EXISTS migrations keep setup friction zero.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  subject TEXT NOT NULL,
  grade_level TEXT,
  mode TEXT NOT NULL,
  help_level TEXT NOT NULL,
  original_image_path TEXT,
  extracted_problem TEXT,
  current_goal TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  input_type TEXT,
  response_type TEXT,
  hint_level INTEGER,
  answer_revealed INTEGER,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages (session_id, created_at);

CREATE TABLE IF NOT EXISTS whiteboard_ops (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS whiteboard_ops_session_idx ON whiteboard_ops (session_id, seq);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  question TEXT NOT NULL,
  correct INTEGER NOT NULL,
  feedback TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_results_session_idx ON quiz_results (session_id, created_at);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_persona TEXT,
  default_voice TEXT,
  default_language TEXT,
  default_grade_level TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  profile_id TEXT,
  subject TEXT,
  kind TEXT NOT NULL,
  rung INTEGER,
  quiet_seconds INTEGER,
  resumed_via TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS engagement_events_created_idx ON engagement_events (created_at);

-- Student Tutoring Profile (self-improving personalization): one row per
-- saved preference. Scope=long_term feedback (and confirmed patterns) only —
-- session-scoped wishes never land here. Owned by the profile so each
-- student personalizes their own tutor; NULL profile = the shared learner.
CREATE TABLE IF NOT EXISTS tutor_preferences (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tutor_preferences_profile_idx ON tutor_preferences (profile_id);

-- Repeated-behavior signals (spec §8): every hint request / simplify request
-- bumps a counter; above CONFIRM_THRESHOLD the UI offers the student a
-- one-tap confirm to promote the pattern into a real preference.
CREATE TABLE IF NOT EXISTS behavior_patterns (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL
);
`;

export function createDb(databaseFile: string): Db {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  const sqlite = new Database(databaseFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(BOOTSTRAP);
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

/**
 * Column migrations for pre-existing databases (ADR-0006). SQLite ALTER TABLE
 * ADD COLUMN is not idempotent, so each is guarded by a pragma check.
 */
function migrate(sqlite: Database.Database): void {
  const additions: Record<string, Array<[string, string]>> = {
    sessions: [
      ["xp", "INTEGER NOT NULL DEFAULT 0"],
      ["quiz_correct", "INTEGER NOT NULL DEFAULT 0"],
      ["quiz_asked", "INTEGER NOT NULL DEFAULT 0"],
      // Per-session persona & voice memory + profile ownership (roadmap).
      ["persona", "TEXT"],
      ["voice", "TEXT"],
      ["language", "TEXT"],
      ["profile_id", "TEXT"],
    ],
    messages: [
      ["xp_awarded", "INTEGER"],
      ["quiz_grading", "TEXT"],
      ["flashcards", "TEXT"],
      ["quiz", "TEXT"],
      ["is_greeting", "INTEGER"],
      ["subject", "TEXT"],
    ],
  };
  for (const [table, columnsToAdd] of Object.entries(additions)) {
    const existing = new Set(
      (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name),
    );
    for (const [name, def] of columnsToAdd) {
      if (!existing.has(name)) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def};`);
      }
    }
  }
}
