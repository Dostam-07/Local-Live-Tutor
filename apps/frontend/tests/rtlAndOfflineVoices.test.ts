/**
 * RTL board layout + offline voices (roadmap) — the shared RTL classifier,
 * Hebrew/Arabic natural-speech math words, and the Piper availability cache.
 * Offline and deterministic; no network in unit tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRtlLanguage, RTL_LANGUAGES } from "@local-live-tutor/shared";
import { toSpeechText } from "../src/lib/speechText";
import {
  piperAvailability,
  piperHasLanguage,
  resetPiperCache,
} from "../src/lib/offlineVoice";

describe("isRtlLanguage (shared)", () => {
  it("flags Arabic and Hebrew only", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("he")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("hi")).toBe(false);
    expect(isRtlLanguage("auto")).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });

  it("ships a non-empty RTL set that matches the classifier", () => {
    expect(RTL_LANGUAGES.size).toBeGreaterThanOrEqual(2);
    for (const lang of RTL_LANGUAGES) expect(isRtlLanguage(lang as never)).toBe(true);
  });
});

describe("speech layer in RTL languages", () => {
  it("Arabic math speaks Arabic connector words", () => {
    const spoken = toSpeechText("2x + 4 = 10", "ar");
    expect(spoken).toMatch(/زائد/);
    expect(spoken).toMatch(/يساوي/);
    expect(spoken).not.toMatch(/plus|equals/);
  });

  it("Hebrew math speaks Hebrew connector words", () => {
    const spoken = toSpeechText("2x + 4 = 10", "he");
    expect(spoken).toMatch(/ועוד/);
    expect(spoken).toMatch(/שווה ל/);
    expect(spoken).not.toMatch(/plus|equals/);
  });

  it("verdicts speak naturally in Hebrew, not as glyphs", () => {
    const spoken = toSpeechText("✓ Correct", "he");
    expect(spoken).toMatch(/correct/i);
    expect(spoken).not.toMatch("✓");
  });
});

describe("piperAvailability (offline voices)", () => {
  afterEach(() => {
    resetPiperCache();
    vi.restoreAllMocks();
  });

  it("reports unconfigured honestly when the backend has no Piper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ configured: false, serverUp: false, languages: [] }), { status: 200 })),
    );
    const status = await piperAvailability(true);
    expect(status.configured).toBe(false);
    expect(piperHasLanguage(status, "ar")).toBe(false);
  });

  it("sees installed languages and caches the probe", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ configured: true, serverUp: true, languages: ["ar", "he"] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await piperAvailability(true);
    expect(piperHasLanguage(first, "ar")).toBe(true);
    expect(piperHasLanguage(first, "he")).toBe(true);
    expect(piperHasLanguage(first, "de")).toBe(false);
    await piperAvailability(); // within cache window → no second network call
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failed probe reads as 'no offline voices', never a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const status = await piperAvailability(true);
    expect(status.configured).toBe(false);
    expect(status.languages).toEqual([]);
  });
});
