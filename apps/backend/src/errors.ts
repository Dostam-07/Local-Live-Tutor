/**
 * Typed API errors mapped to the PRD §14 error states, plus a Fastify error
 * handler that renders the shared ApiError envelope.
 */
import type { FastifyInstance } from "fastify";
import type { ApiErrorCode } from "@local-live-tutor/shared";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode = 500,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const Errors = {
  ollamaUnreachable: (baseUrl: string) =>
    new AppError(
      "ollama_unreachable",
      `Ollama is not reachable at ${baseUrl}. Start Ollama, verify the base URL, or select another provider.`,
      502,
    ),
  modelMissing: (model: string) =>
    new AppError(
      "model_missing",
      `The selected model "${model}" is not installed. Choose another model or install it in Ollama.`,
      404,
    ),
  visionUnsupported: () =>
    new AppError(
      "vision_unsupported",
      "This model cannot analyze images. Enter the problem as text or select a vision-capable model.",
      400,
    ),
  invalidModelResponse: () =>
    new AppError(
      "invalid_model_response",
      "The tutor produced an invalid response format. Retrying with a safer fallback.",
      502,
    ),
  ocrUnclear: (note?: string) =>
    new AppError(
      "ocr_unclear",
      note ??
        "Some parts of the problem were unclear. Please edit the extracted text before continuing.",
      422,
      note ? { note } : undefined,
    ),
  speechUnavailable: (detail?: string) =>
    new AppError(
      "speech_unavailable",
      detail ??
        "Voice input is unavailable in this browser. You can type your response instead.",
      501,
    ),
  rateLimited: () =>
    new AppError(
      "rate_limited",
      "The remote model is temporarily rate-limited. Retry, switch models, or use Ollama locally.",
      429,
    ),
  validation: (details: unknown) =>
    new AppError("validation_error", "Invalid request.", 400, details),
  unavailable: (detail: string) =>
    new AppError("tts_unavailable", detail, 503),
  notFound: (what = "Resource") =>
    new AppError("not_found", `${what} not found.`, 404),
  internal: (message = "Unexpected server error.") =>
    new AppError("internal_error", message, 500),
};

/** Installs the shared error envelope on the Fastify instance. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    // Fastify's own validation errors.
    const fastifyError = error as { validation?: unknown; message?: string };
    if (fastifyError.validation) {
      reply.status(400).send({
        error: {
          code: "validation_error",
          message: "Invalid request.",
          details: fastifyError.validation,
        },
      });
      return;
    }
    request.log.error(error);
    reply.status(500).send({
      error: { code: "internal_error", message: "Unexpected server error." },
    });
  });
}
