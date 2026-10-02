/**
 * App settings repository (PRD §7 AppSettings). Key/JSON-value store; the raw
 * OpenRouter key is intentionally NOT persisted here (server-side env/config
 * only; settings expose only the configured boolean, PRD §13).
 */
import { eq } from "drizzle-orm";
import type { AppSettings } from "@local-live-tutor/shared";

import { loadEnv } from "../../config/env.js";
import type { Db } from "../client.js";
import { appSettings as settingsTable } from "../schema.js";

const SETTINGS_KEY = "app";

/**
 * Sane band for the inactivity nudge (user spec: ~1–2 min default, but the
 * knob is real): under 15s would badger the student; over 10 minutes and it
 * is effectively off anyway — store it as explicitly disabled instead.
 */
function clampNudgeTimeout(raw: unknown): number {
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 120;
  if (seconds <= 0) return 0;
  return Math.min(600, Math.max(15, seconds));
}

const DEFAULTS: AppSettings = {
  llmProvider: "ollama",
  ollamaBaseUrl: undefined,
  ollamaModel: undefined,
  ollamaVisionModel: undefined,
  openRouterModel: undefined,
  openRouterApiKeyConfigured: false,
  sttProvider: "browser",
  ttsProvider: "browser",
  autoSpeak: true,
  voiceMode: true,
  tutorPersona: "friendly",
  tutorVoice: "auto",
  lessonLanguage: "auto",
  adaptivePersona: true,
  nudgeTimeoutSeconds: 120,
  telemetryEnabled: false,
};

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  /**
   * Effective settings: DB overrides over env-derived defaults. The configured
   * boolean for the OpenRouter key is derived from the server-side env, never
   * from the browser.
   */
  get(): AppSettings {
    const env = loadEnv();
    const row = this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, SETTINGS_KEY))
      .get();
    const stored = (row?.value ?? {}) as Partial<AppSettings>;
    const merged: AppSettings = {
      ...DEFAULTS,
      llmProvider: stored.llmProvider ?? env.LLM_PROVIDER,
      ollamaBaseUrl: stored.ollamaBaseUrl ?? env.OLLAMA_BASE_URL,
      ollamaModel: stored.ollamaModel ?? env.OLLAMA_MODEL,
      ollamaVisionModel: stored.ollamaVisionModel ?? env.OLLAMA_VISION_MODEL,
      openRouterModel: stored.openRouterModel ?? env.OPENROUTER_MODEL,
      openRouterApiKeyConfigured: Boolean(env.OPENROUTER_API_KEY),
      sttProvider: stored.sttProvider ?? "browser",
      ttsProvider: stored.ttsProvider ?? "browser",
      autoSpeak: stored.autoSpeak ?? true,
      voiceMode: stored.voiceMode ?? true,
      tutorPersona: stored.tutorPersona ?? "friendly",
      tutorVoice: stored.tutorVoice ?? "auto",
      lessonLanguage: stored.lessonLanguage ?? "auto",
      adaptivePersona: stored.adaptivePersona ?? true,
      nudgeTimeoutSeconds: clampNudgeTimeout(stored.nudgeTimeoutSeconds),
      telemetryEnabled: stored.telemetryEnabled ?? false,
    };
    return merged;
  }

  /** Merges a partial update; key-related fields are ignored/derived server-side. */
  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const next: AppSettings = {
      ...current,
      ...patch,
      // Never accept key material or its boolean from the client.
      openRouterApiKeyConfigured: Boolean(loadEnv().OPENROUTER_API_KEY),
    };
    this.db
      .insert(settingsTable)
      .values({ key: SETTINGS_KEY, value: next })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: next },
      })
      .run();
    return this.get();
  }
}
