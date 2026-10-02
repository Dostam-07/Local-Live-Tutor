/**
 * Speech routes (PRD §11 Speech, §5.5, §5.6).
 *
 * MVP: the browser handles STT (Web Speech) and TTS (SpeechSynthesis)
 * client-side. These endpoints exist for local Whisper/Piper integrations and
 * degrade with the PRD §14 speech_unavailable state when nothing is configured.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { loadEnv } from "../config/env.js";
import { Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

const synthesizeSchema = z.object({
  text: z.string().min(1).max(4000),
  voice: z.string().optional(),
  speed: z.number().min(0.5).max(3).optional(),
});

export async function registerSpeechRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.post("/api/speech/transcribe", async (_request, _reply) => {
    const env = loadEnv();
    const settings = deps.settings.get();
    if (settings.sttProvider === "whisper_local") {
      // A local faster-whisper/whisper.cpp sidecar can be wired here; when the
      // endpoint is not configured we surface the §14 state instead of hanging.
      const configuredUrl = process.env.WHISPER_URL;
      if (configuredUrl) {
        try {
          const response = await fetch(`${configuredUrl}/transcribe`, {
            method: "POST",
            body: new Uint8Array(_request.body as Buffer),
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return (await response.json()) as unknown;
        } catch {
          throw Errors.speechUnavailable(
            "The local Whisper service could not transcribe this recording.",
          );
        }
      }
    }
    throw Errors.speechUnavailable(
      "No server-side transcription is configured. Use browser voice input or type instead.",
    );
  });

  app.post("/api/speech/synthesize", async (request) => {
    const parsed = synthesizeSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const settings = deps.settings.get();
    if (settings.ttsProvider !== "piper_local" || !process.env.PIPER_URL) {
      throw Errors.speechUnavailable(
        "No server-side speech synthesis is configured. Browser speech will be used instead.",
      );
    }
    try {
      const response = await fetch(`${process.env.PIPER_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as unknown;
    } catch {
      throw Errors.speechUnavailable("The local Piper service is not responding.");
    }
  });
}
