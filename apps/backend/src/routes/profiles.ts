/**
 * Profile routes (roadmap: multi-student local profiles). Local-only CRUD
 * plus the "switch active profile" pointer. No auth — this is a single-device
 * family app, matching the rest of the product.
 */
import type { FastifyInstance } from "fastify";
import { createProfileSchema, updateProfileSchema } from "@local-live-tutor/shared";

import { Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

export async function registerProfileRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.get("/api/profiles", async () => {
    return { profiles: deps.profiles.list(), currentProfileId: deps.profiles.getCurrent() ?? null };
  });

  app.post("/api/profiles", async (request, reply) => {
    const parsed = createProfileSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const profile = deps.profiles.create(parsed.data);
    // First profile created becomes active immediately (solo users upgrade
    // seamlessly); afterwards switching is explicit.
    if (deps.profiles.list().length === 1) deps.profiles.setCurrent(profile.id);
    reply.status(201).send(profile);
  });

  app.patch("/api/profiles/:id", async (request) => {
    const { id } = request.params as { id: string };
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    return deps.profiles.update(id, parsed.data);
  });

  app.delete("/api/profiles/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deps.profiles.delete(id);
    if (!deleted) throw Errors.notFound("Profile");
    reply.status(204).send();
  });

  /** Switch the active profile — the whole app (history, stats) follows. */
  app.post("/api/profiles/:id/activate", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.profiles.getById(id)) throw Errors.notFound("Profile");
    deps.profiles.setCurrent(id);
    return { ok: true, currentProfileId: id };
  });
}
