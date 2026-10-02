import { LiveSpeechExtractor } from "../apps/frontend/src/lib/liveSpeech.ts";
const reply = JSON.stringify({ message: "First one. Second one. Third one here." });
const extractor = new LiveSpeechExtractor("message");
for (let i = 0; i < reply.length; i += 7) {
  const s = extractor.push(reply.slice(i, i + 7));
  if (s.length) console.log("SENT:", JSON.stringify(s));
}
console.log("flush:", extractor.flush());
