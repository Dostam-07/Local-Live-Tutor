/**
 * Read-only lesson watcher (development aid — never mutates session state).
 *
 * Usage: node scripts/watch-lesson.mjs <sessionId> [--stop]
 *
 * Polls GET /api/sessions/:id/messages and /api/sessions/:id/whiteboard every
 * 1.5 s, printing any NEW tutor/student messages and chalk ops as they land.
 * With --stop it exits when the tutor has spoken at least one message after a
 * student message count milestone (used to know a turn has finished).
 */
const BASE = "http://localhost:8787";
const sessionId = process.argv[2];
const stopFlag = process.argv.includes("--stop");

if (!sessionId) {
  console.error("usage: node scripts/watch-lesson.mjs <sessionId> [--stop]");
  process.exit(1);
}

const seenMessages = new Set();
const seenOps = new Set();

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function short(text, max = 220) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function describeOp(op) {
  const p = op.payload ?? {};
  switch (op.type) {
    case "write":
      return `chalk "${short(p.text, 60)}" at (${p.x ?? "?"}, ${p.y ?? "?"})`;
    case "erase":
      return `erase ${p.target ? `"${short(p.target, 30)}"` : "region"}`;
    case "arrow":
      return `arrow ${p.label ? `"${short(p.label, 30)}" ` : ""}(${p.from?.x ?? "?"},${p.from?.y ?? "?"})→(${p.to?.x ?? "?"},${p.to?.y ?? "?"})`;
    case "highlight":
      return `highlight ${p.target ?? ""}`;
    case "underline":
      return `underline ${p.target ?? ""}`;
    case "circle":
      return `circle ${p.target ?? ""}`;
    case "box":
      return `box ${p.target ?? ""}`;
    default:
      return `${op.type} ${JSON.stringify(p).slice(0, 60)}`;
  }
}

let lastTutorCount = 0;
let idleTurns = 0;

for (let i = 0; i < 400; i++) {
  try {
    const [session, messages, board] = await Promise.all([
      get(`/api/sessions/${sessionId}`),
      get(`/api/sessions/${sessionId}/messages`),
      get(`/api/sessions/${sessionId}/whiteboard`),
    ]);
    for (const m of messages) {
      const key = m.id;
      if (seenMessages.has(key)) continue;
      seenMessages.add(key);
      if (m.role === "tutor") {
        console.log(`\n[TUTOR] ${short(m.content)}`);
        if (m.quiz) console.log(`  quiz: ${short(m.quiz.question, 100)}`);
        if (m.flashcards?.length) console.log(`  flashcards: ${m.flashcards.length} cards`);
      } else {
        console.log(`\n[student] ${short(m.content, 120)}`);
      }
    }

    for (const op of board.operations ?? []) {
      if (seenOps.has(op.id)) continue;
      seenOps.add(op.id);
      console.log(`  [chalk] ${describeOp(op)}`);
    }

    const tutorCount = messages.filter((m) => m.role === "tutor").length;
    if (stopFlag) {
      // With --stop: exit after the message count has been stable for 3 polls.
      if (tutorCount > 0 && tutorCount === lastTutorCount) {
        idleTurns++;
        if (idleTurns >= 3) {
          console.log("\n--- watcher done ---");
          break;
        }
      } else {
        idleTurns = 0;
      }
      lastTutorCount = tutorCount;
    }
  } catch (e) {
    console.error(`watch error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
