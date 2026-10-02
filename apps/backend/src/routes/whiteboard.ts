/**
 * Whiteboard routes (PRD §11 Whiteboard). Every op — tutor- or
 * student-originated — is schema-validated before persistence.
 */
import type { FastifyInstance } from "fastify";
import { studentOpSchema, whiteboardOpSchema } from "@local-live-tutor/shared";

import { Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

export async function registerWhiteboardRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.get("/api/sessions/:id/whiteboard", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    return { operations: deps.ops.listBySession(id) };
  });

  app.post("/api/sessions/:id/whiteboard/operations", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const body = request.body as { operations?: unknown };
    const rawOps = Array.isArray(body?.operations) ? body.operations : [];
    if (rawOps.length === 0) throw Errors.validation("operations[] is required.");

    const validated = [];
    for (const raw of rawOps) {
      const parsed = studentOpSchema.safeParse(raw);
      if (!parsed.success) {
        // Invalid model-generated (or malformed) ops are rejected safely (§15).
        throw Errors.validation(parsed.error.flatten());
      }
      const typed = whiteboardOpSchema.safeParse(parsed.data);
      if (!typed.success) throw Errors.validation(typed.error.flatten());
      validated.push(typed.data);
    }

    const created = deps.ops.appendMany(
      validated.map((op) => ({
        sessionId: id,
        actor: "student" as const,
        type: op.type,
        payload: op.payload,
      })),
    );
    reply.status(201).send({ operations: created });
  });

  app.delete("/api/sessions/:id/whiteboard", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const deleted = deps.ops.deleteBySession(id);
    return { deleted };
  });
}
