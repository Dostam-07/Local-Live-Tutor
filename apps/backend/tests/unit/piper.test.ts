/**
 * Piper offline-voice unit tests (roadmap: language-accurate offline voices)
 * — filename parsing, per-language pick, and graceful behavior on a missing
 * directory. No network, no mocks of the app itself.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pickPiperVoice, scanPiperVoices } from "../../src/services/tts/piper.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "piper-voices-"));
  // Real Piper filename convention: <lang>_<REGION>-<name>.onnx
  writeFileSync(join(dir, "ar_JO-kareem.onnx"), "model");
  writeFileSync(join(dir, "ar_JO-kareem.onnx.json"), "config");
  writeFileSync(join(dir, "he_IL-ossi.onnx"), "model");
  writeFileSync(join(dir, "he_IL-ossi.onnx.json"), "config");
  writeFileSync(join(dir, "hi_IN-pratham.onnx"), "model");
  writeFileSync(join(dir, "en_US-amy-medium.onnx"), "model");
  writeFileSync(join(dir, "en_US-amy-medium.onnx.json"), "config");
  // A non-voice file must be ignored.
  writeFileSync(join(dir, "readme.txt"), "not a model");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("scanPiperVoices", () => {
  it("parses real Piper voice filenames into language tags", () => {
    const voices = scanPiperVoices(dir);
    const tags = voices.map((v) => v.tag);
    expect(tags).toContain("ar_JO");
    expect(tags).toContain("he_IL");
    expect(tags).toContain("hi_IN");
    expect(tags).toContain("en_US");
    expect(voices.every((v) => !v.name.includes("readme"))).toBe(true);
  });

  it("marks voices without a config as unhealthy but still lists them", () => {
    const voices = scanPiperVoices(dir);
    const hi = voices.find((v) => v.language === "hi");
    expect(hi).toBeTruthy();
    expect(hi?.configPath).toBeNull(); // hi_IN-pratham has no .onnx.json here
    const en = voices.find((v) => v.language === "en");
    expect(en?.configPath).not.toBeNull();
  });

  it("returns an empty list for a missing directory", () => {
    expect(scanPiperVoices(join(dir, "does-not-exist"))).toEqual([]);
  });
});

describe("pickPiperVoice", () => {
  it("matches by primary language subtag", () => {
    const voices = scanPiperVoices(dir);
    expect(pickPiperVoice(voices, "ar")?.tag).toBe("ar_JO");
    expect(pickPiperVoice(voices, "he")?.tag).toBe("he_IL");
    expect(pickPiperVoice(voices, "ar-SA")?.tag).toBe("ar_JO"); // BCP-47 input
    expect(pickPiperVoice(voices, "de")).toBeNull(); // not installed
  });
});
