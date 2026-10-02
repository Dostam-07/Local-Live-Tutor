/**
 * Offline voice fallback (roadmap: language-accurate offline voices).
 *
 * Voice resolution order for a pinned lesson language:
 *   1. A native browser/OS voice for that language (best quality, instant).
 *   2. The local Piper server (backend /api/tts) when a voice model for the
 *      language is installed on this machine — the "Ollama-only setup" case:
 *      fully offline, correct language, no OS voice pack needed.
 *   3. Nothing native → the caller still sets utterance.lang (browser best
 *      effort) and surfaces a hint that Piper could fill the gap.
 *
 * No mock audio, ever: when Piper is not configured/reachable the probe
 * simply reports unavailable and the app behaves as before.
 */

export type PiperAvailability = {
  configured: boolean;
  serverUp: boolean;
  languages: string[];
  checkedAt: number;
};

let cached: PiperAvailability | null = null;
let inflight: Promise<PiperAvailability> | null = null;

/** Probes the backend for installed Piper voices (cached 60s). */
export async function piperAvailability(force = false): Promise<PiperAvailability> {
  if (!force && cached && Date.now() - cached.checkedAt < 60_000) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/tts/voices");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        configured: boolean;
        serverUp: boolean;
        languages: string[];
      };
      cached = { ...body, checkedAt: Date.now() };
    } catch {
      cached = { configured: false, serverUp: false, languages: [], checkedAt: Date.now() };
    }
    return cached;
  })();
  return inflight;
}

/** Test seam. */
export function resetPiperCache(): void {
  cached = null;
  inflight = null;
}

/** True when Piper can voice this language on this machine. */
export function piperHasLanguage(availability: PiperAvailability, language: string): boolean {
  return availability.configured && availability.languages.includes(language.split("-")[0]?.toLowerCase() ?? language);
}

/**
 * Speaks `text` through the local Piper server and plays the WAV. Resolves
 * true when playback was handed to an <audio> element (the caller treats the
 * turn as spoken), false when Piper cannot serve this language (caller falls
 * back to browser TTS). Accepts an onEnd callback because audio playback has
 * no utterance-style events in the speech queue.
 */
export async function speakViaPiper(
  text: string,
  language: string,
  onEnd?: () => void,
): Promise<boolean> {
  const availability = await piperAvailability();
  if (!piperHasLanguage(availability, language) || !availability.serverUp) return false;
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 4000), language }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    // Barge-in: any new speech must be able to stop this instantly.
    window.speechSynthesis?.cancel();
    audio.onended = () => {
      URL.revokeObjectURL(url);
      onEnd?.();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      onEnd?.();
    };
    await audio.play();
    return true;
  } catch {
    return false;
  }
}
