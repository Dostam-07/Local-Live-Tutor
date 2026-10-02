/**
 * Provider + settings routes (PRD §11 Health, §12 capability detection, §7
 * AppSettings). The OpenRouter key is never returned — only its configured
 * boolean (PRD §13, §15: keys never exposed in responses).
 */
import type { FastifyInstance } from "fastify";
import { updateAppSettingsSchema } from "@local-live-tutor/shared";

import { loadEnv } from "../config/env.js";
import { Errors } from "../errors.js";
import type { AppDeps } from "./index.js";

export async function registerProviderRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.get("/api/health", async () => {
    return { ok: true, time: new Date().toISOString() };
  });

  app.get("/api/providers/health", async (request) => {
    const query = request.query as { provider?: string };
    const health = await deps.registry.health(query.provider);
    const settings = deps.settings.get();
    const fallback = deps.allowFallback();
    return {
      primary: health,
      fallbackAllowed: fallback,
      effective: {
        provider: settings.llmProvider,
        model:
          settings.llmProvider === "ollama"
            ? (settings.ollamaModel ?? "unselected")
            : settings.llmProvider === "openrouter"
              ? (settings.openRouterModel ?? "unselected")
              : "mock-socratic-1",
      },
      capabilities: {
        text: true,
        vision: Boolean(
          settings.llmProvider === "ollama"
            ? settings.ollamaVisionModel
            : settings.llmProvider === "openrouter",
        ),
        streaming: true,
        structuredOutput: true,
      },
    };
  });

  app.get("/api/providers/models", async (request) => {
    const query = request.query as { provider?: string };
    try {
      const provider = deps.registry.build(query.provider);
      const models = (await provider.listModels?.()) ?? [];
      return { models };
    } catch (error) {
      return {
        models: [],
        detail: error instanceof Error ? error.message : "Could not list models.",
      };
    }
  });

  app.get("/api/settings", async () => {
    return deps.settings.get();
  });

  app.patch("/api/settings", async (request) => {
    const parsed = updateAppSettingsSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    // No mock data ever (user policy): the mock provider is internal test
    // infrastructure only and cannot be selected at runtime. Test suites
    // (NODE_ENV=test) may still patch to it for determinism.
    if (parsed.data.llmProvider === "mock" && process.env.NODE_ENV !== "test") {
      throw Errors.validation("The mock provider is reserved for automated tests. Choose Ollama or OpenRouter.");
    }
    // Key-related fields are ignored server-side (env-only).
    const patch = { ...parsed.data } as Record<string, unknown>;
    delete patch.openRouterApiKeyConfigured;
    return deps.settings.update(patch as never);
  });
}
