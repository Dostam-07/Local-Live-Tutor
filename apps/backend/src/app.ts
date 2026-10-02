/**
 * Fastify application factory (PRD §6.2 backend responsibilities).
 * Owns provider calls, validation, sessions, safety, and key secrecy.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { MessageRepo, SessionRepo } from "./db/repos/session.js";
import { QuizRepo } from "./db/repos/quiz.js";
import { ProfileRepo } from "./db/repos/profiles.js";
import { SettingsRepo } from "./db/repos/settings.js";
import { StudyStatsRepo } from "./db/repos/studyStats.js";
import { SrsRepo } from "./db/repos/srs.js";
import { WhiteboardRepo } from "./db/repos/whiteboard.js";
import { registerErrorHandler } from "./errors.js";
import { ProviderRegistry } from "./services/llm/registry.js";
import { EngagementRepo } from "./db/repos/engagement.js";
import { PreferencesRepo } from "./db/repos/preferences.js";
import { TutoringService } from "./services/tutoring/tutoring.js";
import { FeedbackInterpreter } from "./services/tutoring/feedback.js";
import { registerRoutes, type AppDeps } from "./routes/index.js";

export async function createApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const db = createDb(env.databaseFile);

  const sessions = new SessionRepo(db);
  const messages = new MessageRepo(db);
  const ops = new WhiteboardRepo(db);
  const quiz = new QuizRepo(db);
  const settings = new SettingsRepo(db);
  const studyStats = new StudyStatsRepo(db);
  const profiles = new ProfileRepo(db);
  const srs = new SrsRepo(db);
  const engagement = new EngagementRepo(db);
  const preferences = new PreferencesRepo(db);
  const registry = new ProviderRegistry(
    () => settings.get(),
    () => env.ALLOW_PROVIDER_FALLBACK,
  );
  const feedback = new FeedbackInterpreter(registry);
  const tutoring = new TutoringService({
    sessions,
    messages,
    ops,
    quiz,
    studyStats,
    registry,
    allowFallback: () => env.ALLOW_PROVIDER_FALLBACK,
    settings,
    profiles,
    srs,
    engagement,
    preferences,
  });

  const deps: AppDeps = {
    sessions,
    messages,
    ops,
    quiz,
    studyStats,
    profiles,
    srs,
    engagement,
    preferences,
    settings,
    registry,
    tutoring,
    feedback,
    allowFallback: () => env.ALLOW_PROVIDER_FALLBACK,
    sweepGraceMs: () => env.SWEEP_ABANDONED_MINUTES * 60_000,
    autoSaveIdleMs: () => env.AUTO_SAVE_IDLE_MINUTES * 60_000,
  };

  const app = Fastify({
    logger: true,
    bodyLimit: 15 * 1024 * 1024, // images arrive as base64 data URLs
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: false,
  });
  registerErrorHandler(app);
  await registerRoutes(app, deps);
  return app;
}
