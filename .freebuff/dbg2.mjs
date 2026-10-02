import { LiveSpeechExtractor } from "../apps/frontend/src/lib/liveSpeech.ts";
const reply = JSON.stringify({ message: "Okay so, a fraction is just a division. Three quarters means 3 divided by 4." });
console.log("raw head:", JSON.stringify(reply.slice(0, 30)));
// Test findMessageValueStart path manually: search from seen=0
const extractor = new LiveSpeechExtractor("message");
const first = extractor.push(reply.slice(0, 40));
console.log("first push:", first, "spoken:", JSON.stringify(extractor.spoken));
const second = extractor.push(reply.slice(40, 80));
console.log("second push:", second, "spoken:", JSON.stringify(extractor.spoken));
