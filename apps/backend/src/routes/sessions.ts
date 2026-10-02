/**
 * Session routes (PRD §11 Sessions) — no auth, local only.
 */
import type { FastifyInstance } from "fastify";
import {
  createSessionSchema,
  updateSessionSchema,
} from "@local-live-tutor/shared";

import { Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

export async function registerSessionRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.post("/api/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const settings = deps.settings.get();
    // Multi-student profiles (roadmap): the session belongs to the active
    // profile, and the profile's defaults (persona, voice, language, grade)
    // prefill anything the student didn't explicitly set.
    const currentProfileId = deps.profiles.getCurrent();
    const profile = currentProfileId ? deps.profiles.getById(currentProfileId) : undefined;
    const session = deps.sessions.create({
      ...parsed.data,
      gradeLevel: parsed.data.gradeLevel ?? profile?.defaultGradeLevel ?? "middle_school",
      // Profile defaults fill ONLY what the student did not explicitly set —
      // spreading `undefined` over parsed.data silently discarded the
      // language/persona/voice picked on the welcome board (user bug: Hindi
      // and other languages never applied). `??` keeps the explicit choice.
      persona: parsed.data.persona ?? profile?.defaultPersona,
      voice: parsed.data.voice ?? profile?.defaultVoice,
      language: parsed.data.language ?? profile?.defaultLanguage,
      profileId: profile?.id,
      provider: settings.llmProvider,
      model:
        settings.llmProvider === "ollama"
          ? (settings.ollamaModel ?? "unselected")
          : settings.llmProvider === "openrouter"
            ? (settings.openRouterModel ?? "unselected")
            : "mock-socratic-1",
    });
    reply.status(201).send(session);
  });

  app.get("/api/sessions", async () => {
    // Lazy sweep: History is always rendered from a clean list (user spec).
    const graceMs = deps.sweepGraceMs();
    if (graceMs > 0) {
      try {
        deps.sessions.sweepAbandoned(graceMs);
      } catch {
        // Never block listing on sweep failure.
      }
    }
    // Idle auto-save (user spec): lessons silent past the window are gently
    // closed before listing, so History shows a tidy, finished picture.
    const idleMs = deps.autoSaveIdleMs();
    if (idleMs > 0) {
      try {
        deps.sessions.autoCompleteIdle(idleMs);
      } catch {
        // Never block listing on auto-save failure.
      }
    }
    // Profile scoping (roadmap): when a profile is active, History shows that
    // student's lessons only; with no profiles (solo mode) everything shows.
    const currentProfileId = deps.profiles.getCurrent();
    return deps.sessions.list(100, currentProfileId);
  });

  app.get("/api/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const session = deps.sessions.getById(id);
    if (!session) throw Errors.notFound("Session");
    return session;
  });

  app.patch("/api/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const parsed = updateSessionSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const session = deps.sessions.update(id, parsed.data);
    if (!session) throw Errors.notFound("Session");
    return session;
  });

  app.delete("/api/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deps.sessions.delete(id);
    if (!deleted) throw Errors.notFound("Session");
    reply.status(204).send();
  });

  /** Privacy: wipe every local session (PRD §13 "Delete all local data"). */
  app.delete("/api/sessions", async (_request, reply) => {
    const count = deps.sessions.deleteAll();
    reply.status(200).send({ deleted: count });
  });
}
