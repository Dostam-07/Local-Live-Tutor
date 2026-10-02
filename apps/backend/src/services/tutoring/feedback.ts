/**
 * Feedback interpreter (self-improving personalization, spec §2–§3, §11).
 *
 * Pipeline: student feedback → understand intent → extract preferences →
 * classify scope (session vs long-term) → apply. The LLM does the reading;
 * a deterministic keyword fallback keeps the feature usable offline. The
 * interpreter NEVER rewrites core instructions — it only produces preference
 * lines for the personalization layer (spec §10).
 */
import {
  feedbackInterpretationSchema,
  type FeedbackInterpretation,
} from "@local-live-tutor/shared";

import type { ProviderRegistry } from "../llm/registry.js";
import { tryParseJsonObject } from "./json.js";

const INTERPRETER_PROMPT = `You interpret student feedback about an AI tutor and turn it into concrete, durable teaching preferences.

Rules:
- Extract at most 6 preferences. Each is ONE short imperative line (max 20 words) that a tutor can follow, e.g. "Give the student extra thinking time before revealing answers".
- Choose a category for each: explanation (style/detail/language), pacing (speed/wait time), problem_solving (hints vs answers), examples (real-world/visual), interaction (check-ins/questions), voice (tone/speech), other.
- SCOPE decides what happens:
  * "session" — a wish for THIS lesson only ("today I want to test myself without hints", "just this once go fast"). NEVER saved.
  * "long_term" — a durable preference about how they like to be taught ("I like real-life examples", "from now on keep it shorter"). Saved to their profile.
- When ambiguous, choose "session" — permanence must be earned, not assumed.
- If the feedback contradicts an older habit, still extract it; the system replaces the old line.
- Write the "confirmation" as one friendly sentence telling the student what will change (or what you'll do this session for session scope).

Respond ONLY with JSON:
{
  "scope": "session" | "long_term",
  "preferences": [ { "text": string, "category": "explanation"|"pacing"|"problem_solving"|"examples"|"interaction"|"voice"|"other" } ],
  "confirmation": string
}`;

/** Deterministic keyword fallback (offline / model hiccup). Order matters. */
const FALLBACK_RULES: Array<{
  pattern: RegExp;
  scope: FeedbackInterpretation["scope"];
  text: string;
  category: FeedbackInterpretation["preferences"][number]["category"];
}> = [
  {
    pattern: /(too (fast|quickly|quick)|slow down|give me (more )?time|time to think|rush)/i,
    scope: "long_term",
    text: "Give the student extra thinking time before moving on or revealing answers",
    category: "pacing",
  },
  {
    pattern: /(don'?t|do not|stop).{0,24}(reveal|give|tell).{0,20}(answer|solution)|hints? (first|before)|let me try/i,
    scope: "long_term",
    text: "Offer hints before solutions; let the student try before revealing answers",
    category: "problem_solving",
  },
  {
    pattern: /(simpl(er|ify)|easier|plain|layman|everyday|basic terms)/i,
    scope: "long_term",
    text: "Explain in simple everyday language, one idea at a time",
    category: "explanation",
  },
  {
    pattern: /(real[- ]?(life|world)|concrete example|relatable)/i,
    scope: "long_term",
    text: "Prefer simple real-world examples when explaining concepts",
    category: "examples",
  },
  {
    pattern: /(don'?t|do not|stop).{0,24}(ask|keep asking).{0,24}(understand|ok|okay|follow|with me)|repetitive/i,
    scope: "long_term",
    text: "Avoid repetitive comprehension checks; confirm understanding only when it matters",
    category: "interaction",
  },
  {
    pattern: /(short(er|er)?|brief|concise|less detail|to the point)/i,
    scope: "long_term",
    text: "Default to concise explanations; expand only when asked",
    category: "explanation",
  },
  {
    pattern: /(more detail|in depth|deeper|elaborate|thorough)/i,
    scope: "long_term",
    text: "Give detailed, thorough explanations by default",
    category: "explanation",
  },
  {
    // Session-only wishes: a time limiter PLUS an actual change request —
    // bare words like "today" must not swallow unrelated feedback.
    pattern: /((today|this session|just (this )?once|for now|right now).{0,60}(no hints?|don'?t|do not|go (fast|slow|easy)|skip|harder|easier|test)|i'?m (just )?testing)/i,
    scope: "session",
    text: "For this session only: follow the student's one-off request",
    category: "other",
  },
];

export class FeedbackInterpreter {
  constructor(private readonly registry: ProviderRegistry) {}

  async interpret(text: string, lessonContext?: string): Promise<FeedbackInterpretation> {
    const { provider } = await this.registry.resolve();
    const messages = [
      { role: "system" as const, content: INTERPRETER_PROMPT },
      {
        role: "user" as const,
        content: lessonContext
          ? `Lesson context: ${lessonContext}\n\nStudent feedback: ${text}`
          : text,
      },
    ];
    try {
      const response = await provider.chat({ messages, forceJson: true, temperature: 0.2 });
      const parsed = feedbackInterpretationSchema.safeParse(
        tryParseJsonObject(response.content) ?? {},
      );
      if (parsed.success && parsed.data.preferences.length > 0) {
        return parsed.data;
      }
    } catch {
      // fall through to the deterministic path
    }
    return this.fallback(text);
  }

  /** Keyword path — never throws, always honest about being simple. */
  private fallback(text: string): FeedbackInterpretation {
    const matches = FALLBACK_RULES.filter((rule) => rule.pattern.test(text));
    if (matches.length === 0) {
      // Ambiguous feedback → session-scoped no-op confirmation (spec §3).
      return {
        scope: "session",
        preferences: [],
        replacedCount: 0,
        confirmation:
          "Thanks! I'll keep it in mind for this session — tell me any time you want something to change for good.",
      };
    }
    // If ANY matched rule looks session-scoped and no durable rule matched,
    // treat it as session scope; mixed signals resolve to session (safer).
    const durable = matches.filter((m) => m.scope === "long_term");
    const sessionOnly = matches.filter((m) => m.scope === "session");
    const scope: FeedbackInterpretation["scope"] =
      durable.length > 0 && sessionOnly.length === 0 ? "long_term" : "session";
    const preferences = (scope === "long_term" ? durable : sessionOnly.length > 0 ? sessionOnly : durable).map(
      (m) => ({ text: m.text, category: m.category }),
    );
    return {
      scope,
      preferences,
      replacedCount: 0,
      confirmation:
        scope === "long_term"
          ? "Got it — I'll adapt to that in future sessions."
          : "Got it — I'll do that for the rest of this session.",
    };
  }
}
