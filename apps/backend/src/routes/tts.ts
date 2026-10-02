/**
 * TTS routes (roadmap: language-accurate offline voices). Read-only listing
 * of the Piper voices installed on THIS machine per language, plus WAV
 * synthesis against the local Piper HTTP server. No auth (local-only app),
 * no mock audio — errors state exactly what is missing.
 */
import type { FastifyInstance } from "fastify";

import { loadEnv } from "../config/env.js";
import { Errors } from "../errors.js";
import {
  piperHealth,
  pickPiperVoice,
  scanPiperVoices,
  synthesizePiper,
} from "../services/tts/piper.js";
import type { AppDeps } from "./index.js";

export async function registerTtsRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  /**
   * GET /api/tts/voices — which languages have an offline voice installed?
   * Powers the Settings "offline voices" status and the frontend fallback
   * decision (a pinned Arabic lesson with `ar` in this list knows Piper can
   * voice it even when no browser voice pack exists).
   */
  app.get("/api/tts/voices", async () => {
    const env = loadEnv();
    const baseUrl = env.PIPER_TTS_URL;
    const voices = baseUrl ? scanPiperVoices(env.PIPER_VOICES_DIR) : [];
    const languages = Array.from(new Set(voices.map((v) => v.language))).sort();
    return {
      configured: Boolean(baseUrl),
      serverUp: baseUrl ? await piperHealth(baseUrl) : false,
      languages,
      voices: voices.map((v) => ({
        tag: v.tag,
        language: v.language,
        name: v.name,
        healthy: v.configPath !== null,
      })),
      detail: baseUrl
        ? undefined
        : "Set PIPER_TTS_URL in apps/backend/.env to enable offline voices.",
    };
  });

  /**
   * POST /api/tts { text, language } → audio/wav. Synthesizes through the
   * local Piper server when it is up AND a voice for the language exists;
   * 503 with a precise reason otherwise (the frontend then falls back to
   * browser voices — never silence, never fake audio).
   */
  app.post("/api/tts", async (request, reply) => {
    const env = loadEnv();
    const baseUrl = env.PIPER_TTS_URL;
    if (!baseUrl) {
      throw Errors.unavailable("Offline voices are not configured (PIPER_TTS_URL is unset).");
    }
    const body = (request.body ?? {}) as { text?: unknown; language?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const language = typeof body.language === "string" ? body.language : "en";
    if (!text) throw Errors.validation("text is required");
    if (text.length > 4000) throw Errors.validation("text too long (max 4000 chars)");

    const voice = pickPiperVoice(scanPiperVoices(env.PIPER_VOICES_DIR), language);
    if (!voice) {
      throw Errors.unavailable(`No Piper voice installed for "${language}".`);
    }
    if (!(await piperHealth(baseUrl))) {
      throw Errors.unavailable("The Piper server is not running (PIPER_TTS_URL unreachable).");
    }
    const wav = await synthesizePiper(baseUrl, text);
    reply.header("Content-Type", "audio/wav");
    reply.header("Content-Length", String(wav.byteLength));
    reply.header("X-Piper-Voice", voice.tag);
    return reply.send(wav);
  });
  void deps;
}
