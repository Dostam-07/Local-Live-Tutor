/**
 * Environment configuration (PRD §5.7, §19). Zod-parsed with local-first
 * defaults; the OpenRouter key stays server-side only.
 *
 * A local `.env` file (apps/backend/.env) is loaded if present — simple
 * KEY=VALUE lines, no shell interpolation — so the app works without a
 * dotenv dependency. Real environment variables take precedence.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

function loadDotEnvIntoProcess(): void {
  // Tests provide their own environment; never leak developer .env into them.
  if (process.env.NODE_ENV === "test") return;
  const envFile = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Treats empty-string env vars as unset (avoids PORT="" → 0). */
const emptyToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

const envSchema = z.object({
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().default(8787)).transform(
    (port) => (port === 0 ? 8787 : port),
  ),
  HOST: z.preprocess(emptyToUndefined, z.string().default("127.0.0.1")),
  CORS_ORIGIN: z.preprocess(emptyToUndefined, z.string().default("http://localhost:5173")),
  LLM_PROVIDER: z.preprocess(
    emptyToUndefined,
    // "mock" exists ONLY as internal test infrastructure (vitest, Playwright
    // E2E). It is never a default and never a valid user-facing choice: real
    // tutoring data comes from a real model — no mock data, ever (user policy).
    z.enum(["ollama", "openrouter", "mock"]).default("openrouter"),
  ),
  OLLAMA_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default("http://localhost:11434"),
  ),
  OLLAMA_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  OLLAMA_VISION_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENROUTER_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default("https://openrouter.ai/api/v1"),
  ),
  OPENROUTER_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENROUTER_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Comma-separated free-model allowlist; rotation order = preference order. */
  OPENROUTER_FREE_MODELS: z.preprocess(emptyToUndefined, z.string().optional()),
  ALLOW_PROVIDER_FALLBACK: z
    .preprocess(emptyToUndefined, z.string().default("false"))
    .transform((v) => v === "true"),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().default("./data/tutor.sqlite")),
  UPLOAD_DIR: z.preprocess(emptyToUndefined, z.string().default("./data/uploads")),
  /**
   * Piper local TTS (roadmap: language-accurate offline voices). PIPER_TTS_URL
   * is the running Piper HTTP server (python -m piper.http_server); unset =
   * the feature is off and the app uses browser voices. PIPER_VOICES_DIR is
   * the voice-model directory used for per-language availability listing.
   */
  PIPER_TTS_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  PIPER_VOICES_DIR: z.preprocess(emptyToUndefined, z.string().default("./data/piper-voices")),
  /** Abandoned-session sweep grace period in minutes (0 disables the sweep). */
  SWEEP_ABANDONED_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).default(60),
  ),
  /**
   * Idle auto-save (user spec): lessons silent this many minutes are gently
   * closed as "completed · paused" (History stays tidy, nothing is deleted).
   * 0 disables. Default 10 minutes.
   */
  AUTO_SAVE_IDLE_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).default(10),
  ),
  /**
   * Educational image sourcing (user spec §6–§11): where lesson visuals come
   * from. "auto" = real educational sources (Wikipedia/Wikimedia Commons)
   * first, generated illustration as fallback. "web" = real sources only (no
   * fallback). "generated" = generated only. "off" = no images.
   */
  IMAGE_SOURCE_MODE: z.preprocess(
    emptyToUndefined,
    z.enum(["auto", "web", "generated", "off"]).default("auto"),
  ),
  /** Timeout in ms for educational image lookups (never block a turn long). */
  IMAGE_LOOKUP_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(500).max(15000).default(4000),
  ),
});

export type Env = z.infer<typeof envSchema> & {
  databaseFile: string;
  uploadDir: string;
};

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  loadDotEnvIntoProcess();
  const parsed = envSchema.parse(process.env);
  cached = {
    ...parsed,
    databaseFile: path.resolve(parsed.DATABASE_URL),
    uploadDir: path.resolve(parsed.UPLOAD_DIR),
  };
  return cached;
}

/** Test helper: resets the cached env. */
export function resetEnvCache(): void {
  cached = null;
}
