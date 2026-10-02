/**
 * End-to-end smoke test against a running backend (default mock provider).
 * Usage: node scripts/smoke.mjs [baseUrl]
 */
const base = process.argv[2] ?? "http://127.0.0.1:8787";

const req = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text}`);
  return data;
};

const session = await req("POST", "/api/sessions", {
  subject: "math",
  gradeLevel: "middle_school",
  helpLevel: "socratic",
  mode: "homework",
});
console.log("✓ session created", session.id);

await req("POST", `/api/sessions/${session.id}/problem/text`, { text: "3/4 + 1/2 = ?" });
await req("POST", `/api/sessions/${session.id}/problem/confirm`, { text: "3/4 + 1/2 = ?" });
console.log("✓ problem set + confirmed");

const turn1 = await req("POST", `/api/sessions/${session.id}/messages`, {
  content: "I have no idea where to start.",
});
console.log("✓ turn 1:", JSON.stringify({
  type: turn1.tutorMessage.responseType,
  hint: turn1.tutorMessage.hintLevel,
  ops: turn1.whiteboardOps.length,
}));

const turn2 = await req("POST", `/api/sessions/${session.id}/messages`, {
  content: "Maybe find a common denominator?",
});
console.log("✓ turn 2:", JSON.stringify({
  type: turn2.tutorMessage.responseType,
  hint: turn2.tutorMessage.hintLevel,
}));

const turn3 = await req("POST", `/api/sessions/${session.id}/messages`, {
  content: "Is it 4?",
});
console.log("✓ turn 3:", JSON.stringify({
  type: turn3.tutorMessage.responseType,
  hint: turn3.tutorMessage.hintLevel,
  misconception: turn3.tutorMessage.answerRevealed,
}));

const direct = await req("POST", `/api/sessions/${session.id}/messages`, {
  content: "Explain it directly please.",
  forceDirectAnswer: true,
});
console.log("✓ direct request:", JSON.stringify({
  type: direct.tutorMessage.responseType,
  revealed: direct.tutorMessage.answerRevealed,
}));

// SSE streaming check (before the recap completes the session)
const streamResponse = await fetch(`${base}/api/sessions/${session.id}/messages/stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "I understand this step now." }),
});
const raw = await streamResponse.text();
console.log(
  raw.includes("event: done")
    ? "✓ SSE stream ends with done event"
    : `✗ SSE stream malformed: ${raw.slice(0, 200)}`,
);

const summary = await req("POST", `/api/sessions/${session.id}/summary`, {});
console.log("✓ summary:", summary.responseType, "—", summary.content.slice(0, 60), "…");

const board = await req("GET", `/api/sessions/${session.id}/whiteboard`);
console.log("✓ board ops persisted:", board.operations.length);

await req("DELETE", `/api/sessions/${session.id}`);
console.log("✓ session deleted — SMOKE TEST PASSED");
