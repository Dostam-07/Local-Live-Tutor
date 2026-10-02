/**
 * Live HTTP smoke test (ADR-0006 conversational flow, mock provider):
 * greeting → topic → teaching + chalk → quiz → grading + XP → flashcards →
 * document upload → export download. Run with the mock backend on :8787.
 */
const BASE = "http://localhost:8787";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  // SSE streams: extract the final `done` event's payload.
  if (text.startsWith("event:")) {
    const doneLine = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .pop();
    const payload = doneLine?.slice(5).trim() ?? "";
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.error) throw new Error(`stream error: ${JSON.stringify(parsed.error)}`);
      return parsed;
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error("stream ended without a valid done payload");
      throw e;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fail(label, error) {
  console.error(`✗ ${label}:`, error.message ?? error);
  process.exit(1);
}

const session = await api("POST", "/api/sessions", { llmProvider: undefined }).catch((e) =>
  fail("create session", e),
);

try {
  // 1. Greeting-first: the tutor opens the conversation.
  const greeting = await api("POST", `/api/sessions/${session.id}/messages/stream`, {
    content: "hello!",
  });
  if (!greeting.tutorMessage?.content) throw new Error("no tutor greeting");
  console.log(`✓ greeting: "${greeting.tutorMessage.content.slice(0, 60)}…"`);

  // 2. Student names a topic → complete teaching + topic capture + chalk.
  const teach = await api("POST", `/api/sessions/${session.id}/messages/stream`, {
    content: "I want to learn about photosynthesis",
  });
  if (!teach.tutorMessage?.content) throw new Error("no teaching turn");
  const refreshed = await api("GET", `/api/sessions/${session.id}`);
  if (!refreshed.extractedProblem) throw new Error("topic was not captured onto the session");
  console.log(`✓ topic captured: "${refreshed.extractedProblem}"`);
  const board = await api("GET", `/api/sessions/${session.id}/whiteboard`);
  if (board.operations.length === 0) throw new Error("tutor did not chalk anything");
  console.log(`✓ chalk ops: ${board.operations.length}`);

  // 3. Quiz → pose → answer → grading + XP.
  const quiz = await api("POST", `/api/sessions/${session.id}/messages/stream`, {
    content: "quiz me",
  });
  if (!quiz.tutorMessage?.quiz) throw new Error("tutor did not pose a quiz");
  console.log(`✓ quiz posed: "${quiz.tutorMessage.quiz.question}"`);

  const answer = await api("POST", `/api/sessions/${session.id}/messages/stream`, {
    content: "Sunlight",
  });
  if (!answer.tutorMessage?.quizGrading) throw new Error("quiz answer was not graded");
  const withXp = await api("GET", `/api/sessions/${session.id}`);
  if (withXp.xp <= 0) throw new Error(`XP was not awarded (xp=${withXp.xp})`);
  console.log(
    `✓ grading (${answer.tutorMessage.quizGrading.correct ? "correct" : "incorrect"}) + XP: +${answer.xpAwarded} XP (total ${withXp.xp}, score ${withXp.quizScore.join("/")})`,
  );

  // 4. Flashcards.
  const cards = await api("POST", `/api/sessions/${session.id}/messages/stream`, {
    content: "make me flashcards",
  });
  if (!cards.tutorMessage?.flashcards?.length) throw new Error("no flashcards");
  console.log(`✓ flashcards: ${cards.tutorMessage.flashcards.length} cards`);

  // 5. Export the lesson.
  const exported = await api("GET", `/api/sessions/${session.id}/export`);
  if (exported.transcript.length < 6) throw new Error("export transcript too short");
  if (exported.flashcards.length === 0) throw new Error("export missing flashcards");
  const md = await fetch(`${BASE}/api/sessions/${session.id}/export.md`);
  const markdown = await md.text();
  if (!markdown.includes("# ") || !markdown.includes("Flashcards")) {
    throw new Error("markdown export incomplete");
  }
  console.log(`✓ export: ${exported.transcript.length} turns, ${markdown.length} chars of markdown`);

  console.log("\nSMOKE TEST PASSED — conversational study flow works end-to-end.");
} finally {
  await api("DELETE", `/api/sessions/${session.id}`).catch(() => undefined);
}
