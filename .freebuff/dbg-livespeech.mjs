import { LiveSpeechExtractor } from "../apps/frontend/src/lib/liveSpeech.ts";
const reply = JSON.stringify({ message: "Okay so, a fraction is just a division. Three quarters means 3 divided by 4." });
const extractor = new LiveSpeechExtractor("message");
for (let i = 0; i < reply.length; i += 7) {
  const s = extractor.push(reply.slice(i, i + 7));
  if (s.length) console.log("SENT:", s);
}
console.log("flush:", extractor.flush());
console.log("spoken:", JSON.stringify(extractor.spoken));
