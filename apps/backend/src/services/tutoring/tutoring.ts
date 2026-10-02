/**
 * Tutoring orchestration (PRD §5.3, §8, §9).
 *
 * Pipeline per student message:
 *   build context → stream response (forwarding deltas) → validate against the
 *   strict schema → one structured repair attempt → plain-text fallback →
 *   persist message + validated whiteboard ops → update session goal.
 * The session never crashes on invalid model output.
 */
import {
  warmupRequest,
  buildContextPack,
  buildSystemPrompt,
  describeBoard,
  inferChalkKind,
  RECAP_REQUEST,
  selectHistory,
  studentMessageSchema,
  tutorRepairSchema,
  tutorResponseSchema,
  whiteboardOpSchema,
  type BadgeId,
  type ExtractionResult,
  type LessonLanguage,
  type Message,
  type PersonaAdaptation,
  type StudyStats,
  type UpdateSessionInput,
  type Session,
  type StudentMessageInput,
  type TutorPersona,
  type TutorResponse,
  type TutorVoice,
  type WhiteboardOpType,
  type WhiteboardOperation,
} from "@local-live-tutor/shared";

import { Errors } from "../../errors.js";
import type { MessageRepo, SessionRepo } from "../../db/repos/session.js";
import type { ProfileRepo } from "../../db/repos/profiles.js";
import type { QuizRepo } from "../../db/repos/quiz.js";
import type { StudyStatsRepo } from "../../db/repos/studyStats.js";
import type { SrsRepo } from "../../db/repos/srs.js";
import type { WhiteboardRepo } from "../../db/repos/whiteboard.js";
import type { ProviderRegistry } from "../llm/registry.js";
import type { ChatMessage, LLMProvider } from "../llm/types.js";
import { tryParseJsonObject } from "./json.js";
import { computeAdaptation } from "./adaptive.js";
import { resolveEducationalImage } from "../images/resolver.js";

/** XP awards (ADR-0006 gamification). */
const XP_CORRECT_QUIZ = 10;
const XP_PARTICIPATION = 2;

/**
 * Deterministic fallback grader: when the model omits "quiz_grading" for a
 * pending quiz, compare the student's answer with the quiz answer directly.
 * Token-overlap match so close variants ("sunlight energy", "the Sun's light")
 * count as correct; participation XP otherwise.
 */
function fallbackGrade(
  quiz: { question: string; answer: string },
  studentAnswer: string,
): { correct: boolean; feedback: string } | undefined {
  const expected = quiz.answer.toLowerCase().trim();
  const given = studentAnswer.toLowerCase().trim();
  if (!expected || !given) return undefined;
  const expectedTokens = new Set(expected.split(/\W+/).filter((t) => t.length > 2));
  const givenTokens = new Set(given.split(/\W+/));
  const hits = [...expectedTokens].filter((t) => givenTokens.has(t)).length;
  const correct = expectedTokens.size > 0 && hits / expectedTokens.size >= 0.5;
  return {
    correct,
    feedback: correct
      ? `Matched the expected answer ("${quiz.answer}").`
      : `The expected answer was "${quiz.answer}".`,
  };
}

/**
 * True when the student's message is a new request (hint, explanation,
 * flashcards, next question…) rather than the quiz answer — those must not
 * consume the pending quiz.
 */
function answerIsNewRequest(quiz: { question: string }, content: string): boolean {
  const c = content.toLowerCase();
  return /\b(hint|explain|flashcard|summar|recap|next question|another question|i don't know|skip)\b/.test(c);
}

/**
 * New-problem detection (user bug: "I don't see the question appear on the
 * blackboard when I say let's solve (the question)", and "the previous
 * explanation comes along"). When the student names a NEW thing to work on,
 * the board is cleared deterministically and the problem is chalked verbatim —
 * this must never be trusted to the model.
 */
const NEW_PROBLEM_PATTERNS: RegExp[] = [
  /\b(let'?s|let us)\s+(solve|do|learn|study|work on|tackle|practice|go over|review|start|try)\b/i,
  /\b(help me (with|solve|understand)|teach me|explain (to )?me|i want to learn|i need help with|can you (solve|explain|teach|help))\b/i,
  /\b(solve|simplify|calculate|evaluate|factor(?:i[sz]e)?|derive|prove|convert|translate|conjugate)\b/i,
  /\b(what is|what'?s|what are|why (does|do|is|are)|how (does|do|can)|define|describe)\b/i,
];

export function isNewProblemStatement(content: string): boolean {
  const c = content.trim();
  if (c.length < 3 || c.length > 500) return false;
  // Continuation / social speech is never a new problem.
  if (
    /^(yes|no|ok(ay)?|sure|go on|continue|next|i don'?t know|idk|i'?m done|i am done|done|thanks|thank you|that'?s all)\b/i.test(
      c,
    )
  ) {
    return false;
  }
  return NEW_PROBLEM_PATTERNS.some((re) => re.test(c));
}

/**
 * Strips conversational scaffolding ("let's solve", "teach me", "can you…")
 * so the chalked question is the problem itself, not the command around it.
 */
function extractProblemText(content: string): string {
  const stripped = content
    .replace(/^\s*(ok(ay)?[,\s]*)?(hey|hi|hello)[,\s]*/i, "")
    .replace(
      /^\s*(can you|could you|please|i want to|i would like to|let'?s|let us|help me (with|to)?|teach me|explain (to me)?|i need help with)\s+/i,
      "",
    )
    .replace(
      /^\s*(solve|do|learn|study|work on|tackle|practice|go over|review|start with|about|on)\s+/i,
      "",
    )
    .replace(/\s*(please|now)[\s.!?]*$/i, "")
    .trim();
  return (stripped.length >= 2 ? stripped : content.trim()).slice(0, 300);
}

/**
 * Async illustration for the CURRENT topic (user spec §6–§11): a REAL
 * educational image from Wikipedia/Wikimedia Commons when one exists, a
 * generated illustration otherwise. The image is part of the explanation,
 * not decoration — it is fetched from the internet, carries its source
 * credit, and is large enough to actually study.
 */
async function buildIllustrationOp(
  topic: string | undefined,
  message: string,
): Promise<{ type: "image"; payload: { url: string; x: number; y: number; w: number; label: string; credit?: string } } | null> {
  const description = (topic ?? message ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  if (description.length < 3) return null;
  const resolved = await resolveEducationalImage(description);
  if (!resolved) return null;
  return {
    type: "image",
    payload: {
      url: resolved.url,
      x: 0,
      y: 0,
      w: 420,
      label: description.slice(0, 120),
      credit: resolved.credit,
    },
  };
}

/**
 * Deterministic verdict chalk (user spec: incorrect answers must STAY on the
 * board, clearly marked, with both attempts visible). Injects a ✓/✗ line
 * under the student's echoed attempt — right/wrong is a server-side fact
 * (grading), never trusted to the model's chalk.
 */
function buildVerdictOp(
  grading: { correct: boolean; feedback: string },
): { type: "write"; payload: { x: number; y: number; text: string; kind: "answer" } } {
  const feedback = grading.feedback.replace(/\s+/g, " ").trim().slice(0, 180);
  return {
    type: "write",
    payload: {
      x: 40,
      y: 60,
      kind: "answer",
      text: grading.correct
        ? `✓ Correct — ${feedback}`
        : `✗ Not quite — try again. ${feedback}`,
    },
  };
}

/**
 * Deterministic question chalk (user bug: quiz questions were sometimes only
 * spoken, never on the board). Injects a write op when the model failed to
 * chalk the quiz question it just posed.
 */
function buildQuizChalkOp(
  quiz: { question: string },
  existingOps: Array<{ type: WhiteboardOpType; payload: Record<string, unknown> }>,
): { type: "write"; payload: { x: number; y: number; text: string; kind: "question" } } | null {
  const probe = quiz.question.replace(/\s+/g, " ").trim().slice(0, 40).toLowerCase();
  if (probe.length < 4) return null;
  const alreadyChalked = existingOps.some(
    (op) =>
      (op.type === "write" || op.type === "draw_equation") &&
      String(op.payload.text ?? op.payload.latex ?? "")
        .toLowerCase()
        .includes(probe),
  );
  if (alreadyChalked) return null;
  return {
    type: "write",
    payload: { x: 40, y: 60, text: `Quiz: ${quiz.question.slice(0, 280)}`, kind: "question" },
  };
}

const MAX_HINT_LEVELS: Record<Session["helpLevel"], number> = {
  socratic: 3,
  hints: 3,
  step_by_step: 4,
  direct: 5,
};

export type TutorTurnResult = {
  studentMessage: Message;
  tutorMessage: Message;
  whiteboardOps: WhiteboardOperation[];
  provider: string;
  model: string;
  fellBackToText: boolean;
  /** XP awarded this turn (gamification, ADR-0006). */
  xpAwarded?: number;
  /** Fresh session state after XP/quiz updates. */
  session?: Session;
  /** Cumulative study stats after this turn (ADR-0007), when stats moved. */
  stats?: StudyStats;
  /** Badges newly unlocked by this turn (ADR-0007). */
  newBadges?: BadgeId[];
};

export class TutoringService {
  /** Stashed result of the most recent recapLesson() (conversational finish). */
  private lastRecapResult: TutorTurnResult | null = null;

  constructor(
    private readonly deps: {
      sessions: SessionRepo;
      messages: MessageRepo;
      ops: WhiteboardRepo;
      quiz: QuizRepo;
      studyStats: StudyStatsRepo;
      registry: ProviderRegistry;
      allowFallback: () => boolean;
      /** App settings (persona + voice live here, user spec). */
      settings: { get: () => import("@local-live-tutor/shared").AppSettings };
      /** Student profiles (roadmap): per-profile defaults + ownership. */
      profiles?: ProfileRepo;
      /** Spaced repetition (roadmap): flashcard scheduling per profile. */
      srs?: SrsRepo;
      /** Engagement events (parent view): quiet/resume pattern records. */
      engagement?: {
        record: (input: import("@local-live-tutor/shared").EngagementEventInput) => unknown;
      };
      /** Student Tutoring Profile (self-improving personalization). */
      preferences?: import("../../db/repos/preferences.js").PreferencesRepo;
    },
  ) {}

  /**
   * Effective persona/voice/language for a session (roadmap: per-session
   * memory + profiles). Precedence: what the board pill saved onto the
   * session → the owning profile's defaults → the app-wide settings.
   */
  private effectiveLessonStyle(session: Session): {
    persona: TutorPersona;
    voice: TutorVoice;
    language: LessonLanguage;
  } {
    const app = this.deps.settings.get();
    const profile = session.profileId ? this.deps.profiles?.getById(session.profileId) : undefined;
    return {
      persona:
        session.persona ?? profile?.defaultPersona ?? app.tutorPersona,
      voice: session.voice ?? profile?.defaultVoice ?? app.tutorVoice,
      language: session.language ?? profile?.defaultLanguage ?? app.lessonLanguage,
    };
  }

  /** The adaptive overlay state for the session's very next turn. */
  private currentAdaptation(sessionId: string): PersonaAdaptation {
    const hintsTaken = this.deps.messages
      .listBySession(sessionId)
      .filter((m) => m.role === "student" && (m.hintLevel ?? 0) > 0).length;
    const quiz = this.deps.quiz.recentBySession(sessionId, 5);
    return computeAdaptation(quiz, hintsTaken);
  }

  /**
   * Student Tutoring Profile (self-improving personalization): the saved
   * preference lines for the session's owning profile, injected into every
   * system prompt so the tutor teaches THIS student's way across sessions
   * (spec §9, §12). Core instructions are untouched — this only adds the
   * personalization block.
   */
  private studentPreferences(session: Session): string[] {
    const repo = this.deps.preferences;
    if (!repo) return [];
    try {
      return repo
        .list(session.profileId)
        .map((p) => p.text)
        .slice(0, 20);
    } catch {
      return []; // personalization must never break a lesson
    }
  }

  /**
   * Repeated-behavior signals (spec §8): count the student's recurring asks.
   * Patterns NEVER change behavior by themselves — crossing the threshold
   * only makes them confirmable in the UI, and the student decides.
   */
  private trackPatterns(session: Session, content: string): void {
    const repo = this.deps.preferences;
    if (!repo) return;
    try {
      if (/\b(hint|give me a hint|help me|stuck)\b/i.test(content)) {
        repo.bumpPattern(session.profileId, "hints");
      }
      if (/\b(simpler|simplify|don'?t understand|too (hard|complex)|easier|explain that (again|differently))\b/i.test(content)) {
        repo.bumpPattern(session.profileId, "simplify");
      }
    } catch {
      // Pattern tracking is best-effort telemetry.
    }
  }

  private async requireSession(sessionId: string): Promise<Session> {
    const session = this.deps.sessions.getById(sessionId);
    if (!session) throw Errors.notFound("Session");
    return session;
  }

  private historyTurns(sessionId: string, excludeMessageId?: string): ChatMessage[] {
    const history = this.deps.messages.listBySession(sessionId);
    return history
      .filter((m) => m.id !== excludeMessageId && m.role !== "system")
      .map((m) => ({
        role: m.role === "tutor" ? ("assistant" as const) : ("user" as const),
        // Quiz questions ride along in the history so the model can grade the
        // student's reply against the exact question it asked.
        content:
          m.role === "tutor" && m.quiz
            ? `${m.content}\n[Quiz question you asked: "${m.quiz.question}"${m.quiz.choices?.length ? ` — choices: ${m.quiz.choices.join(" | ")}` : ""}; correct answer: "${m.quiz.answer}"]`
            : m.content,
      }));
  }

  private sessionContextPack(
    session: Session,
    recentOps: Array<{ type: WhiteboardOpType; payload: Record<string, unknown> }>,
    returnedAfterAbsence = false,
  ): string {
    // Board-awareness (ADR-0009): describe the chalk on the board so the
    // tutor can reference its own writing naturally.
    const boardState = describeBoard(recentOps);
    return buildContextPack({
      subject: session.subject,
      gradeLevel: session.gradeLevel,
      helpLevel: session.helpLevel,
      mode: session.mode,
      extractedProblem: session.extractedProblem,
      history: [],
      boardState: boardState === "(the board is empty)" ? undefined : boardState,
      recentOps,
      currentGoal: session.currentGoal,
      // Warm re-entry (user spec): after an absence the tutor's FIRST
      // sentence recaps the last board step so the student re-enters oriented.
      returnedAfterAbsence,
    });
  }

  private maxHintLevel(session: Session, forceDirect: boolean): number {
    return forceDirect ? 5 : MAX_HINT_LEVELS[session.helpLevel];
  }

  /**
   * Validates raw model output; on failure attempts one structured repair;
   * on repeated failure returns a safe text-only response (PRD §9).
   */
  private async validateOrRepair(
    provider: LLMProvider,
    baseMessages: ChatMessage[],
    raw: string,
    previousHintLevel: number,
  ): Promise<{ structured: TutorResponse; raw: string; fellBackToText: boolean }> {
    const attempt = (candidate: Record<string, unknown>) => {
      const strict = tutorResponseSchema.safeParse(candidate);
      if (strict.success) return strict.data;
      const lenient = tutorRepairSchema.safeParse(candidate);
      if (lenient.success) {
        return tutorResponseSchema.parse({
          response_type: "question",
          hint_level: previousHintLevel,
          should_draw: false,
          whiteboard_operations: [],
          answer_revealed: false,
          ...lenient.data,
        });
      }
      return undefined;
    };

    const parsed = attempt(tryParseJsonObject(raw) ?? {});
    if (parsed) return { structured: parsed, raw, fellBackToText: false };

    // One structured repair request (PRD §9 step 1).
    try {
      const repair = await provider.chat({
        forceJson: true,
        temperature: 0,
        messages: [
          ...baseMessages,
          { role: "assistant", content: raw.slice(0, 4000) },
          {
            role: "user",
            content:
              "Your previous reply was not valid JSON matching the required schema. Respond again with ONLY the corrected JSON object.",
          },
        ],
      });
      const repaired = attempt(tryParseJsonObject(repair.content) ?? {});
      if (repaired) return { structured: repaired, raw: repair.content, fellBackToText: false };
    } catch {
      // Repair failed; fall through to text fallback.
    }

    // Fallback: display the text response without whiteboard operations
    // (PRD §9 step 2). Never crash the session (step 4).
    const text = raw.replace(/```(?:json)?/gi, "").trim();
    const structured = tutorResponseSchema.parse({
      message: text.length > 0
        ? text.slice(0, 2000)
        : "I had trouble formatting my last response. Could you rephrase what you tried?",
      response_type: "hint",
      hint_level: Math.min(previousHintLevel + 1, 5),
      should_draw: false,
      whiteboard_operations: [],
      answer_revealed: false,
    });
    return { structured, raw: text, fellBackToText: true };
  }

  /** Validates and filters tutor whiteboard ops; invalid ops are dropped (logged).
   *  Also stamps the chalk content kind (user spec: color-coded board): the
   *  model's own "kind" wins; otherwise it is inferred deterministically from
   *  the text so colors stay correct even when free models omit the field. */
  private extractValidOps(
    ops: Array<{ type: string; payload: Record<string, unknown> }>,
  ): Array<{ type: WhiteboardOpType; payload: Record<string, unknown> }> {
    const valid: Array<{ type: WhiteboardOpType; payload: Record<string, unknown> }> = [];
    for (const op of ops) {
      // Append-only board (user spec): the model must never be able to erase
      // the session record — clear_region is reserved for the explicit Clear
      // orb and the end-of-lesson ritual, both constructed server-side.
      if (op.type === "clear_region") continue;
      const result = whiteboardOpSchema.safeParse(op);
      if (result.success) {
        const payload = { ...(result.data.payload as Record<string, unknown>) };
        if (
          (result.data.type === "write" || result.data.type === "draw_equation") &&
          !payload.kind
        ) {
          payload.kind = inferChalkKind(
            String(payload.text ?? payload.latex ?? ""),
          );
        }
        valid.push({ type: result.data.type, payload });
      }
    }
    return valid;
  }

  async handleStudentMessage(
    sessionId: string,
    input: StudentMessageInput,
    onToken?: (delta: string) => void | Promise<void>,
  ): Promise<TutorTurnResult> {
    const parsedInput = studentMessageSchema.parse(input);
    const session = await this.requireSession(sessionId);
    // Idle auto-save (user spec): a "· paused" lesson REOPENS on the next
    // message — the auto-save closed it only for tidiness, and nothing was
    // lost. (Ritual-finished lessons have no "· paused" suffix and stay
    // completed: the student said goodbye.)
    if (session.status === "completed" && !(session.title?.includes("· paused") ?? false)) {
      throw Errors.validation("This session is already completed. Start a new session.");
    }
    if (session.status === "completed" && (session.title?.includes("· paused") ?? false)) {
      const reopened = this.deps.sessions.update(sessionId, {
        status: "active",
        // Drop the "· paused" suffix — the lesson is live again.
        title: (session.title ?? "").replace(/\s*·\s*paused\s*$/, ""),
      });
      if (reopened) {
        session.status = "active";
        session.title = reopened.title ?? session.title;
      }
    }

    const studentMessage = this.deps.messages.create({
      id: crypto.randomUUID(),
      sessionId,
      role: "student",
      content: parsedInput.content,
      inputType: parsedInput.inputType,
    });

    // Conversational finish (user spec: "there is no need for a Finish button
    // — it should be straightforward when to finish"): the student saying
    // they're done IS the finish command — run the full end-of-lesson ritual
    // (erase → recap card → spoken sign-off → download CTA) as the turn.
    if (
      /\b(i'?m done|i am done|that'?s all (for )?today|i'?m finished|i am finished|finish the lesson|let'?s (wrap|call it)|wrap (it )?up|end (the )?(lesson|session)|that'?s it for today)\b/i.test(
        parsedInput.content,
      )
    ) {
      await this.recapLesson(sessionId);
      const recapResult = this.lastRecapResult;
      this.lastRecapResult = null;
      if (recapResult) {
        return { ...recapResult, studentMessage };
      }
    }

    const { provider } = await this.deps.registry.resolve();
    const style = this.effectiveLessonStyle(session);

    const systemPrompt = buildSystemPrompt({
      subject: session.subject,
      gradeLevel: session.gradeLevel,
      helpLevel: session.helpLevel,
      mode: session.mode,
      maxHintLevel: this.maxHintLevel(session, parsedInput.forceDirectAnswer),
      persona: style.persona,
      language: style.language,
      adaptation: this.currentAdaptation(sessionId),
      adaptive: this.deps.settings.get().adaptivePersona,
      studentPreferences: this.studentPreferences(session),
    });
    const recentOps = this.deps.ops
      .listBySession(sessionId)
      .slice(-12)
      .map((op) => ({ type: op.type, payload: op.payload }));
    const contextPack = this.sessionContextPack(
      session,
      recentOps,
      parsedInput.returnedAfterAbsence === true,
    );
    const history = this.historyTurns(sessionId, studentMessage.id);

    // Explain intent (user spec: "when it is explain, you don't have to ask me
    // what I know because I have asked to explain"): the student (or the
    // Explain orb) explicitly asking for an explanation must get the full
    // explanation NOW — never a diagnostic "what do you already know?"
    // round-trip first.
    const wantsDirectExplanation =
      parsedInput.forceDirectAnswer ||
      /\b(explain|explain it|explain this|teach me|walk me through|break it down|i don'?t (get|understand) (it|this)|help me understand)\b/i.test(
        parsedInput.content,
      );
    const explainDirective =
      "\n\n(The student EXPLICITLY asked for an explanation — start teaching NOW, no probing, no \"what do you know\". But teach like a REAL tutor: this turn covers only the FIRST beat — the core idea in plain everyday words plus one example, chalked on the board — then check in (\"does that make sense?\"). The lesson continues beat by beat over the next turns.)";

    // New-problem start (user spec: "when I say lets solve (the question)" the
    // question must appear on the blackboard). The backend chalks the problem
    // itself; the model is told so it starts teaching instead of re-chalking.
    const newProblem = isNewProblemStatement(parsedInput.content);
    // A bare "what is…" question mid-lesson is a question, not a board wipe —
    // only wipe when the tutor ink is stale AND the student pivots explicitly
    // ("let's solve…", "teach me…") or the session has no topic yet.
    const strongReset =
      newProblem &&
      (!/^(what|why|how|define|describe)\b/i.test(parsedInput.content.trim()) ||
        !session.extractedProblem);
    const problemDirective = newProblem
      ? "\n\n(A NEW TOPIC JUST STARTED: the problem/request has already been chalked on the board for you — do NOT re-chalk it yourself. Begin teaching THIS, one small beat at a time, plain everyday language.)"
      : "";

    const baseMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "system", content: contextPack },
      ...history,
      {
        role: "user",
        content:
          parsedInput.forceDirectAnswer
            ? `${parsedInput.content}\n\n(The student explicitly requests a direct explanation. Provide the answer WITH reasoning, labeled as an explanation — but in beats: the key idea + the reasoning in plain words, then check in before going further.)`
            : wantsDirectExplanation
              ? `${parsedInput.content}${explainDirective}`
              : parsedInput.content,
      },
    ];
    // The new-topic directive rides on the LAST user message (some free
    // models weigh the final message far more than the system prompt).
    if (problemDirective) {
      const lastUser = [...baseMessages].reverse().find((m) => m.role === "user");
      if (lastUser) lastUser.content += problemDirective;
    }

    // Stream, forwarding deltas and accumulating the raw output. If the
    // stream aborts mid-generation (timeout, hiccup), retry once without
    // streaming — local models are slow and this recovers gracefully instead
    // of surfacing an error after the student already waited (PRD §14).
    let raw = "";
    try {
      for await (const delta of provider.streamChat({
        messages: baseMessages,
        forceJson: true,
        temperature: 0.7,
      })) {
        raw += delta;
        if (onToken) await onToken(delta);
      }
    } catch (streamError) {
      try {
        const response = await provider.chat({
          messages: baseMessages,
          forceJson: true,
          temperature: 0.7,
        });
        raw = response.content;
      } catch {
        throw streamError;
      }
    }

    const previousHintLevel =
      this.deps.messages.lastTutorMessage(sessionId)?.hintLevel ?? 0;
    const { structured, raw: finalRaw, fellBackToText } =
      await this.validateOrRepair(provider, baseMessages, raw, previousHintLevel);

    // Gamification (ADR-0006): if the previous tutor turn posed a quiz, this
    // student message IS the answer — grade it, award XP, persist the result.
    const previousTurn = this.deps.messages.lastTutorMessage(sessionId);
    const pendingQuiz = previousTurn?.quiz;
    // Retry loop (user spec: after an incorrect attempt the student gets to
    // try again, and BOTH attempts stay on the board). A wrong answer keeps
    // the same quiz pending; the student only escapes it by answering
    // correctly or explicitly starting a new problem.
    const movedOn = newProblem && strongReset;
    const answeringQuiz =
      pendingQuiz != null && !movedOn && !answerIsNewRequest(pendingQuiz, parsedInput.content);
    // Free models sometimes attach a STALE grading — one from an earlier
    // question — to the answer of the CURRENT one (user-reported bug: the
    // Bastille answer got graded against an old tax-system question). Any
    // grading produced for a message that is not the pending quiz's answer
    // is discarded here; the pending quiz is graded fresh below.
    if (structured.quiz_grading && !answeringQuiz) {
      structured.quiz_grading = undefined;
    }
    // Free models sometimes omit "quiz_grading" even when a quiz is pending.
    // Grade deterministically server-side as a fallback: a quiz answer may
    // never go ungraded, or the student loses their marks (ADR-0006).
    if (answeringQuiz && !structured.quiz_grading) {
      structured.quiz_grading = fallbackGrade(pendingQuiz!, parsedInput.content);
      if (structured.quiz_grading) {
        // Natural spoken sentence, not a meta annotation (user spec: the
        // speech layer must never read labels like "(Marked: …)").
        structured.message = `${structured.message}\n\n${structured.quiz_grading.correct ? "That's right" : "Not quite"} — ${structured.quiz_grading.feedback}`;
      }
    }
    let xpAward: number | undefined;
    let quizCorrectDelta: number | undefined;
    let statsAfter: import("@local-live-tutor/shared").StudyStats | undefined;
    let newBadges: import("@local-live-tutor/shared").BadgeId[] = [];
    if (answeringQuiz && structured.quiz_grading) {
      // Gamification stats (ADR-0007): streaks, totals, badge unlocks.
      const recorded = this.deps.studyStats.recordAnswer(
        structured.quiz_grading.correct,
        structured.quiz_grading.correct ? XP_CORRECT_QUIZ : XP_PARTICIPATION,
      );
      statsAfter = recorded.stats;
      newBadges = recorded.newBadges;
      this.deps.quiz.create({
        sessionId,
        question: pendingQuiz.question,
        correct: structured.quiz_grading.correct,
        feedback: structured.quiz_grading.feedback,
      });
      if (structured.quiz_grading.correct) {
        xpAward = XP_CORRECT_QUIZ;
        quizCorrectDelta = 1;
      } else {
        xpAward = XP_PARTICIPATION;
      }
      // Spaced repetition (roadmap): if the graded quiz was a warm-up card,
      // the review outcome moves its schedule (good → interval grows,
      // forgot → back to learning).
      if (pendingQuiz) {
        const card = this.deps.srs?.matchFront(session.profileId, pendingQuiz.question);
        if (card) {
          this.deps.srs?.grade(
            session.profileId,
            card.front,
            structured.quiz_grading.correct ? 2 : 0,
          );
        }
      }
    }

    const tutorMessage = this.deps.messages.create({
      id: crypto.randomUUID(),
      sessionId,
      role: "tutor",
      content: structured.message,
      responseType: structured.response_type,
      hintLevel: structured.hint_level,
      answerRevealed: structured.answer_revealed,
      // Retry (user spec: an incorrect attempt stays on the board AND the
      // student gets to try again): a wrong answer keeps the quiz pending —
      // it rides on this grading message — so the NEXT student message is
      // graded as the retry. Each attempt is graded and chalked in turn.
      // Quiz pending-pointer: a WRONG answer keeps the SAME question pending
      // (retry guarantee — the student tries again, both attempts chalked);
      // a CORRECT answer clears it; a newly posed quiz takes over otherwise;
      // side requests (hints, questions) ride the pending quiz forward.
      quiz:
        answeringQuiz && structured.quiz_grading
          ? structured.quiz_grading.correct
            ? undefined
            : pendingQuiz
          : (structured.quiz ?? (pendingQuiz && !movedOn ? pendingQuiz : undefined)),
      quizGrading: structured.quiz_grading,
      flashcards: structured.flashcards,
      subject: structured.subject,
      xpAwarded: xpAward,
    });
    // Spaced repetition (roadmap): every flashcard the tutor generates is
    // scheduled, so future lessons can warm up on it. No-op when none.
    // Repeated-behavior signals (self-improving personalization, spec §8):
    // recurring hint requests / simplify requests bump pattern counters so
    // the UI can offer the student a one-tap confirm. Never auto-saves.
    this.trackPatterns(session, parsedInput.content);
    if (structured.flashcards && structured.flashcards.length > 0) {
      this.deps.srs?.upsertMany(session.profileId, structured.flashcards);
    }
    if (answeringQuiz && structured.quiz_grading) {
      // Quiz results reference the grading tutor message.
      this.deps.quiz.linkMessage(tutorMessage.id, sessionId, pendingQuiz!.question);
    }

    const validOps = this.extractValidOps(structured.whiteboard_operations);

    // ---- Deterministic board guarantees (user-reported gaps the model can't
    // be trusted with) ----
    // 1) New problem: clear the board AND chalk the problem verbatim. The
    // student said "let's solve X" — the question MUST be on the board and
    // the previous explanation MUST be gone.
    let finalOps: Array<{ type: WhiteboardOpType; payload: Record<string, unknown> }> = validOps;
    if (newProblem && strongReset) {
      const problemText = extractProblemText(parsedInput.content);
      const openingIllo = await buildIllustrationOp(problemText, structured.message);
      // APPEND-ONLY BOARD (user spec: the blackboard is the permanent record
      // of the whole session — the earlier question and every step stay).
      // A new problem opens a clearly-marked SECTION and flows BELOW the
      // existing chalk; nothing is erased or overwritten.
      finalOps = [
        {
          type: "write" as const,
          payload: {
            x: 40,
            y: 60,
            text: "─── New problem ───",
            kind: "fact" as const,
          },
        },
        {
          type: "write" as const,
          payload: {
            x: 40,
            y: 60,
            text: `Problem: ${problemText}`,
            kind: "question" as const,
          },
        },
        // Illustrate the new topic immediately — the picture is part of the
        // explanation, fetched from the internet, not decoration.
        ...(openingIllo ? [openingIllo] : []),
        // Keep only model ops that are not echo-writes of the problem itself.
        ...validOps.filter(
          (op) =>
            op.type !== "clear_region" &&
            !(
              op.type === "write" &&
              String(op.payload.text ?? "").includes(problemText.slice(0, 40))
            ),
        ),
      ];
    }
    // 2) Quiz question posed but never chalked → chalk it (it stays visible
    // while the student thinks — PRD board discipline, model-proof).
    if (structured.quiz) {
      const quizOp = buildQuizChalkOp(structured.quiz, finalOps);
      if (quizOp) finalOps = [...finalOps, quizOp];
    }
    // 3) Explanation beats: if the model drew nothing and answered nothing
    // quiz-wise, attach a topical illustration so visual understanding is
    // not dependent on model compliance (rate-limited via topic freshness).
    const drewVisual = finalOps.some(
      (op) => op.type === "image" || op.type === "draw_equation" || op.type === "highlight" || op.type === "circle" || op.type === "arrow",
    );
    if (!drewVisual && structured.response_type === "explanation") {
      const illo = await buildIllustrationOp(session.extractedProblem ?? session.title, structured.message);
      if (illo) finalOps = [...finalOps, illo];
    }
    const modelEchoed = validOps.some(
      (op) => op.type === "write" && /^you\s*:/i.test(String(op.payload.text ?? "")),
    );
    const echoOp =
      modelEchoed
        ? []
        : [
            {
              type: "write" as const,
              payload: {
                x: 40,
                y: 60,
                text: `You: ${parsedInput.content.slice(0, 200)}`,
                color: "student",
                kind: "answer",
              },
            },
          ];
    // Deterministic verdict chalk (user spec): the ✓/✗ line lands directly
    // under the student's attempt — both stay on the board forever. Every
    // graded attempt gets one; the model is never trusted to mark it.
    const verdictOp =
      structured.quiz_grading ? [buildVerdictOp(structured.quiz_grading)] : [];
    const assembledOps: Array<{
      type: WhiteboardOpType;
      payload: Record<string, unknown>;
    }> = [...echoOp, ...verdictOp, ...finalOps];
    const ops = this.deps.ops.appendMany(
      assembledOps.map((op) => ({
        sessionId,
        messageId: tutorMessage.id,
        actor: (op.type === "write" && op.payload.color === "student"
          ? "student"
          : "tutor") as "tutor" | "student",
        type: op.type,
        payload: op.payload,
      })),
    );

    // Topic capture: a fresh session learns WHAT the student wants to study
    // from the tutor's first content turn, and the session title follows it.
    const patch: UpdateSessionInput & {
      xpAward?: number;
      quizCorrectDelta?: number;
      quizAskedDelta?: number;
    } = {};
    if (!session.extractedProblem && structured.topic) {
      patch.extractedProblem = structured.topic;
      patch.title = structured.topic.slice(0, 120);
      patch.currentGoal = structured.student_action ?? `Learning: ${structured.topic}`;
    }
    // Subject pill (user spec): the tutor classifies what is actually being
    // studied; persist it so the board pill reflects the real material.
    if (structured.subject && structured.subject !== session.subject) {
      patch.subject = structured.subject;
    }
    if (xpAward !== undefined) patch.xpAward = xpAward;
    if (quizCorrectDelta !== undefined) patch.quizCorrectDelta = quizCorrectDelta;
    // Every graded ATTEMPT counts as asked (retries included) — the score
    // stays an honest record of what the student answered, never gamed.
    if (answeringQuiz && structured.quiz_grading) patch.quizAskedDelta = 1;
    if (Object.keys(patch).length > 0) {
      this.deps.sessions.update(sessionId, patch);
    } else {
      this.deps.sessions.update(sessionId, {});
    }

    return {
      studentMessage,
      tutorMessage,
      whiteboardOps: ops,
      provider: provider.id,
      model: provider.model,
      fellBackToText,
      xpAwarded: xpAward,
      session: this.deps.sessions.getById(sessionId) ?? session,
      stats: statsAfter,
      newBadges,
    };
  }

  /**
   * Lesson opener (ADR-0005): once the problem is confirmed, the tutor
   * proactively chalks the problem and asks its diagnostic question — no
   * student message needed to start. Speaks + writes, Pengi-style.
   */
  async openLesson(
    sessionId: string,
    onToken?: (delta: string) => void | Promise<void>,
  ): Promise<TutorTurnResult> {
    const session = await this.requireSession(sessionId);
    // Idle auto-save: a "· paused" lesson reopens too — the greeting re-run
    // resumes it (same rule as handleStudentMessage).
    if (session.status === "completed" && (session.title?.includes("· paused") ?? false)) {
      const reopened = this.deps.sessions.update(sessionId, {
        status: "active",
        title: (session.title ?? "").replace(/\s*·\s*paused\s*$/, ""),
      });
      if (reopened) {
        session.status = "active";
        session.title = reopened.title ?? session.title;
      }
    } else if (session.status === "completed") {
      throw Errors.validation("This session is already completed. Start a new session.");
    }

    const { provider } = await this.deps.registry.resolve();
    const style = this.effectiveLessonStyle(session);
    const systemPrompt = buildSystemPrompt({
      subject: session.subject,
      gradeLevel: session.gradeLevel,
      helpLevel: session.helpLevel,
      mode: session.mode,
      maxHintLevel: this.maxHintLevel(session, false),
      persona: style.persona,
      language: style.language,
      studentPreferences: this.studentPreferences(session),
    });
    const recentOps = this.deps.ops
      .listBySession(sessionId)
      .slice(-12)
      .map((op) => ({ type: op.type, payload: op.payload }));

    // Spaced-repetition warm-up (roadmap): flashcards from earlier lessons
    // that are due resurface at the start of THIS lesson, before new material.
    const dueCards = this.deps.srs?.due(session.profileId) ?? [];
    const warmup = dueCards.length > 0 ? warmupRequest(dueCards) : null;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "system", content: this.sessionContextPack(session, recentOps) },
      {
        role: "user",
        content:
          (session.extractedProblem
            ? "The student just confirmed the problem on the board. Open the lesson: greet briefly, write the problem on the board, and ask your first diagnostic question. Respond with the JSON schema."
            : 'The student just opened a brand-new session. Greet them warmly and ask "What are we learning today?" (adjust the wording so it feels natural). Do NOT invent a topic and do not write lesson content on the board yet — this is only the hello. Respond with the JSON schema; whiteboard_operations should be empty.') +
          (warmup ? `\n\n${warmup}` : ""),
      },
    ];

    let raw = "";
    for await (const delta of provider.streamChat({
      messages,
      forceJson: true,
      temperature: 0.7,
    })) {
      raw += delta;
      if (onToken) await onToken(delta);
    }

    const { structured, fellBackToText } = await this.validateOrRepair(
      provider,
      messages,
      raw,
      0,
    );

    const tutorMessage = this.deps.messages.create({
      id: crypto.randomUUID(),
      sessionId,
      role: "tutor",
      content: structured.message,
      responseType: structured.response_type,
      hintLevel: structured.hint_level,
      answerRevealed: structured.answer_revealed,
      isGreeting: !session.extractedProblem,
    });

    const validOps = this.extractValidOps(structured.whiteboard_operations);

    // Deterministic problem chalk (user bug: the confirmed problem was spoken
    // but not always on the board). A confirmed problem is ALWAYS chalked
    // verbatim with a fresh tutor surface; model ops that duplicate it are
    // dropped, and the topic gets its internet illustration immediately.
    const problemText = (session.extractedProblem ?? "").trim();
    const probe = problemText.replace(/\s+/g, " ").slice(0, 40).toLowerCase();
    const modelChalkedProblem =
      probe.length >= 4 &&
      validOps.some(
        (op) =>
          (op.type === "write" || op.type === "draw_equation") &&
          String(op.payload.text ?? op.payload.latex ?? "").toLowerCase().includes(probe),
      );
    const openingIllo = await buildIllustrationOp(problemText, structured.message);
    const problemWriteOp: { type: WhiteboardOpType; payload: Record<string, unknown> } = {
      type: "write",
      payload: {
        x: 40,
        y: 60,
        text: `Problem: ${problemText.slice(0, 300)}`,
        kind: "question",
      },
    };
    const guaranteedOps: Array<{ type: WhiteboardOpType; payload: Record<string, unknown> }> =
      problemText.length > 0
        ? [
            // Append-only board: a confirmed problem opens a new section
            // below any existing chalk instead of erasing the board.
            {
              type: "write" as const,
              payload: {
                x: 40,
                y: 60,
                text: "─── New problem ───",
                kind: "fact",
              },
            },
            ...(modelChalkedProblem ? [] : [problemWriteOp]),
            ...(openingIllo ? [openingIllo] : []),
            ...validOps.filter(
              (op) =>
                op.type !== "clear_region" &&
                !(
                  op.type === "write" &&
                  probe.length >= 4 &&
                  String(op.payload.text ?? "").toLowerCase().includes(probe)
                ),
            ),
          ]
        : validOps;

    const ops = this.deps.ops.appendMany(
      guaranteedOps.map((op) => ({
        sessionId,
        messageId: tutorMessage.id,
        actor: "tutor" as const,
        type: op.type,
        payload: op.payload,
      })),
    );

    this.deps.sessions.update(sessionId, {});

    return {
      studentMessage: null as unknown as Message,
      tutorMessage,
      whiteboardOps: ops,
      provider: provider.id,
      model: provider.model,
      fellBackToText,
      session: this.deps.sessions.getById(sessionId) ?? session,
    };
  }

  /** End-of-session recap (PRD Flow A step 13). */
  async generateSummary(sessionId: string): Promise<Message> {
    const session = await this.requireSession(sessionId);
    const history = this.historyTurns(sessionId);
    const { provider } = await this.deps.registry.resolve();
    const style = this.effectiveLessonStyle(session);

    const systemPrompt = buildSystemPrompt({
      subject: session.subject,
      gradeLevel: session.gradeLevel,
      helpLevel: session.helpLevel,
      mode: session.mode,
      maxHintLevel: this.maxHintLevel(session, false),
      persona: style.persona,
      language: style.language,
      studentPreferences: this.studentPreferences(session),
    });
    const { turns } = selectHistory(
      history.map((m) => ({
        role: m.role === "assistant" ? "tutor" : m.role === "user" ? "student" : "system",
        content: m.content,
      })),
      4000,
      20,
    );
    const chatTurns: ChatMessage[] = turns.map((t) => ({
      role: t.role === "tutor" ? "assistant" : t.role === "student" ? "user" : "system",
      content: t.content,
    }));
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "system", content: this.sessionContextPack(session, []) },
      ...chatTurns,
      {
        role: "user",
        content:
          "The session is ending. Produce a JSON response of type \"summary\": a short recap (2-4 sentences) of the concepts the student worked through, one thing they did well, and one concrete practice suggestion. Do not include whiteboard operations.",
      },
    ];

    let raw = "";
    try {
      const response = await provider.chat({ messages, forceJson: true, temperature: 0.4 });
      raw = response.content;
    } catch (error) {
      // Deterministic fallback recap keeps the feature usable offline.
      const lastFew = this.deps.messages
        .listBySession(sessionId)
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      const message = this.deps.messages.create({
        id: crypto.randomUUID(),
        sessionId,
        role: "tutor",
        content: `Session recap (offline fallback):\n${lastFew}`,
        responseType: "summary",
        hintLevel: 0,
        answerRevealed: false,
      });
      void error;
      return message;
    }

    const parsed = tutorResponseSchema.safeParse(tryParseJsonObject(raw) ?? {});
    const content = parsed.success
      ? parsed.data.message
      : raw.replace(/```(?:json)?/gi, "").trim() || "Session recap could not be generated.";
    return this.deps.messages.create({
      id: crypto.randomUUID(),
      sessionId,
      role: "tutor",
      content,
      responseType: "summary",
      hintLevel: 0,
      answerRevealed: parsed.success ? parsed.data.answer_revealed : false,
    });
  }

  /**
   * End-of-lesson ritual (ADR-0009): erase the board, chalk a compact recap
   * takeaway card, and stream the spoken sign-off. Persists the summary
   * message plus the clear_region + recap write ops, marks the session
   * completed, and returns the full turn result for the SSE route.
   */
  async recapLesson(
    sessionId: string,
    onToken?: (delta: string) => void | Promise<void>,
  ): Promise<TutorTurnResult> {
    const session = await this.requireSession(sessionId);
    const history = this.historyTurns(sessionId);
    const { provider } = await this.deps.registry.resolve();
    const style = this.effectiveLessonStyle(session);

    const systemPrompt = buildSystemPrompt({
      subject: session.subject,
      gradeLevel: session.gradeLevel,
      helpLevel: session.helpLevel,
      mode: session.mode,
      maxHintLevel: this.maxHintLevel(session, false),
      persona: style.persona,
      language: style.language,
      studentPreferences: this.studentPreferences(session),
    });
    const { turns } = selectHistory(
      history.map((m) => ({
        role: m.role === "assistant" ? "tutor" : m.role === "user" ? "student" : "system",
        content: m.content,
      })),
      4000,
      20,
    );
    const chatTurns: ChatMessage[] = turns.map((t) => ({
      role: t.role === "tutor" ? "assistant" : t.role === "student" ? "user" : "system",
      content: t.content,
    }));
    const recentOps = this.deps.ops
      .listBySession(sessionId)
      .slice(-12)
      .map((op) => ({ type: op.type, payload: op.payload }));

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "system", content: this.sessionContextPack(session, recentOps) },
      ...chatTurns,
      { role: "user", content: RECAP_REQUEST },
    ];

    let raw = "";
    try {
      for await (const delta of provider.streamChat({
        messages,
        forceJson: true,
        temperature: 0.4,
      })) {
        raw += delta;
        if (onToken) await onToken(delta);
      }
    } catch {
      // Streaming failure falls through to the deterministic ritual below.
      raw = "";
    }

    const parsed = tutorResponseSchema.safeParse(tryParseJsonObject(raw) ?? {});
    const structured = parsed.success ? parsed.data : undefined;

    // Deterministic fallback keeps the ritual intact when the model fails —
    // the student always gets an erase, a takeaway card, and a sign-off.
    const spoken =
      structured?.message ??
      `Great work today! We wrapped up ${session.extractedProblem ?? session.subject} — you asked good questions and pushed through the hard parts. Before next time, try explaining the main idea out loud in your own words. See you soon!`;
    const recapText =
      (structured?.whiteboard_operations ?? []).find(
        (op) => op.type === "write" && typeof (op.payload as { text?: unknown }).text === "string",
      )?.payload as { text?: string } | undefined;

    const ritualOps: { type: WhiteboardOpType; payload: Record<string, unknown> }[] = [
      { type: "clear_region", payload: { region: "all" } },
      {
        type: "write",
        payload: {
          x: 120,
          y: 160,
          kind: "explanation",
          text:
            recapText?.text ??
            `Lesson recap: ${session.extractedProblem ?? session.subject}\n• We worked through it step by step\n• Next: explain it back in your own words`,
        },
      },
    ];

    const tutorMessage = this.deps.messages.create({
      id: crypto.randomUUID(),
      sessionId,
      role: "tutor",
      content: spoken,
      responseType: "summary",
      hintLevel: 0,
      answerRevealed: structured?.answer_revealed ?? false,
    });

    const ops = this.deps.ops.appendMany(
      ritualOps.map((op) => ({
        sessionId,
        messageId: tutorMessage.id,
        actor: "tutor" as const,
        type: op.type,
        payload: op.payload,
      })),
    );

    this.deps.sessions.update(sessionId, { status: "completed" });

    const result: TutorTurnResult = {
      studentMessage: null as unknown as Message,
      tutorMessage,
      whiteboardOps: ops,
      provider: provider.id,
      model: provider.model,
      fellBackToText: !structured,
      session: this.deps.sessions.getById(sessionId) ?? session,
    };
    // Conversational finish: handleStudentMessage may forward this result as
    // the turn when the student says they're done.
    this.lastRecapResult = result;
    return result;
  }

  /**
   * Vision-based problem extraction (PRD §5.2, Milestone 3). Requires a
   * vision-capable provider; unclear results raise the §14 ocr_unclear state.
   */
  async extractProblem(
    sessionId: string,
    imageBase64: string,
    imageMime: string,
  ): Promise<ExtractionResult> {
    await this.requireSession(sessionId);
    const { provider } = await this.deps.registry.resolve();
    if (typeof provider.vision !== "function") {
      throw Errors.visionUnsupported();
    }

    const response = await provider.vision({
      imageBase64,
      imageMime,
      forceJson: true,
      messages: [
        {
          role: "system",
          content:
            "You extract math and science problems from images. Never solve the problem. Return ONLY JSON: {\"text\": string, \"entities\": [{\"kind\": \"variable\"|\"equation\"|\"diagram\"|\"answer_choice\", \"value\": string}], \"unclear\": boolean, \"unclearNote\": string?}. If parts are unreadable, set unclear=true and explain in unclearNote.",
        },
        { role: "user", content: "Extract the problem text from this image." },
      ],
    });

    const parsed = tryParseJsonObject(response.text) ?? {};
    const result = {
      text: typeof parsed.text === "string" ? parsed.text : "",
      entities: Array.isArray(parsed.entities)
        ? (parsed.entities as ExtractionResult["entities"])
        : [],
      unclear: parsed.unclear === true,
      unclearNote:
        typeof parsed.unclearNote === "string" ? parsed.unclearNote : undefined,
    };
    if (result.unclear || result.text.trim().length === 0) {
      throw Errors.ocrUnclear(result.unclearNote);
    }
    return result;
  }
}
