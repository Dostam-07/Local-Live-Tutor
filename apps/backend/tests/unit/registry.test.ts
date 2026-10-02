import { describe, expect, it } from "vitest";
import type { AppSettings } from "@local-live-tutor/shared";

import { ProviderRegistry } from "../../src/services/llm/registry.js";

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  llmProvider: "mock",
  openRouterApiKeyConfigured: false,
  sttProvider: "browser",
  ttsProvider: "browser",
  autoSpeak: false,
  telemetryEnabled: false,
  ...over,
});

describe("ProviderRegistry selection (PRD §5.7)", () => {
  it("builds the mock provider", () => {
    const registry = new ProviderRegistry(() => settings({ llmProvider: "mock" }), () => false);
    const provider = registry.build();
    expect(provider.id).toBe("mock");
  });

  it("builds an Ollama provider from settings", () => {
    const registry = new ProviderRegistry(
      () => settings({ llmProvider: "ollama", ollamaBaseUrl: "http://localhost:11434", ollamaModel: "qwen2.5:7b" }),
      () => false,
    );
    const provider = registry.build();
    expect(provider.id).toBe("ollama");
    expect(provider.model).toBe("qwen2.5:7b");
  });

  it("refuses to build Ollama without a configured model (never hardcode)", () => {
    const registry = new ProviderRegistry(
      () => settings({ llmProvider: "ollama", ollamaModel: undefined }),
      () => false,
    );
    expect(() => registry.build()).toThrowError(/No Ollama model configured/);
  });

  it("refuses OpenRouter without a key", () => {
    const registry = new ProviderRegistry(
      () => settings({ llmProvider: "openrouter", openRouterModel: "m" }),
      () => false,
    );
    expect(() => registry.build()).not.toThrow();
    const provider = registry.build();
    expect(provider.id).toBe("openrouter");
  });

  it("does not fall back silently when consent is off", async () => {
    const registry = new ProviderRegistry(
      () => settings({ llmProvider: "ollama", ollamaBaseUrl: "http://127.0.0.1:9", ollamaModel: "m" }),
      () => false,
    );
    await expect(registry.resolve()).rejects.toMatchObject({
      code: "ollama_unreachable",
    });
  });

  it("falls back to the mock provider only with explicit consent", async () => {
    const registry = new ProviderRegistry(
      () => settings({ llmProvider: "ollama", ollamaBaseUrl: "http://127.0.0.1:9", ollamaModel: "m" }),
      () => true,
    );
    const { provider, fellBack } = await registry.resolve();
    expect(fellBack).toBe(true);
    expect(provider.id).toBe("mock");
  });
});
