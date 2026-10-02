import { LiveSpeechExtractor } from "../apps/frontend/src/lib/liveSpeech.ts";
const reply = JSON.stringify({ message: "First one. Second one. Third one here." });
const extractor = new LiveSpeechExtractor("message");
// push the WHOLE thing at once
console.log("whole push:", extractor.push(reply));
