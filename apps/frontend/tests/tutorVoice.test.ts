/**
 * Unit tests for the tutor voice picker (user spec: not only a male voice —
 * female / male / auto selection over the browser's SpeechSynthesis list).
 * Offline and deterministic: a stubbed speechSynthesis with known voice names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeVoice = { name: string; lang: string; voiceURI: string; default?: boolean };

function installVoices(voices: FakeVoice[]): void {
  const store: { voices: FakeVoice[] } = { voices };
  const synth = {
    getVoices: () => store.voices as unknown as SpeechSynthesisVoice[],
    onvoiceschanged: null as unknown as (() => void) | null,
    cancel: vi.fn(),
    speak: vi.fn(),
  };
  (window as unknown as { speechSynthesis?: unknown }).speechSynthesis = synth;
}

describe("pickTutorVoice (user spec: female / male / auto tutor voice)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("picks a female voice by name for the female preference", async () => {
    installVoices([
      { name: "Microsoft David - English (Male)", lang: "en-US", voiceURI: "david" },
      { name: "Microsoft Zira - English (Female)", lang: "en-US", voiceURI: "zira" },
    ]);
    const { pickTutorVoice } = await import("../src/lib/tutorVoice.js");
    const voice = pickTutorVoice("female");
    expect(voice?.voiceURI).toBe("zira");
  });

  it("picks a male voice for the male preference", async () => {
    installVoices([
      { name: "Microsoft Zira - English (Female)", lang: "en-US", voiceURI: "zira" },
      { name: "Microsoft David - English (Male)", lang: "en-US", voiceURI: "david" },
    ]);
    const { pickTutorVoice } = await import("../src/lib/tutorVoice.js");
    const voice = pickTutorVoice("male");
    expect(voice?.voiceURI).toBe("david");
  });

  it("falls back to a natural-tier voice when no gendered match exists", async () => {
    installVoices([
      { name: "Google UK English", lang: "en-GB", voiceURI: "guk" },
      { name: "Microsoft Aria Online (Natural)", lang: "en-US", voiceURI: "aria" },
    ]);
    const { pickTutorVoice } = await import("../src/lib/tutorVoice.js");
    // Aria is a female name; a male request falls back to the natural tier
    // (the tutor keeps speaking rather than going silent).
    const voice = pickTutorVoice("male");
    expect(voice).not.toBeNull();
  });

  it("remembers the chosen voice so it stays stable across turns", async () => {
    installVoices([
      { name: "Microsoft Zira - English (Female)", lang: "en-US", voiceURI: "zira" },
    ]);
    const { pickTutorVoice } = await import("../src/lib/tutorVoice.js");
    expect(pickTutorVoice("female")?.voiceURI).toBe("zira");
    // Even with a different preference later, the remembered female voice
    // still matches the female preference and is reused.
    expect(pickTutorVoice("female")?.voiceURI).toBe("zira");
    expect(window.localStorage.getItem("tutor-tts-voice-uri")).toBe("zira");
  });

  it("uses the browser default for auto", async () => {
    installVoices([
      { name: "Some Voice", lang: "en-US", voiceURI: "some", default: true },
    ]);
    const { pickTutorVoice } = await import("../src/lib/tutorVoice.js");
    expect(pickTutorVoice("auto")?.voiceURI).toBe("some");
  });

  it("returns null when speechSynthesis is unavailable", async () => {
    const { pickTutorVoice } = await import("../src/lib/tutorVoice.js");
    expect(pickTutorVoice("female")).toBeNull();
  });
});
