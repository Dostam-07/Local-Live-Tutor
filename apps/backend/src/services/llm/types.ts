/**
 * LLM provider abstraction — PRD §5.7. The tutoring logic never knows which
 * provider is in use.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  temperature?: number;
  /** Ask the provider for JSON-constrained output where supported. */
  forceJson?: boolean;
  maxTokens?: number;
};

export type ChatResponse = {
  content: string;
  provider: string;
  model: string;
};

export type VisionRequest = ChatRequest & {
  imageBase64: string;
  imageMime: string;
};

export type VisionResponse = {
  text: string;
  provider: string;
  model: string;
};

export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Streams token deltas. */
  streamChat(request: ChatRequest): AsyncIterable<string>;
  vision?(request: VisionRequest): Promise<VisionResponse>;
  healthCheck(): Promise<import("@local-live-tutor/shared").ProviderHealth>;
  listModels?(): Promise<import("@local-live-tutor/shared").ModelInfo[]>;
}

/** True when the provider can accept images for this model. */
export function supportsVision(
  provider: LLMProvider,
): provider is LLMProvider & Required<Pick<LLMProvider, "vision">> {
  return typeof provider.vision === "function";
}
