/**
 * Smoke test for the ADR-0005 lesson opener: confirm a problem, then the
 * tutor proactively opens the lesson (chalks the problem + asks a question).
 */
const BASE = "http://localhost:8787";

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return res.json();
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

const del = async (path) => {
  await fetch(`${BASE}${path}`, { method: "DELETE" });
};

const run = async () => {
  const session = await post("/api/sessions", {});
  console.log(`✓ session created ${session.id}`);

  await post(`/api/sessions/${session.id}/problem/text`, { text: "3/4 + 1/2 = ?" });
  await post(`/api/sessions/${session.id}/problem/confirm`, { text: "3/4 + 1/2 = ?" });
  console.log("✓ problem set + confirmed");

  // Lesson opener via SSE.
  const res = await fetch(`${BASE}/api/sessions/${session.id}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const raw = await res.text();
  const doneBlock = raw
    .split("\n\n")
    .find((b) => b.startsWith("event: done"));
  if (!doneBlock) throw new Error(`no done event: ${raw.slice(0, 300)}`);
  const turn = JSON.parse(doneBlock.replace(/^event: done\ndata: /, ""));
  console.log(
    `✓ lesson opened: type=${turn.tutorMessage.responseType} ops=${turn.whiteboardOps.length} msg="${turn.tutorMessage.content.slice(0, 60)}…"`,
  );
  if (turn.whiteboardOps.length === 0) throw new Error("opener wrote nothing on the board");
  if (turn.tutorMessage.answerRevealed) throw new Error("opener revealed the answer — integrity violation");

  const messages = await get(`/api/sessions/${session.id}/messages`);
  if (!messages.some((m) => m.role === "tutor")) throw new Error("opener message not persisted");
  console.log(`✓ opener persisted (${messages.length} messages)`);

  await del(`/api/sessions/${session.id}`);
  console.log("✓ session deleted — OPENER SMOKE TEST PASSED");
};

run().catch((err) => {
  console.error("SMOKE FAILED:", err.message);
  process.exit(1);
});
