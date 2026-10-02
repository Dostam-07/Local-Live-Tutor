/**
 * Route registration (PRD §11 API surface).
 */
import type { FastifyInstance } from "fastify";
import type {
  MessageRepo,
  SessionRepo,
} from "../db/repos/session.js";
import type { QuizRepo } from "../db/repos/quiz.js";
import type { ProfileRepo } from "../db/repos/profiles.js";
import type { SrsRepo } from "../db/repos/srs.js";
import type { EngagementRepo } from "../db/repos/engagement.js";
import type { PreferencesRepo } from "../db/repos/preferences.js";
import type { SettingsRepo } from "../db/repos/settings.js";
import type { StudyStatsRepo } from "../db/repos/studyStats.js";
import type { WhiteboardRepo } from "../db/repos/whiteboard.js";
import type { ProviderRegistry } from "../services/llm/registry.js";
import type { TutoringService } from "../services/tutoring/tutoring.js";
import type { FeedbackInterpreter } from "../services/tutoring/feedback.js";

export type AppDeps = {
  sessions: SessionRepo;
  messages: MessageRepo;
  ops: WhiteboardRepo;
  quiz: QuizRepo;
  studyStats: StudyStatsRepo;
  profiles: ProfileRepo;
  srs: SrsRepo;
  engagement: EngagementRepo;
  preferences: PreferencesRepo;
  settings: SettingsRepo;
  registry: ProviderRegistry;
  tutoring: TutoringService;
  feedback: FeedbackInterpreter;
  allowFallback: () => boolean;
  /** Abandoned-session sweep grace in ms; 0 disables the sweep. */
  sweepGraceMs: () => number;
  /** Idle auto-save window in ms; 0 disables auto-save. */
  autoSaveIdleMs: () => number;
};

export async function registerRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  // Abandoned-session sweep (user spec): dead sessions that never got a tutor
  // turn are removed on boot and lazily before every History listing, so the
  // list the student sees is always clean without a background timer.
  const graceMs = deps.sweepGraceMs();
  if (graceMs > 0) {
    try {
      const swept = deps.sessions.sweepAbandoned(graceMs);
      if (swept > 0) app.log.info(`Swept ${swept} abandoned session(s) at boot`);
    } catch (err) {
      app.log.warn({ err }, "Abandoned-session sweep failed at boot");
    }
  }
  // Idle auto-save (user spec): lessons silent past the window close gently —
  // History stays tidy, nothing is ever deleted.
  const idleMs = deps.autoSaveIdleMs();
  if (idleMs > 0) {
    try {
      const closed = deps.sessions.autoCompleteIdle(idleMs);
      if (closed > 0) app.log.info(`Auto-saved ${closed} idle lesson(s) at boot`);
    } catch (err) {
      app.log.warn({ err }, "Idle auto-save failed at boot");
    }
  }

  const { registerSessionRoutes } = await import("./sessions.js");
  const { registerProblemRoutes } = await import("./problem.js");
  const { registerTutoringRoutes } = await import("./tutoring.js");
  const { registerWhiteboardRoutes } = await import("./whiteboard.js");
  const { registerProviderRoutes } = await import("./providers.js");
  const { registerSpeechRoutes } = await import("./speech.js");
  const { registerStudyRoutes } = await import("./study.js");
  const { registerProfileRoutes } = await import("./profiles.js");
  const { registerTtsRoutes } = await import("./tts.js");
  const { registerPreferenceRoutes } = await import("./preferences.js");

  await registerSessionRoutes(app, deps);
  await registerProblemRoutes(app, deps);
  await registerTutoringRoutes(app, deps);
  await registerWhiteboardRoutes(app, deps);
  await registerProviderRoutes(app, deps);
  await registerSpeechRoutes(app, deps);
  await registerStudyRoutes(app, deps);
  await registerProfileRoutes(app, deps);
  await registerTtsRoutes(app, deps);
  await registerPreferenceRoutes(app, deps);
}
