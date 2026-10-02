/**
 * Mock provider (PRD §5.7 priority 4) — deterministic, streaming, schema-valid.
 * Used for all automated tests and for UI development without Ollama.
 *
 * Behavior script:
 * - First turn: diagnostic question (level 0).
 * - Student shows reasoning: guiding question (level 1).
 * - Later turns: targeted hint (level 2), then partial step (level 3).
 * - "explain directly"/"just give me the answer"/forceJson answer request:
 *   worked explanation + labeled answer (level 4-5, answer_revealed).
 * - Periodically emits a whiteboard `write` op so board behavior is testable.
 * - A message containing INVALID_JSON_TEST makes chat() return broken JSON so
 *   the repair/fallback ladder can be tested deterministically.
 */
import type {
  ProviderHealth,
} from "@local-live-tutor/shared";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMProvider,
  VisionRequest,
  VisionResponse,
} from "./types.js";

const smallDelay = async (ms: number) =>
  await new Promise<void>((resolve) => setTimeout(resolve, ms));

function countStudentTurns(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

function lastStudentText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === "user") return m.content;
  }
  return "";
}

function buildScriptedResponse(messages: ChatRequest["messages"]): Record<string, unknown> {
  const studentText = lastStudentText(messages).toLowerCase();
  const turn = countStudentTurns(messages);

  // --- ADR-0006 conversational study features ---

  // Flashcards on request.
  if (studentText.includes("flashcard")) {
    return {
      message: "Here are your flashcards from this lesson — flip through them and say when you want to move on.",
      response_type: "explanation",
      hint_level: 0,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
      flashcards: [
        { front: "What do plants need for photosynthesis?", back: "Sunlight, water, and carbon dioxide." },
        { front: "What do plants produce?", back: "Glucose (food) and oxygen." },
        { front: "Where does photosynthesis happen?", back: "In the chloroplasts, using chlorophyll." },
      ],
    };
  }

  // Grading: the tutor asked a quiz question (visible in the packed history),
  // and this student message is the answer.
  const quizMarker = messages.find((m) => m.content.includes("[Quiz question you asked"));
  if (quizMarker) {
    const asked = /\[Quiz question you asked: "([^"]+)"/.exec(
      messages[messages.length - 1]?.content ?? "",
    );
    const question = asked?.[1] ?? "What do plants need for photosynthesis?";
    const correct =
      studentText.includes("sunlight") ||
      studentText.includes("light") ||
      studentText.includes("chlorophyll") ||
      studentText.includes("chloroplast");
    return {
      message: correct
        ? "Correct! That is exactly right — sunlight powers the whole process. You just earned 10 XP!"
        : "Not quite — think about what powers the process. It comes from the sun.",
      response_type: "question",
      hint_level: correct ? 1 : 2,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
      quiz_grading: {
        correct,
        feedback: correct
          ? "Sunlight, water, and CO₂ — the three inputs of photosynthesis."
          : "The missing input is sunlight; it provides the energy.",
      },
      detected_progress: correct ? "quiz_passed" : "quiz_retry",
      student_action: correct ? "Ask for the next quiz question." : "Try again with the energy source in mind.",
      ...(correct
        ? {}
        : {
            quiz: {
              question,
              choices: ["Sunlight", "Moonlight", "Soil", "Wind"],
              answer: "Sunlight",
            },
          }),
    };
  }

  // Quiz me: pose one question with choices.
  if (studentText.includes("quiz me") || studentText.includes("quiz")) {
    return {
      message: "Pop quiz! What powers photosynthesis?",
      response_type: "question",
      hint_level: 1,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
      quiz: {
        question: "What powers photosynthesis?",
        choices: ["Sunlight", "Moonlight", "Soil", "Wind"],
        answer: "Sunlight",
      },
      detected_progress: "quiz_posed",
    };
  }

  // Brand-new session greeting (the opener instructs this verbatim).
  const lastUser = messages[messages.length - 1];
  if (lastUser?.role === "user" && lastUser.content.includes("brand-new session")) {
    return {
      message:
        "Hello there, and welcome! I'm your study tutor — we can cover anything from math to history. So, what are we learning today?",
      response_type: "diagnostic",
      hint_level: 0,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
      detected_progress: "awaiting_topic",
    };
  }

  // Hint on request (conversational flow): a nudge, never the full answer.
  if (studentText.includes("hint") || studentText.includes("stuck")) {
    return {
      message:
        "Hint: start from what the plant takes in — think about what leaves absorb and roots drink. You already know more than you think!",
      response_type: "hint",
      hint_level: 2,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
      detected_progress: "hinting",
    };
  }

  // The student names a topic → teach it completely, capture it, quiz after.
  const topicMatch = /\b(?:learn|study|teach me|help me with)\s+(?:about\s+)?(.{3,120})/i.exec(
    studentText,
  );
  if (topicMatch) {
    const topic = (topicMatch[1] ?? "photosynthesis").replace(/[.?!]+$/, "").trim();
    return {
      message:
        `Great choice — ${topic} it is! Here is the big picture: plants capture light energy in their chloroplasts and use it to turn water and carbon dioxide into glucose, releasing oxygen along the way. Let me chalk the key points on the board, then I will check your understanding.`,
      response_type: "explanation",
      student_action: `Tell me in your own words what ${topic} does.`,
      hint_level: 1,
      should_draw: true,
      whiteboard_operations: [
        { type: "write", payload: { x: 120, y: 160, text: topic.charAt(0).toUpperCase() + topic.slice(1) } },
        { type: "write", payload: { x: 120, y: 240, text: "sunlight + water + CO2 → glucose + O2" } },
        // NOTE: no image ops here — the mock must stay deterministic and
        // CI never touches the network. The LIVE model emits image ops (user
        // spec: illustrations wherever they help), covered by an opsBridge
        // unit test with a stub editor.
      ],
      answer_revealed: false,
      topic,
      subject: "science",
      detected_progress: "teaching",
    };
  }

  const wantsAnswer =
    studentText.includes("just give me the answer") ||
    studentText.includes("explain directly") ||
    studentText.includes("explain it directly") ||
    studentText.includes("give me the answer") ||
    studentText.includes("i understand") ||
    studentText.includes("show the answer");

  // End-of-lesson ritual (ADR-0009): RECAP_REQUEST triggers the erase +
  // takeaway-card + spoken sign-off shape. The recap MUST restate the actual
  // topic, so reuse the session's stored goal/topic when present.
  if (lastUser?.content.includes("finishing the lesson")) {
    const topicMatchRecap =
      /(?:learn|learning|study|teach me(?: about)?|about)\s+(?:about\s+)?(.{3,80})/i.exec(
        messages.map((m) => m.content).join(" "),
      ) ?? /(?:learn|learning|study|about)\s+(?:about\s+)?(.{3,80})/i.exec(studentText);
    const topic = (topicMatchRecap?.[1] ?? "our lesson").replace(/[.?!]+$/, "").trim();
    return {
      message: `Wonderful work today! We explored ${topic} — you pushed through the tricky parts and asked real questions. Before next time, try explaining the main idea out loud in your own words. See you soon!`,
      response_type: "summary",
      hint_level: 0,
      should_draw: true,
      whiteboard_operations: [
        { type: "clear_region", payload: { region: "all" } },
        {
          type: "write",
          payload: {
            x: 120,
            y: 160,
            text: `Lesson recap: ${topic}\n• We worked through it step by step\n• You asked great questions\n• Next: explain it back in your own words`,
          },
        },
      ],
      answer_revealed: false,
      student_action: "Explain today's idea to someone (or your rubber duck).",
      detected_progress: "lesson_complete",
    };
  }

  const wantsSummary =
    studentText.includes("recap") || studentText.includes("summary");

  if (wantsSummary) {
    return {
      message:
        "Recap: you identified the quantities, chose an operation, and checked your answer against the question.",
      response_type: "summary",
      hint_level: 0,
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
      student_action: "Try a similar problem on your own.",
    };
  }

  if (wantsAnswer) {
    return {
      message:
        "Here is the full explanation: add the numerators only after rewriting both fractions with a common denominator, then simplify if possible. The answer is 5/4, labeled as an explanation, not a discovery step.",
      response_type: "explanation",
      student_action: "Redo the last step yourself to confirm it.",
      hint_level: 4,
      should_draw: true,
      whiteboard_operations: [
        { type: "write", payload: { x: 120, y: 80, text: "3/4 + 1/2 = 3/4 + 2/4 = 5/4" } },
        { type: "circle", payload: { cx: 200, cy: 90, rx: 60, ry: 30, label: "common denominator" } },
      ],
      answer_revealed: true,
      detected_progress: "explanation_delivered",
    };
  }

  if (turn <= 1) {
    return {
      message:
        "Before we solve anything: what do you notice about the two denominators, and what have you tried so far?",
      response_type: "diagnostic",
      student_action: "Describe what you have tried.",
      hint_level: 0,
      should_draw: true,
      whiteboard_operations: [
        { type: "write", payload: { x: 120, y: 80, text: "3/4 + 1/2" } },
      ],
      answer_revealed: false,
      detected_progress: "diagnosing",
    };
  }

  if (turn === 2) {
    return {
      message:
        "Good start. If the pieces are different sizes, what could we do so both fractions use the same size piece?",
      response_type: "question",
      student_action: "Identify a common denominator.",
      hint_level: 1,
      should_draw: true,
      whiteboard_operations: [
        { type: "underline", payload: { from: [110, 70], to: [300, 70], label: "denominators 4 and 2" } },
      ],
      answer_revealed: false,
      detected_progress: "needs_denominator_strategy",
    };
  }

  if (turn === 3) {
    return {
      message:
        "Hint: look at the denominators 4 and 2 — which number is a multiple of both, and is it the smallest one?",
      response_type: "hint",
      student_action: "Name the least common denominator.",
      hint_level: 2,
      should_draw: true,
      whiteboard_operations: [
        { type: "highlight", payload: { target: "denominators" } },
      ],
      answer_revealed: false,
      misconception: "Students often add denominators directly.",
      detected_progress: "hinting_common_denominator",
    };
  }

  return {
    message:
      "Let's do the next step together: rewrite 1/2 with the common denominator 4 — you complete the numerator.",
    response_type: "partial_step",
    student_action: "Complete 1/2 = ?/4.",
    hint_level: 3,
    should_draw: true,
    whiteboard_operations: [
      { type: "write", payload: { x: 120, y: 120, text: "1/2 = ?/4" } },
      { type: "arrow", payload: { from: [180, 130], to: [260, 130], label: "multiply top and bottom by 2" } },
    ],
    answer_revealed: false,
    detected_progress: "partial_step_pending",
  };
}

export class MockProvider implements LLMProvider {
  readonly id = "mock";
  readonly model = "mock-socratic-1";

  /** Test hook: records every chat() call so assertions can inspect prompts. */
  static lastMessages: ChatRequest["messages"] = [];

  async chat(request: ChatRequest): Promise<ChatResponse> {
    MockProvider.lastMessages = request.messages;
    return this.respond(request);
  }

  private async respond(request: ChatRequest): Promise<ChatResponse> {
    await smallDelay(5);
    // Any message in the exchange containing the marker (including a repair
    // attempt) yields broken JSON so the full §9 failure ladder is testable.
    const mentionsInvalid = request.messages.some((m) =>
      m.content.includes("INVALID_JSON_TEST"),
    );
    if (mentionsInvalid) {
      return {
        content: "this is not json at all",
        provider: this.id,
        model: this.model,
      };
    }

    // Handwriting grading (roadmap): deterministic transcript grading —
    // correct when the student transcribed at least two words, legibility
    // estimated from unclear marks. Keeps the endpoint honest in tests.
    const mentionsHandwriting = request.messages.some((m) =>
      m.content.includes("handwritten answer"),
    );
    if (mentionsHandwriting) {
      const userMsg =
        request.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
      const written =
        /transcription of their board writing: "([^"]*)"/.exec(userMsg)?.[1] ?? "";
      const words = written.split(/\s+/).filter(Boolean).length;
      const legibility = Math.max(
        20,
        Math.min(95, 90 - (written.match(/[?*~^]/g)?.length ?? 0) * 8),
      );
      return {
        content: JSON.stringify({
          readAs: written || "(nothing legible)",
          verdict: words >= 2 ? "correct" : "partially_correct",
          feedback:
            "Nice practice — read your writing back to yourself once before finishing; it catches small slips.",
          correct: words >= 2,
          legibility,
        }),
        provider: this.id,
        model: this.model,
      };
    }

    const structured = buildScriptedResponse(request.messages);
    return {
      content: JSON.stringify(structured),
      provider: this.id,
      model: this.model,
    };
  }

  async *streamChat(request: ChatRequest): AsyncIterable<string> {
    const response = await this.chat(request);
    // Stream in word-sized chunks to emulate token streaming.
    const chunks = response.content.match(/\S+\s*/g) ?? [response.content];
    for (const chunk of chunks) {
      await smallDelay(4);
      yield chunk;
    }
  }

  async vision(request: VisionRequest): Promise<VisionResponse> {
    await smallDelay(5);
    // Handwriting grading (roadmap): the board capture path — return valid
    // handwriting feedback so the vision flow is testable end-to-end.
    if (request.messages.some((m) => m.content.includes("handwritten answer"))) {
      return {
        text: JSON.stringify({
          readAs: "A = π r²",
          verdict: "correct",
          feedback:
            "Clear writing and the formula is right. Watch the spacing around the equals sign.",
          correct: true,
          legibility: 88,
        }),
        provider: this.id,
        model: this.model,
      };
    }
    return {
      text: JSON.stringify({
        text: "3/4 + 1/2 = ?",
        entities: [
          { kind: "equation", value: "3/4 + 1/2" },
          { kind: "variable", value: "?" },
        ],
        unclear: false,
      }),
      provider: this.id,
      model: this.model,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { provider: "mock", available: true, models: [{ name: this.model }] };
  }

  async listModels(): Promise<import("@local-live-tutor/shared").ModelInfo[]> {
    return [{ name: this.model, supportsVision: true, supportsStreaming: true }];
  }
}
