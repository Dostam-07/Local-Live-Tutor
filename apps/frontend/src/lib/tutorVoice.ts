/**
 * Browser TTS voice selection (user spec: not only a male voice — the tutor
 * can sound female, male, or just "auto"). The Web Speech API exposes the
 * voice list client-side; this helper picks the best match for the saved
 * gender preference and remembers the exact chosen voice so it stays stable
 * across turns (Chrome otherwise shuffles its default between utterances).
 */

export type TutorVoicePref = "female" | "male" | "auto";

const LAST_VOICE_KEY = "tutor-tts-voice-uri";

/**
 * Heuristic voice-name classification. Browser voice names encode gender
 * inconsistently (e.g. "Microsoft Zira - English (Female)" vs "Google UK
 * English Female" vs bare names like "Samantha"); these lists cover the
 * common Windows/macOS/Chrome voice names, with explicit markers first.
 */
const FEMALE_MARKERS = [
  "female", "zira", "hazel", "susan", "samantha", "victoria", "karen", "moira",
  "tessa", "fiona", "serena", "allison", "ava", "joanna", "kendra", "kimberly",
  "salli", "nicole", "amy", "emma", "aria", "jenny", "michelle", "elsa", "sonia",
  "libby", "maisie", "clara", "natasha", "yan", "linda", "heather", "catherine",
];
const MALE_MARKERS = [
  "male", "david", "mark", "james", "george", "ryan", "guy", "eric", "brian",
  "arthur", "daniel", "alex", "fred", "tom", "richard", "christopher", "roger",
  "steffan", "william", "rishi", "liam", "noah", "oliver", "thomas",
];

function classify(voiceName: string): "female" | "male" | null {
  const name = voiceName.toLowerCase();
  if (name.includes("female")) return "female";
  if (name.includes("male") && !name.includes("female")) return "male";
  if (FEMALE_MARKERS.some((m) => name.includes(m))) return "female";
  if (MALE_MARKERS.some((m) => name.includes(m))) return "male";
  return null;
}

/**
 * Picks the best SpeechSynthesisVoice for the preference. Returns null when
 * speechSynthesis is unavailable or nothing matches — the caller then just
 * uses the browser default.
 */
export function pickTutorVoice(pref: TutorVoicePref): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const pool = voices.length > 0 ? voices : window.speechSynthesis.getVoices();
  if (pool.length === 0) return null;

  // English voices, ordered: local voices first (more reliable offline), then
  // network ones. Prefer the exact remembered voice for stability.
  const rememberedUri = localStorage.getItem(LAST_VOICE_KEY);
  const remembered = rememberedUri ? pool.find((v) => v.voiceURI === rememberedUri) : null;
  if (remembered && (pref === "auto" || classify(remembered.name) === pref)) {
    return remembered;
  }

  let chosen: SpeechSynthesisVoice | null = null;
  if (pref === "female" || pref === "male") {
    const target = pref;
    // Rank: explicit gender name match (prefer "natural"/"online" tiers which
    // sound better) → same-gender name heuristic → anything (fallback keeps
    // the tutor speaking rather than going silent).
    chosen =
      pool.find((v) => classify(v.name) === target && /natural|online|neural/i.test(v.name)) ??
      pool.find((v) => classify(v.name) === target) ??
      pool.find((v) => /natural|online|neural/i.test(v.name)) ??
      pool[0] ??
      null;
  } else {
    // Auto: the best-sounding default — a "natural"/"online" voice if present,
    // else the browser's own default, else the first English voice.
    chosen =
      pool.find((v) => /natural|online|neural/i.test(v.name)) ??
      pool.find((v) => v.default) ??
      pool[0] ??
      null;
  }
  if (chosen) {
    try {
      localStorage.setItem(LAST_VOICE_KEY, chosen.voiceURI);
    } catch {
      // Private mode: skipping persistence is fine.
    }
  }
  return chosen;
}

/** Warms the async voice list (Chrome populates it after a tick). */
export function primeVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  // getVoices() may return [] until voiceschanged fires; touching it and
  // listening once forces the load.
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}
