/**
 * Student Tutoring Profile routes (self-improving personalization).
 *
 * - POST   /api/feedback          — interpret + apply (session vs long-term)
 * - GET    /api/preferences       — list the student's saved preferences
 * - POST   /api/preferences       — add a preference manually
 * - PATCH  /api/preferences/:id   — edit a preference's wording
 * - DELETE /api/preferences/:id   — remove one
 * - DELETE /api/preferences       — turn personalization off (reset all)
 * - GET    /api/preferences/patterns — repeated-behavior signals awaiting confirm
 *
 * The student stays in control: every preference is visible, editable,
 * removable, and the whole layer can be wiped in one call (spec §7).
 * Long-term prefs attach to the CURRENT profile (multi-student aware).
 */
import type { FastifyInstance } from "fastify";
import {
  feedbackInputSchema,
  tutorPreferenceSchema,
} from "@local-live-tutor/shared";

import { Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

/** Pattern kinds the workspace reports, mapped to confirmable preference lines. */
export const PATTERN_PREFERENCE_TEXT: Record<string, { text: string; category: string }> = {
  hints: {
    text: "Offer hints before solutions; the student asks for hints often",
    category: "problem_solving",
  },
  simplify: {
    text: "Explain more simply; the student often asks to simplify",
    category: "explanation",
  },
};

export async function registerPreferenceRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  const currentProfileId = (): string | undefined => deps.profiles.getCurrent() ?? undefined;

  app.post("/api/feedback", async (request) => {
    const parsed = feedbackInputSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const session = parsed.data.sessionId
      ? deps.sessions.getById(parsed.data.sessionId)
      : undefined;
    const interpretation = await deps.feedback.interpret(
      parsed.data.text,
      session?.currentGoal ?? session?.extractedProblem,
    );

    if (interpretation.scope === "long_term") {
      let replaced = 0;
      for (const pref of interpretation.preferences) {
        const result = deps.preferences.add({
          profileId: currentProfileId(),
          text: pref.text,
          category: pref.category,
          source: "feedback",
        });
        replaced += result.replacedCount;
      }
      return {
        ...interpretation,
        replacedCount: replaced,
        saved: interpretation.preferences.length,
      };
    }
    // Session scope: returned so the UI can echo the confirmation; the
    // session-scoped lines ride the next turn via the session directive
    // (stored transiently on the session by the caller if needed).
    return { ...interpretation, saved: 0 };
  });

  app.get("/api/preferences", async () => {
    return { preferences: deps.preferences.list(currentProfileId()) };
  });

  app.post("/api/preferences", async (request) => {
    const parsed = tutorPreferenceSchema
      .pick({ text: true, category: true })
      .safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const { preference } = deps.preferences.add({
      profileId: currentProfileId(),
      text: parsed.data.text,
      category: parsed.data.category,
      source: "feedback",
    });
    return { preference };
  });

  app.patch("/api/preferences/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { text?: unknown };
    if (typeof body?.text !== "string" || body.text.trim().length < 3) {
      throw Errors.validation("text (min 3 chars) is required.");
    }
    const preference = deps.preferences.update(id, body.text);
    if (!preference) throw Errors.notFound("Preference");
    return { preference };
  });

  app.delete("/api/preferences/:id", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.preferences.remove(id)) throw Errors.notFound("Preference");
    return { removed: true };
  });

  app.delete("/api/preferences", async () => {
    const removed = deps.preferences.reset(currentProfileId());
    return { removed };
  });

  app.get("/api/preferences/patterns", async () => {
    const patterns = deps.preferences
      .listPatterns(currentProfileId())
      .filter((p) => p.count >= 3)
      .map((p) => ({
        kind: p.kind,
        count: p.count,
        suggested: PATTERN_PREFERENCE_TEXT[p.kind] ?? null,
      }));
    return { patterns };
  });

  app.post("/api/preferences/patterns/:kind/confirm", async (request) => {
    const { kind } = request.params as { kind: string };
    const suggested = PATTERN_PREFERENCE_TEXT[kind];
    if (!suggested) throw Errors.notFound("Pattern");
    const preference = deps.preferences.confirmPattern(
      currentProfileId(),
      kind,
      suggested.text,
      suggested.category as (typeof tutorPreferenceSchema.shape.category)["Values"] extends never
        ? never
        : Parameters<typeof deps.preferences.add>[0]["category"],
    );
    return { preference };
  });
}
