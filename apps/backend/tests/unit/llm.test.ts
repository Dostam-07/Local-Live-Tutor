import { describe, expect, it, vi } from "vitest";
import { MockProvider } from "../../src/services/llm/mock.js";
import { OllamaProvider } from "../../src/services/llm/ollama.js";
import { OpenRouterProvider } from "../../src/services/llm/openrouter.js";
import { tutorResponseSchema } from "@local-live-tutor/shared";

const chatRequest = {
  messages: [
    { role: "system" as const, content: "system" },
    { role: "user" as const, content: "3/4 + 1/2 = ?" },
  ],
  forceJson: true,
};

describe("MockProvider (deterministic, PRD §16)", () => {
  it("streams a schema-valid structured response", async () => {
    const provider = new MockProvider();
    let raw = "";
    for await (const delta of provider.streamChat(chatRequest)) raw += delta;
    const parsed = tutorResponseSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
  });

  it("escalates hint level over turns", async () => {
    const provider = new MockProvider();
    const turn = async (n: number, text: string) => {
      const response = await provider.chat({
        messages: [
          ...Array.from({ length: n - 1 }, (_, i) => ({
            role: "user" as const,
            content: `turn ${i}`,
          })),
          { role: "user" as const, content: text },
        ],
        forceJson: true,
      });
      return tutorResponseSchema.parse(JSON.parse(response.content));
    };
    expect((await turn(1, "I need help with fractions")).response_type).toBe("diagnostic");
    expect((await turn(2, "the denominators are different")).hint_level).toBe(1);
    expect((await turn(3, "maybe a common denominator?")).response_type).toBe("hint");
    expect((await turn(4, "ok what next")).response_type).toBe("partial_step");
  });

  it("reveals the answer with reasoning only when explicitly requested", async () => {
    const provider = new MockProvider();
    const response = await provider.chat({
      messages: [{ role: "user" as const, content: "Just give me the answer" }],
      forceJson: true,
    });
    const parsed = tutorResponseSchema.parse(JSON.parse(response.content));
    expect(parsed.answer_revealed).toBe(true);
    expect(parsed.response_type).toBe("explanation");
    expect(parsed.message.toLowerCase()).toContain("explanation");
  });

  it("emits INVALID_JSON_TEST broken output for fallback testing", async () => {
    const provider = new MockProvider();
    const response = await provider.chat({
      messages: [{ role: "user" as const, content: "INVALID_JSON_TEST" }],
      forceJson: true,
    });
    expect(response.content).toBe("this is not json at all");
  });

  it("health check reports available", async () => {
    const provider = new MockProvider();
    const health = await provider.healthCheck();
    expect(health.available).toBe(true);
  });
});

describe("OllamaProvider request formatting (PRD §16)", () => {
  it("posts /api/chat with model, messages, and json format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider("http://localhost:11434", "qwen2.5:7b");
    await provider.chat(chatRequest);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "system", content: "system" });
  });

  it("maps connection refusal to ollama_unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const provider = new OllamaProvider("http://localhost:11434", "m");
    await expect(provider.chat(chatRequest)).rejects.toMatchObject({
      code: "ollama_unreachable",
    });
  });

  it("maps 404 to model_missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
    );
    const provider = new OllamaProvider("http://localhost:11434", "nope");
    await expect(provider.chat(chatRequest)).rejects.toMatchObject({
      code: "model_missing",
    });
  });

  it("health check parses installed models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 }),
      ),
    );
    const provider = new OllamaProvider("http://localhost:11434", "qwen2.5:7b");
    const health = await provider.healthCheck();
    expect(health.available).toBe(true);
    expect(health.models?.[0]?.name).toBe("qwen2.5:7b");
  });

  it("health check reports unreachable Ollama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const provider = new OllamaProvider("http://localhost:11434", "m");
    const health = await provider.healthCheck();
    expect(health.available).toBe(false);
  });
});

describe("OpenRouterProvider request formatting (PRD §16)", () => {
  const provider = new OpenRouterProvider(
    "https://openrouter.ai/api/v1",
    "test-key",
    ["free/model:free"],
  );

  it("posts chat completions with bearer auth and json mode", async () => {
    // Fresh Response per call: the provider fetches the /models catalog and
    // the /chat/completions endpoint; a shared instance would be consumed.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [],
            choices: [{ message: { content: "{}" } }],
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await provider.chat(chatRequest);
    // calls[0] is the /models catalog probe; find the actual chat call.
    const chatCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
      ([url]) => String(url).includes("/chat/completions"),
    );
    const [url, init] = chatCall!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("free/model:free");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
  });

  it("maps 429 to rate_limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("limit", { status: 429 })),
    );
    await expect(provider.chat(chatRequest)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("never includes the API key in errors or health payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    const health = await provider.healthCheck();
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain("test-key");
  });
});
