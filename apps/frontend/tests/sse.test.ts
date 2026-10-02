import { describe, expect, it, vi } from "vitest";

import { streamMessage } from "../src/lib/sse";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("streamMessage SSE parsing", () => {
  it("collects deltas and returns the final result", async () => {
    const payload = JSON.stringify({
      studentMessage: { id: "s1", role: "student", content: "q" },
      tutorMessage: { id: "t1", role: "tutor", content: "What have you tried?" },
      whiteboardOps: [],
      provider: "mock",
      model: "mock-socratic-1",
      fellBackToText: false,
    });
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          `event: delta\ndata: {"text":"What "}\n\n`,
          `event: delta\ndata: {"text":"have you tried?"}\n\n`,
          `event: done\ndata: ${payload}\n\n`,
        ]),
      ),
    );

    const result = await streamMessage(
      "sess1",
      { content: "help" },
      { onDelta: (t) => deltas.push(t) },
    );
    expect(deltas.join("")).toBe("What have you tried?");
    expect(result.tutorMessage.id).toBe("t1");
  });

  it("throws typed errors from error events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([`event: error\ndata: {"error":{"code":"ollama_unreachable","message":"Ollama is not reachable."}}\n\n`]),
      ),
    );
    await expect(
      streamMessage("sess1", { content: "hi" }, { onDelta: () => undefined }),
    ).rejects.toMatchObject({ code: "ollama_unreachable" });
  });

  it("handles deltas split across network chunks", async () => {
    const payload = JSON.stringify({
      studentMessage: { id: "s1", role: "student", content: "q" },
      tutorMessage: { id: "t1", role: "tutor", content: "ok" },
      whiteboardOps: [],
      provider: "mock",
      model: "m",
      fellBackToText: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          `event: del`,
          `ta\ndata: {"text":"he`,
          `llo"}\n\nevent: done\ndata: ${payload}\n\n`,
        ]),
      ),
    );
    const deltas: string[] = [];
    const result = await streamMessage("s", { content: "x" }, { onDelta: (t) => deltas.push(t) });
    expect(deltas.join("")).toBe("hello");
    expect(result.tutorMessage.content).toBe("ok");
  });
});
