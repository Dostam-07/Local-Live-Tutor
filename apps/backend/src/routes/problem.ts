/**
 * Problem input routes (PRD §11 Problem processing, §5.2, Milestone 3).
 * Images are accepted as data URLs (PNG/JPEG/WebP), size-limited, and stored
 * under the upload dir; extraction requires a vision-capable provider.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { textProblemSchema } from "@local-live-tutor/shared";

import { loadEnv } from "../config/env.js";
import { Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const imageProblemSchema = z.object({
  imageDataUrl: z.string().regex(DATA_URL, "image must be a PNG, JPEG, or WebP data URL"),
});

function saveImage(dataUrl: string, sessionId: string): { filePath: string; base64: string; mime: string } {
  const env = loadEnv();
  const match = dataUrl.match(DATA_URL);
  if (!match?.[1]) throw Errors.validation("Unsupported image format.");
  const mime = match[1] === "jpg" ? "jpeg" : match[1];
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw Errors.validation("Image exceeds the 8 MB limit.");
  }
  fs.mkdirSync(env.uploadDir, { recursive: true });
  const ext = mime === "jpeg" ? "jpg" : mime;
  const filePath = path.join(env.uploadDir, `${sessionId}.${ext}`);
  fs.writeFileSync(filePath, bytes);
  return { filePath, base64, mime: `image/${mime}` };
}

export async function registerProblemRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.post("/api/sessions/:id/problem/image", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const parsed = imageProblemSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());

    const { filePath, base64, mime } = saveImage(parsed.data.imageDataUrl, id);

    let extraction;
    try {
      extraction = await deps.tutoring.extractProblem(id, base64, mime);
    } catch (error) {
      // Extraction failure still records the image for manual entry (§5.2).
      deps.sessions.update(id, { originalImagePath: filePath });
      throw error;
    }
    const session = deps.sessions.update(id, {
      originalImagePath: filePath,
      extractedProblem: extraction.text,
    });
    return {
      session,
      extraction,
      imagePath: filePath,
    };
  });

  app.post("/api/sessions/:id/problem/text", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const parsed = textProblemSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const session = deps.sessions.update(id, {
      extractedProblem: parsed.data.text,
    });
    if (!session) throw Errors.notFound("Session");
    return { session, extraction: { text: parsed.data.text, entities: [], unclear: false } };
  });

  app.post("/api/sessions/:id/problem/confirm", async (request) => {
    const { id } = request.params as { id: string };
    const parsed = textProblemSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const session = deps.sessions.getById(id);
    if (!session) throw Errors.notFound("Session");
    // The tutor never starts before confirmation (PRD §5.2, §15).
    const updated = deps.sessions.update(id, {
      extractedProblem: parsed.data.text,
      currentGoal: "Diagnose what the student understands about the problem.",
    });
    return { session: updated, confirmed: true };
  });
}
