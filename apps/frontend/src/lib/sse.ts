/**
 * Streaming POST via fetch + SSE parsing (EventSource cannot POST).
 * Protocol: `delta` events with {text}, then `done` or `error`.
 */
import type { TurnResult } from "./api";
import { ApiError } from "./api";

export type StreamHandlers = {
  onDelta: (text: string) => void;
};

async function startStream(
  url: string,
  body: unknown,
  failLabel: string,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as
      | { error?: { code: string; message: string; details?: unknown } }
      | null;
    const err = data?.error;
    throw new ApiError(
      err?.code ?? "internal_error",
      err?.message ?? `${failLabel} (${response.status})`,
      response.status,
      err?.details,
    );
  }
  return response;
}

/** Reads one SSE response to completion, dispatching delta/done/error events. */
async function consumeSse(
  response: Response,
  handlers: StreamHandlers,
): Promise<TurnResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseEventBlock = (block: string): { event: string; data: string } | null => {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    return data ? { event, data } : null;
  };

  let finalResult: TurnResult | null = null;

  const handleBlock = (block: string) => {
    const parsed = parseEventBlock(block);
    if (!parsed) return;
    if (parsed.event === "delta") {
      const { text } = JSON.parse(parsed.data) as { text: string };
      handlers.onDelta(text);
    } else if (parsed.event === "done") {
      finalResult = JSON.parse(parsed.data) as TurnResult;
    } else if (parsed.event === "error") {
      const err = JSON.parse(parsed.data) as {
        error: { code: string; message: string };
      };
      throw new ApiError(err.error.code, err.error.message, 502);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      handleBlock(block);
      separator = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleBlock(buffer.trim());

  if (!finalResult) {
    throw new ApiError("invalid_model_response", "The stream ended without a final response.", 502);
  }
  return finalResult;
}

/**
 * Lesson opener (ADR-0005): streams the tutor's proactive first turn after the
 * problem is confirmed — the tutor chalks the problem and asks its first
 * question without waiting for a student message.
 */
export async function streamLessonOpener(
  sessionId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const response = await startStream(
    `/api/sessions/${sessionId}/open`,
    {},
    "Opening failed",
    signal,
  );
  return consumeSse(response, handlers);
}

export async function streamMessage(
  sessionId: string,
  body: {
    content: string;
    inputType?: "text" | "voice";
    forceDirectAnswer?: boolean;
    /** Warm re-entry: the tutor opens with a recap of the last board step. */
    returnedAfterAbsence?: boolean;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const response = await startStream(
    `/api/sessions/${sessionId}/messages/stream`,
    body,
    "Streaming failed",
    signal,
  );
  return consumeSse(response, handlers);
}

/**
 * End-of-lesson ritual (ADR-0009): streams the recap sign-off. The done
 * payload carries the summary tutor message plus the persisted
 * clear_region + recap write ops, and the session is completed server-side.
 */
export async function streamRecap(
  sessionId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const response = await startStream(
    `/api/sessions/${sessionId}/recap`,
    {},
    "Recap failed",
    signal,
  );
  return consumeSse(response, handlers);
}
