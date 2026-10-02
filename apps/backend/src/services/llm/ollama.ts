/**
 * Ollama provider (PRD §5.7 priority 1). Configurable base URL and model,
 * streaming via NDJSON, health check, and model listing. Never hardcodes a
 * model name. Errors map to PRD §14 states.
 */
import { Errors } from "../../errors.js";
import type { ModelInfo, ProviderHealth } from "@local-live-tutor/shared";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMProvider,
  VisionRequest,
  VisionResponse,
} from "./types.js";

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";

  get model(): string {
    return this.modelName;
  }

  /**
   * Vision model (roadmap: Ollama vision parity). Photo-of-homework reading
   * uses this model when configured; without it, vision falls back to the
   * chat model (works when the student pulls a vision-capable model such as
   * qwen2.5vl into their chat slot).
   */
  private readonly visionModelName: string;

  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    visionModel?: string,
  ) {
    this.visionModelName = visionModel ?? modelName;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.modelName,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      format: request.forceJson ? "json" : undefined,
      options: {
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
    } catch {
      throw Errors.ollamaUnreachable(this.baseUrl);
    }

    if (response.status === 404) {
      throw Errors.modelMissing(this.modelName);
    }
    if (!response.ok) {
      throw Errors.internal(`Ollama returned HTTP ${response.status}.`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) {
      throw Errors.internal(`Ollama error: ${data.error}`);
    }
    return {
      content: data.message?.content ?? "",
      provider: this.id,
      model: this.modelName,
    };
  }

  async *streamChat(request: ChatRequest): AsyncIterable<string> {
    const body = {
      model: this.modelName,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      format: request.forceJson ? "json" : undefined,
      options: {
        temperature: request.temperature ?? 0.7,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // Local models generating structured JSON can take minutes on CPU —
        // a hard total timeout here would abort healthy generations.
        signal: AbortSignal.timeout(600_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw Errors.internal(
          `The local model "${this.modelName}" did not respond in time. Try a smaller model in Settings.`,
        );
      }
      throw Errors.ollamaUnreachable(this.baseUrl);
    }
    if (response.status === 404) {
      throw Errors.modelMissing(this.modelName);
    }
    if (!response.ok || !response.body) {
      throw Errors.internal(`Ollama returned HTTP ${response.status}.`);
    }

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
        if (line) {
          try {
            const parsed = JSON.parse(line) as {
              message?: { content?: string };
              done?: boolean;
              error?: string;
            };
            if (parsed.error) throw Errors.internal(`Ollama error: ${parsed.error}`);
            if (parsed.message?.content) yield parsed.message.content;
          } catch (error) {
            if (error instanceof Error && error.name === "AppError") throw error;
            // Ignore malformed NDJSON lines; Ollama streams complete lines.
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  }

  async vision(request: VisionRequest): Promise<VisionResponse> {
    const body = {
      model: this.visionModelName,
      messages: [
        ...request.messages.map((m: ChatMessage) => ({
          role: m.role,
          content: m.content,
        })),
        {
          role: "user",
          content: request.messages.at(-1)?.content ?? "Extract the problem.",
          images: [request.imageBase64],
        },
      ],
      stream: false,
      format: request.forceJson ? "json" : undefined,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
    } catch {
      throw Errors.ollamaUnreachable(this.baseUrl);
    }
    if (response.status === 404) throw Errors.modelMissing(this.modelName);
    if (!response.ok) {
      throw Errors.internal(`Ollama returned HTTP ${response.status}.`);
    }
    const data = (await response.json()) as {
      message?: { content?: string };
      error?: string;
    };
    if (data.error) throw Errors.internal(`Ollama error: ${data.error}`);
    return {
      text: data.message?.content ?? "",
      provider: this.id,
      model: this.modelName,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        return {
          provider: "ollama",
          available: false,
          detail: `Ollama responded with HTTP ${response.status}.`,
        };
      }
      const data = (await response.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      const models: ModelInfo[] = (data.models ?? []).map((m) => ({
        name: m.name ?? m.model ?? "unknown",
      }));
      const notes = [
        models.some((m) => m.name === this.modelName)
          ? undefined
          : `Selected model "${this.modelName}" is not installed yet.`,
        // Vision parity (roadmap): flag a missing dedicated vision model so
        // photo-of-homework problems are diagnosed before the student uploads.
        this.visionModelName !== this.modelName &&
        !models.some((m) => m.name === this.visionModelName)
          ? `Vision model "${this.visionModelName}" is not installed yet.`
          : undefined,
      ].filter((n): n is string => Boolean(n));
      return {
        provider: "ollama",
        available: true,
        models,
        detail: notes.length > 0 ? notes.join(" ") : undefined,
      };
    } catch {
      return {
        provider: "ollama",
        available: false,
        detail: `Ollama is not reachable at ${this.baseUrl}.`,
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const health = await this.healthCheck();
    return health.models ?? [];
  }
}
