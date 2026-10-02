/**
 * Tutoring routes (PRD §11 Tutoring).
 * - POST /messages                → JSON response with the full turn result.
 * - POST /messages/stream         → SSE: `delta` events, then `done`/`error`.
 * Both share the same backend pipeline; streaming only adds progressive text.
 */
import type { FastifyInstance } from "fastify";
import { studentMessageSchema } from "@local-live-tutor/shared";

import { AppError, Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

export async function registerTutoringRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  const parseBody = (request: { body: unknown; params: unknown }) => {
    const { id } = (request.params ?? {}) as { id: string };
    const parsed = studentMessageSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    return { id, input: parsed.data };
  };

  app.post("/api/sessions/:id/messages", async (request, reply) => {
    const { id, input } = parseBody(request);
    const result = await deps.tutoring.handleStudentMessage(id, input);
    reply.status(201).send(result);
  });

  app.post("/api/sessions/:id/messages/stream", async (request, reply) => {
    const { id, input } = parseBody(request);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const close = (event: string, data: unknown) => {
      send(event, data);
      reply.raw.end();
    };

    try {
      const result = await deps.tutoring.handleStudentMessage(
        id,
        input,
        (delta) => {
          send("delta", { text: delta });
        },
      );
      close("done", result);
    } catch (error) {
      if (error instanceof AppError) {
        close("error", {
          error: { code: error.code, message: error.message, details: error.details },
        });
      } else {
        request.log.error(error);
        close("error", {
          error: { code: "internal_error", message: "Unexpected server error." },
        });
      }
    }
    return reply;
  });

  /** Lesson opener (ADR-0005): tutor chalks the problem + asks its first question. */
  app.post("/api/sessions/:id/open", async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const close = (event: string, data: unknown) => {
      send(event, data);
      reply.raw.end();
    };

    try {
      const result = await deps.tutoring.openLesson(id, (delta) => {
        send("delta", { text: delta });
      });
      close("done", result);
    } catch (error) {
      if (error instanceof AppError) {
        close("error", {
          error: { code: error.code, message: error.message, details: error.details },
        });
      } else {
        request.log.error(error);
        close("error", {
          error: { code: "internal_error", message: "Unexpected server error." },
        });
      }
    }
    return reply;
  });

  app.post("/api/sessions/:id/summary", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const message = await deps.tutoring.generateSummary(id);
    // Recap completes the session (PRD Flow A step 12-13).
    deps.sessions.update(id, { status: "completed" });
    return message;
  });

  /**
   * End-of-lesson ritual (ADR-0009), streamed: the tutor erases the board,
   * chalks a compact recap takeaway, and speaks the sign-off. SSE mirrors
   * /messages/stream: `delta` events, then a full `done` payload with the
   * whiteboard ops so the client can run the choreography.
   */
  app.post("/api/sessions/:id/recap", async (request, reply) => {
    const { id } = (request.params ?? {}) as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const close = (event: string, data: unknown) => {
      send(event, data);
      reply.raw.end();
    };

    try {
      const result = await deps.tutoring.recapLesson(id, (delta) => {
        send("delta", { text: delta });
      });
      close("done", result);
    } catch (error) {
      if (error instanceof AppError) {
        close("error", {
          error: { code: error.code, message: error.message, details: error.details },
        });
      } else {
        request.log.error(error);
        close("error", {
          error: { code: "internal_error", message: "Unexpected server error." },
        });
      }
    }
    return reply;
  });

  app.get("/api/sessions/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    return deps.messages.listBySession(id);
  });
}
