/**
 * Unit tests for the multilingual helpers (roadmap): BCP-47 STT tags per
 * lesson language and gender-aware TTS voice matching — offline and
 * deterministic via a stubbed speechSynthesis.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

describe("sttLangTag", () => {
  it("maps lesson languages to BCP-47 STT tags", async () => {
    const { sttLangTag } = await import("../src/lib/lessonLanguage.js");
    expect(sttLangTag("es")).toBe("es-ES");
    expect(sttLangTag("hi")).toBe("hi-IN");
    expect(sttLangTag("fr")).toBe("fr-FR");
    expect(sttLangTag("zh")).toBe("zh-CN");
  });

  it("auto resolves to the browser UI language", async () => {
    const { sttLangTag } = await import("../src/lib/lessonLanguage.js");
    const original = navigator.language;
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    try {
      expect(sttLangTag("auto")).toBe("de-DE");
      expect(sttLangTag(undefined)).toBe("de-DE");
    } finally {
      Object.defineProperty(navigator, "language", { value: original, configurable: true });
    }
  });
});

describe("pickTutorVoiceForLanguage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubVoices(voices: Array<{ name: string; lang: string; voiceURI: string }>) {
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices as unknown as SpeechSynthesisVoice[],
    });
  }

  it("matches the lesson language exactly (Spanish lesson sounds Spanish)", async () => {
    const { pickTutorVoiceForLanguage } = await import("../src/lib/lessonLanguage.js");
    stubVoices([
      { name: "Microsoft Sabina - Spanish", lang: "es-ES", voiceURI: "sabina" },
      { name: "Microsoft Zira - English", lang: "en-US", voiceURI: "zira" },
    ]);
    expect(pickTutorVoiceForLanguage("es", "auto")?.voiceURI).toBe("sabina");
  });

  it("honors the gender preference within the language pool", async () => {
    const { pickTutorVoiceForLanguage } = await import("../src/lib/lessonLanguage.js");
    stubVoices([
      { name: "Google español", lang: "es-ES", voiceURI: "es-any" },
      { name: "Helena Spanish Female", lang: "es-ES", voiceURI: "helena" },
    ]);
    expect(pickTutorVoiceForLanguage("es", "female")?.voiceURI).toBe("helena");
  });

  it("returns null when the language is missing (never a wrong-language voice)", async () => {
    // User bug: a pinned Japanese lesson was spoken by an English voice —
    // unintelligible. The picker must refuse; the caller then sets the lang
    // tag so the OS resolves/loads a native voice instead.
    const { pickTutorVoiceForLanguage } = await import("../src/lib/lessonLanguage.js");
    stubVoices([{ name: "Some English voice", lang: "en-US", voiceURI: "en1" }]);
    expect(pickTutorVoiceForLanguage("ja", "female")).toBeNull();
  });

  it("matches Hindi voices for a pinned Hindi lesson", async () => {
    const { pickTutorVoiceForLanguage } = await import("../src/lib/lessonLanguage.js");
    stubVoices([
      { name: "Microsoft Kalpana - Hindi", lang: "hi-IN", voiceURI: "kalpana" },
      { name: "Microsoft Zira - English", lang: "en-US", voiceURI: "zira" },
    ]);
    expect(pickTutorVoiceForLanguage("hi", "female")?.voiceURI).toBe("kalpana");
  });

  it("resolveTutorVoice falls back to the English picker for auto lessons", async () => {
    const { resolveTutorVoice } = await import("../src/lib/lessonLanguage.js");
    stubVoices([{ name: "Microsoft Zira - English", lang: "en-US", voiceURI: "zira" }]);
    expect(resolveTutorVoice("auto", "female")?.voiceURI).toBe("zira");
  });

  it("returns null with no voices at all", async () => {
    const { pickTutorVoiceForLanguage } = await import("../src/lib/lessonLanguage.js");
    stubVoices([]);
    expect(pickTutorVoiceForLanguage("fr", "auto")).toBeNull();
  });
});
