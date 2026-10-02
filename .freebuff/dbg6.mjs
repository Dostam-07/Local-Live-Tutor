import { LiveSpeechExtractor } from "../apps/frontend/src/lib/liveSpeech.ts";
const reply = JSON.stringify({ message: "First one. Second one. Third one here." });
const extractor = new LiveSpeechExtractor("message");
for (let i = 0; i < reply.length; i += 7) {
  const chunk = reply.slice(i, i + 7);
  const s = extractor.push(chunk);
  console.log(`push(${JSON.stringify(chunk)}):`, JSON.stringify(s), "| seen:", extractor.seen ?? "?");
}
