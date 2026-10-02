/**
 * Piper local TTS (roadmap: language-accurate offline voices). Speaks to a
 * running Piper HTTP server (rhasspy Piper, `python -m piper.http_server`),
 * which serves WAV audio from the voice models on disk. NO mock data: when
 * no server is reachable or no model matches the lesson language, callers
 * get `available: false` with a real reason and the app falls back to the
 * browser's voices — never a fake audio stream.
 *
 * Voice discovery reads the Piper voice directory directly: model files are
 * named `<lang>_<region>-<name>.onnx` (e.g. `ar_JO-kareem.onnx`,
 * `he_IL-...`, `hi_IN-...`), each with a `.json` config beside it.
 */
import fs from "node:fs";
import path from "node:path";

import type { Env } from "../../config/env.js";

/** A Piper voice model found on disk. */
export type PiperVoice = {
  /** BCP-47-ish tag parsed from the filename, e.g. "ar_JO". */
  tag: string;
  /** Primary subtag, e.g. "ar". */
  language: string;
  /** Voice name, e.g. "kareem". */
  name: string;
  /** Absolute path of the .onnx model. */
  modelPath: string;
  /** Absolute path of the .json config (present for healthy installs). */
  configPath: string | null;
};

const VOICE_RE = /^([a-z]{2,3})[_-]([A-Za-z]{2,4})[-_](.+)\.onnx$/i;

/** Scans the Piper voice directory for usable models. */
export function scanPiperVoices(voicesDir: string): PiperVoice[] {
  if (!voicesDir) return [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(voicesDir);
  } catch {
    return [];
  }
  const voices: PiperVoice[] = [];
  for (const file of entries) {
    const match = VOICE_RE.exec(file);
    if (!match) continue;
    const language = match[1] ?? "";
    const region = match[2] ?? "";
    const name = match[3] ?? file;
    if (!language || !region) continue;
    const modelPath = path.join(voicesDir, file);
    const configPath = modelPath.replace(/\.onnx$/i, ".onnx.json");
    voices.push({
      tag: `${language.toLowerCase()}_${region.toUpperCase()}`,
      language: language.toLowerCase(),
      name: name ?? file,
      modelPath,
      configPath: fs.existsSync(configPath) ? configPath : null,
    });
  }
  voices.sort((a, b) => a.tag.localeCompare(b.tag) || a.name.localeCompare(b.name));
  return voices;
}

/** Picks the best installed voice for an ISO language code ("ar", "hi", …). */
export function pickPiperVoice(voices: PiperVoice[], language: string): PiperVoice | null {
  const primary = language.split("-")[0]?.toLowerCase() ?? language.toLowerCase();
  return voices.find((v) => v.language === primary) ?? null;
}

/** Piper HTTP server health. */
export async function piperHealth(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(baseUrl.replace(/\/$/, "") + "/", { signal: controller.signal });
    clearTimeout(timer);
    // Any HTTP answer means a server is listening (Piper serves a tiny UI).
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Synthesizes speech: POSTs text to the Piper HTTP server and returns WAV
 * bytes. The server must run with `--model <default>`; per-request voice
 * selection depends on the server build, so callers should pass a voice the
 * server was started with (or accept its default) — the route reports which
 * language the served model speaks via /api/tts/voices.
 */
export async function synthesizePiper(
  baseUrl: string,
  text: string,
  timeoutMs = 20_000,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl.replace(/\/$/, "") + "/api/tts", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: text.slice(0, 4000),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`piper_http_${res.status}`);
    }
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

/** Resolved Piper runtime state for the settings UI. */
export type PiperStatus = {
  configured: boolean;
  serverUp: boolean;
  voicesDir: string;
  voices: Array<{ tag: string; language: string; name: string }>;
  detail: string;
};

export function piperStatus(env: Env): PiperStatus {
  const baseUrl = env.PIPER_TTS_URL;
  const voices = baseUrl ? scanPiperVoices(env.PIPER_VOICES_DIR) : [];
  return {
    configured: Boolean(baseUrl),
    serverUp: false, // filled by the async route (health probe)
    voicesDir: env.PIPER_VOICES_DIR,
    voices: voices.map((v) => ({ tag: v.tag, language: v.language, name: v.name })),
    detail: baseUrl
      ? `Piper server expected at ${baseUrl}`
      : "Set PIPER_TTS_URL (and PIPER_VOICES_DIR) to enable offline voices.",
  };
}
