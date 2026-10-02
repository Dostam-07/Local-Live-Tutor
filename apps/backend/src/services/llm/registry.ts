/**
 * Provider factory/registry (PRD §5.7). Selects the configured provider with
 * optional explicit-consent fallback, and exposes health/capability queries.
 */
import type { AppSettings, ProviderHealth } from "@local-live-tutor/shared";
import { loadEnv } from "../../config/env.js";
import { Errors } from "../../errors.js";
import { MockProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";
import type { LLMProvider } from "./types.js";

export class ProviderRegistry {
  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly allowFallback: () => boolean,
  ) {}

  /** Builds the provider instance for the effective settings. */
  build(providerId?: string, modelOverride?: string): LLMProvider {
    const env = loadEnv();
    const settings = this.getSettings();
    const selected = providerId ?? settings.llmProvider;

    switch (selected) {
      case "mock":
        return new MockProvider();
      case "ollama": {
        const model = modelOverride ?? settings.ollamaModel ?? env.OLLAMA_MODEL;
        if (!model) {
          throw Errors.internal("No Ollama model configured. Select one in settings.");
        }
        // Ollama vision parity (roadmap): a dedicated vision model (e.g.
        // qwen2.5vl) handles photo-of-homework reading while the chat model
        // stays small and fast. Defaults to the chat model when unset.
        return new OllamaProvider(
          settings.ollamaBaseUrl ?? env.OLLAMA_BASE_URL,
          model,
          settings.ollamaVisionModel ?? env.OLLAMA_VISION_MODEL,
        );
      }
      case "openrouter": {
        const key = env.OPENROUTER_API_KEY;
        // Free-models only (user requirement): the pool resolves live from
        // OpenRouter's catalog (:free, zero-cost chat models). OPENROUTER_MODEL
        // can pin a single free model; non-free pins are ignored.
        const explicit = modelOverride ?? settings.openRouterModel ?? env.OPENROUTER_MODEL;
        const fallbackPool = (env.OPENROUTER_FREE_MODELS ??
          "google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-26b-a4b-it:free")
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m.endsWith(":free"));
        return new OpenRouterProvider(env.OPENROUTER_BASE_URL, key ?? "", fallbackPool);
      }
      default:
        throw Errors.internal(`Unknown provider: ${String(selected)}`);
    }
  }

  /**
   * Resolves a usable provider: tries the selection; if unavailable and the
   * user consented to fallback, tries the next in PRD priority order
   * (ollama → openrouter → mock). Never silently leaves the selected provider.
   */
  async resolve(
    providerId?: string,
    modelOverride?: string,
  ): Promise<{ provider: LLMProvider; fellBack: boolean }> {
    const primary = this.build(providerId, modelOverride);
    const health = await primary.healthCheck();
    if (health.available) return { provider: primary, fellBack: false };

    if (!this.allowFallback()) {
      if (primary.id === "ollama") {
        throw Errors.ollamaUnreachable(
          this.getSettings().ollamaBaseUrl ?? loadEnv().OLLAMA_BASE_URL,
        );
      }
      return { provider: primary, fellBack: false };
    }

    const order: Array<"ollama" | "openrouter" | "mock"> = [
      "ollama",
      "openrouter",
      "mock",
    ];
    for (const candidate of order) {
      if (candidate === primary.id) continue;
      try {
        const next = this.build(candidate);
        const candidateHealth = await next.healthCheck();
        if (candidateHealth.available) {
          return { provider: next, fellBack: true };
        }
      } catch {
        // Try the next candidate.
      }
    }
    return { provider: primary, fellBack: false };
  }

  async health(providerId?: string): Promise<ProviderHealth> {
    try {
      const provider = this.build(providerId);
      return await provider.healthCheck();
    } catch (error) {
      return {
        provider: (providerId ?? this.getSettings().llmProvider) as ProviderHealth["provider"],
        available: false,
        detail: error instanceof Error ? error.message : "Provider error.",
      };
    }
  }
}
