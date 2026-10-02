/**
 * OpenRouter provider (PRD §5.7 priority 2) with a **dynamic free-model pool**.
 *
 * Requirement: use all of OpenRouter's free LLMs — nothing paid, ever. The
 * pool is resolved live from OpenRouter's `/models` catalog (zero-cost chat
 * models only), cached for 10 minutes, with per-model cooldowns on failures.
 * A small static fallback list covers catalog-fetch outages. The API key is
 * read from server-side env only and never returned to the browser.
 */
import { AppError, Errors } from "../../errors.js";
import type { ModelInfo, ProviderHealth } from "@local-live-tutor/shared";
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  VisionRequest,
  VisionResponse,
} from "./types.js";

/** OpenAI-style message with optional image content parts. */
type OpenAiMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

type CatalogModel = {
  id?: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; input_modalities?: string[] };
};

const MODEL_COOLDOWN_MS = 60_000;
const POOL_TTL_MS = 10 * 60_000;
const POOL_SIZE = 8;

/** Known-good free fallbacks if the catalog cannot be fetched. */
const FALLBACK_POOL = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-26b-a4b-it:free",
];

/** Non-chat / special-purpose models that would break tutoring JSON. */
const EXCLUDE_PATTERN =
  /content-safety|moderation|embed|rerank|guard|safety|whisper|tts|voice|clip|vision-only/i;

export class OpenRouterProvider implements LLMProvider {
  readonly id = "openrouter";

  private readonly fallbackPool: string[];
  private static poolCache: { models: string[]; at: number } | null = null;
  /** Free models that accept image input (ADR-0008 photo-of-homework). */
  private static visionPoolCache: { models: string[]; at: number } | null = null;
  private static catalogCache: {
    models: CatalogModel[];
    at: number;
  } | null = null;
  private static cooldowns = new Map<string, number>();
  /** Last model actually used (for health display). */
  private lastUsed = "";

  get model(): string {
    return this.lastUsed || this.fallbackPool[0] || "openrouter/free-pool";
  }

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    fallbackPool: string[],
  ) {
    const free = fallbackPool.filter((m) => m.endsWith(":free"));
    this.fallbackPool = free.length > 0 ? free : FALLBACK_POOL;
  }

  /** Fetches + caches the model catalog (10 min TTL). */
  private async catalog(): Promise<CatalogModel[]> {
    const now = Date.now();
    if (
      OpenRouterProvider.catalogCache &&
      now - OpenRouterProvider.catalogCache.at < POOL_TTL_MS
    ) {
      return OpenRouterProvider.catalogCache.models;
    }
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw Errors.internal(`OpenRouter catalog returned HTTP ${response.status}.`);
    }
    const data = (await response.json()) as { data?: CatalogModel[] };
    const models = data.data ?? [];
    OpenRouterProvider.catalogCache = { models, at: now };
    return models;
  }

  /** Resolves the free chat-model pool, preferring larger/general models. */
  private async pool(): Promise<string[]> {
    const now = Date.now();
    if (
      OpenRouterProvider.poolCache &&
      now - OpenRouterProvider.poolCache.at < POOL_TTL_MS
    ) {
      return OpenRouterProvider.poolCache.models;
    }
    try {
      const catalog = await this.catalog();
      const isFree = (m: CatalogModel) =>
        Boolean(m.id) &&
        m.id!.endsWith(":free") &&
        m.pricing?.prompt === "0" &&
        m.pricing?.completion === "0" &&
        !EXCLUDE_PATTERN.test(m.id!);
      const free = catalog.filter(isFree).map((m) => m.id!) as string[];
      // Prefer instruct-style general models first; keep the pool small enough
      // that rotation stays fast but wide enough to dodge rate limits.
      const preferred = free.filter((id) =>
        /gemma|nemotron|inkling|ling|nex|laguna|dots|lfm/i.test(id),
      );
      const rest = free.filter((id) => !preferred.includes(id));
      const models = [...preferred, ...rest].slice(0, POOL_SIZE);
      if (models.length === 0) throw new Error("no free models in catalog");
      OpenRouterProvider.poolCache = { models, at: now };
      return models;
    } catch {
      return this.fallbackPool;
    }
  }

  /** Resolves the free vision-model pool (image input + zero cost). */
  private async visionPool(): Promise<string[]> {
    const now = Date.now();
    if (
      OpenRouterProvider.visionPoolCache &&
      now - OpenRouterProvider.visionPoolCache.at < POOL_TTL_MS
    ) {
      return OpenRouterProvider.visionPoolCache.models;
    }
    try {
      const catalog = await this.catalog();
      const acceptsImages = (m: CatalogModel) =>
        Boolean(m.id) &&
        m.id!.endsWith(":free") &&
        m.pricing?.prompt === "0" &&
        m.pricing?.completion === "0" &&
        !EXCLUDE_PATTERN.test(m.id!) &&
        Array.isArray(m.architecture?.input_modalities) &&
        m.architecture!.input_modalities!.includes("image");
      const vision = catalog.filter(acceptsImages).map((m) => m.id!) as string[];
      if (vision.length === 0) throw new Error("no free vision models in catalog");
      OpenRouterProvider.visionPoolCache = { models: vision, at: now };
      return vision;
    } catch {
      // Last-resort fallbacks: free multimodal models that accept images.
      return [
        "meta-llama/llama-3.2-11b-vision-instruct:free",
        "google/gemini-2.0-flash-exp:free",
        "qwen/qwen2.5-vl-72b-instruct:free",
      ];
    }
  }

  private markFailed(model: string): void {
    OpenRouterProvider.cooldowns.set(model, Date.now() + MODEL_COOLDOWN_MS);
  }

  private usable(models: string[]): string[] {
    const now = Date.now();
    const ok = models.filter((m) => (OpenRouterProvider.cooldowns.get(m) ?? 0) <= now);
    return ok.length > 0 ? ok : models;
  }

  /** Attempts `fn` across the pool; rethrows the last error if all fail.
   *  When every model is momentarily rate-limited, retries the whole pool
   *  once after a short backoff (429 bursts clear in seconds). */
  private async withPool<T>(fn: (model: string) => Promise<T>): Promise<T> {
    const runOnce = async (): Promise<T> => {
      const models = this.usable(await this.pool());
      let lastError: unknown;
      for (const model of models) {
        try {
          const result = await fn(model);
          this.lastUsed = model;
          return result;
        } catch (error) {
          this.markFailed(model);
          lastError = error;
          // Auth errors are not model-specific — fail fast.
          if (
            error instanceof AppError &&
            (error.code === "validation_error")
          ) {
            throw error;
          }
        }
      }
      throw lastError ?? Errors.internal("OpenRouter free-model pool exhausted.");
    };
    try {
      return await runOnce();
    } catch (error) {
      const rateLimited = error instanceof AppError && error.code === "rate_limited";
      if (!rateLimited) throw error;
    }
    await new Promise((r) => setTimeout(r, 1500));
    OpenRouterProvider.cooldowns.clear();
    return runOnce();
  }

  private toOpenAiMessages(
    request: ChatRequest,
    image?: { base64: string; mime: string },
  ): OpenAiMessage[] {
    const messages: OpenAiMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (!image) return messages;
    return messages.map((message, index) => {
      const isLastUser = index === messages.length - 1 && message.role === "user";
      if (!isLastUser || typeof message.content !== "string") return message;
      return {
        role: "user" as const,
        content: [
          { type: "text" as const, text: message.content },
          {
            type: "image_url" as const,
            image_url: { url: `data:${image.mime};base64,${image.base64}` },
          },
        ],
      };
    });
  }

  private async completions(
    model: string,
    request: ChatRequest,
    image?: { base64: string; mime: string },
    stream = false,
  ): Promise<Response> {
    if (!this.apiKey) {
      throw new AppError(
        "validation_error",
        "OpenRouter is selected but no API key is configured on the server.",
        400,
      );
    }
    const body = {
      model,
      messages: this.toOpenAiMessages(request, image),
      stream,
      temperature: request.temperature ?? 0.7,
      ...(request.forceJson ? { response_format: { type: "json_object" } } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      throw Errors.internal("Could not reach OpenRouter.");
    }
    if (response.status === 429) throw Errors.rateLimited();
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "validation_error",
        "OpenRouter rejected the API key. Check the server configuration.",
        502,
      );
    }
    if (response.status === 404) throw Errors.modelMissing(model);
    if (!response.ok) {
      throw Errors.internal(`OpenRouter returned HTTP ${response.status}.`);
    }
    return response;
  }

  private static extractContent(data: unknown): string {
    const typed = data as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return typed.choices?.[0]?.message?.content ?? "";
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.withPool(async (model) => {
      const response = await this.completions(model, request);
      const data = (await response.json()) as unknown;
      return {
        content: OpenRouterProvider.extractContent(data),
        provider: this.id,
        model,
      };
    });
  }

  async *streamChat(request: ChatRequest): AsyncIterable<string> {
    const attempt = async function* (
      provider: OpenRouterProvider,
      model: string,
    ): AsyncGenerator<string> {
      const response = await provider.completions(model, request, undefined, true);
      if (!response.body) throw Errors.internal("OpenRouter returned an empty stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
                error?: { message?: string };
              };
              if (parsed.error?.message) throw new Error(parsed.error.message);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch (error) {
              if (error instanceof SyntaxError) {
                // Ignore malformed SSE lines.
              } else {
                throw error;
              }
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }
    };

    // One run across the pool; when EVERY free model is momentarily
    // rate-limited (429s arrive in bursts), retry once after a short backoff
    // instead of killing the lesson turn (user hit exactly this in live use).
    const runPool = async function* (
      provider: OpenRouterProvider,
    ): AsyncGenerator<string> {
      const models = provider.usable(await provider.pool());
      let lastError: unknown;
      for (const model of models) {
        let emitted = 0;
        try {
          for await (const delta of attempt(provider, model)) {
            emitted += delta.length;
            yield delta;
          }
          provider.lastUsed = model;
          return;
        } catch (error) {
          provider.markFailed(model);
          lastError = error;
          // Only rotate when nothing meaningful streamed; otherwise a truncated
          // answer stitched from two models would reach the student.
          if (emitted > 0) throw error;
          if (error instanceof AppError && error.code === "validation_error") {
            throw error;
          }
        }
      }
      throw lastError ?? Errors.internal("OpenRouter free-model pool exhausted.");
    };

    try {
      for await (const delta of runPool(this)) {
        yield delta;
      }
      return;
    } catch (error) {
      const rateLimited =
        error instanceof AppError && error.code === "rate_limited";
      if (!rateLimited) throw error;
    }
    await new Promise((r) => setTimeout(r, 1500));
    OpenRouterProvider.cooldowns.clear();
    for await (const delta of runPool(this)) {
      yield delta;
    }
  }

  async vision(request: VisionRequest): Promise<VisionResponse> {
    // Photo-of-homework (ADR-0008): vision calls rotate a DEDICATED pool of
    // free models that actually accept image input — reusing the text pool
    // would burn cooldowns on text-only models that 404 on image parts.
    const models = this.usable(await this.visionPool());
    let lastError: unknown;
    for (const model of models) {
      try {
        const response = await this.completions(model, request, {
          base64: request.imageBase64,
          mime: request.imageMime,
        });
        const data = (await response.json()) as unknown;
        this.lastUsed = model;
        return {
          text: OpenRouterProvider.extractContent(data),
          provider: this.id,
          model,
        };
      } catch (error) {
        this.markFailed(model);
        lastError = error;
        if (error instanceof AppError && error.code === "validation_error") throw error;
      }
    }
    throw lastError ?? Errors.internal("OpenRouter free vision-model pool exhausted.");
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.apiKey) {
      return {
        provider: "openrouter",
        available: false,
        detail: "No OpenRouter API key configured on the server.",
      };
    }
    try {
      const pool = await this.pool();
      const now = Date.now();
      const usableCount = pool.filter(
        (m) => (OpenRouterProvider.cooldowns.get(m) ?? 0) <= now,
      ).length;
      return {
        provider: "openrouter",
        available: usableCount > 0,
        models: pool.map(
          (name): ModelInfo => ({ name, supportsStreaming: true, supportsVision: true }),
        ),
        detail: `Free-model pool: ${usableCount}/${pool.length} ready.`,
      };
    } catch {
      return {
        provider: "openrouter",
        available: false,
        detail: "Could not reach OpenRouter.",
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const health = await this.healthCheck();
    return health.models ?? [];
  }
}
