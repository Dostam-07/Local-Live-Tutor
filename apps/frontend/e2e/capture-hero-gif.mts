/**
 * README hero GIF capture (real app, real model — no mock data).
 *
 * Drives the RUNNING dev servers (frontend 5173, backend 8787 with the live
 * OpenRouter provider), records a short real lesson — the tutor chalks the
 * student's words and its teaching, then poses a quiz — and encodes it into
 * a compact, palette-optimized GIF for the README hero.
 *
 * Requirements: ffmpeg on PATH (palettegen/paletteuse for quality).
 * Run: pnpm --filter @local-live-tutor/frontend hero-gif
 */
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync, rmSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const OUT_DIR = resolve("../../docs/screenshots");
const FRAMES_DIR = resolve("../../.giff-frames");
const GIF_PATH = join(OUT_DIR, "hero.gif");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.SHOT_BASE ?? "http://localhost:5173";
/** Capture area: the chalkboard frame only — tight, readable, small GIF. */
const CLIP = { x: 0, y: 60, width: 1280, height: 560 } as const;
const FPS = 8; // GIF-friendly: low fps, small file, still smooth chalk

function ffmpeg(args: string[]): void {
  // shell:false everywhere — this project path contains spaces
  // ("Local Live Tutor"), which a win32 shell spawn mangles.
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    stdio: "inherit",
    shell: false,
    windowsVerbatimArguments: false,
  });
  if (result.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

function frameDir(): string {
  if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  return FRAMES_DIR;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto(BASE);
await page.waitForTimeout(1500);

// A short, visually rich lesson: the tutor chalks the student's words, then
// its teaching points, then poses a quiz with an interactive card.
const bar = page.getByPlaceholder(/Ask anything/);
await bar.fill("Teach me the water cycle");
await bar.press("Enter");

// Record from BEFORE the reply lands so we capture the chalk writing itself.
// The whole loop is time-boxed per iteration: a hung page or a stalled model
// can never wedge the capture — the previous run blocked indefinitely on a
// screenshot while the tab was mid-repaint.
const frames = frameDir();
let frame = 0;
const started = Date.now();
const MAX_MS = 90_000; // real-model latency varies; cap the recording
let lastBubble = -1;
let stableTurns = 0; // consecutive checks where the bubble stopped growing
while (Date.now() - started < MAX_MS && frame < 90) {
  const t0 = Date.now();
  try {
    await Promise.race([
      page.screenshot({ path: join(frames, `f${String(frame).padStart(5, "0")}.png`), clip: CLIP }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("shot timeout")), 8000)),
    ]);
  } catch {
    break; // give up on this run rather than hanging
  }
  frame += 1;
  const state = await Promise.race([
    page.evaluate(() => ({
      bubble: document.querySelector('[data-testid="speech-bubble"]')?.textContent?.length ?? 0,
      quiz: Boolean(document.querySelector('[data-testid="quiz-card"]')),
    })),
    new Promise<{ bubble: number; quiz: boolean }>((rej) => setTimeout(() => rej(new Error("eval timeout")), 5000)),
  ]).catch(() => null);
  if (!state) break;
  // Stop shortly after the quiz card appears (the payoff moment).
  if (state.quiz) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(frames, `f${String(frame).padStart(5, "0")}.png`), clip: CLIP }).catch(() => undefined);
    frame += 1;
    break;
  }
  // The tutor's message is fully streamed when the bubble text stops growing
  // for a few consecutive checks — the chalk stagger needs ~5s after that.
  stableTurns = state.bubble === lastBubble && state.bubble > 40 ? stableTurns + 1 : 0;
  lastBubble = state.bubble;
  if (stableTurns >= 4) {
    await page.waitForTimeout(5000);
    break;
  }
  const spent = Date.now() - t0;
  await page.waitForTimeout(Math.max(0, 1000 / FPS - spent));
}
await browser.close().catch(() => undefined);
console.log(`captured ${frame} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);
if (frame < 10) {
  throw new Error(`Only ${frame} frames captured — is the app running at ${BASE}?`);
}

// ---------- Encode: palette for quality, trim to the interesting window ----------
// Build the palette from the full clip, then encode at low fps + 256 colors.
// Scale to 960w: README heroes render ~830px wide; 960 keeps text crisp.
ffmpeg([
  "-framerate", String(FPS), "-i", join(frames, "f%05d.png"),
  "-vf", "fps=8,scale=960:-1:flags=lanczos,palettegen=max_colors=128",
  join(frames, "palette.png"),
]);
ffmpeg([
  "-framerate", String(FPS), "-i", join(frames, "f%05d.png"),
  "-i", join(frames, "palette.png"),
  "-lavfi", "fps=8,scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3",
  "-loop", "0",
  GIF_PATH,
]);

const size = statSync(GIF_PATH).size;
console.log(`hero.gif written: ${(size / 1024 / 1024).toFixed(2)} MB`);
if (size > 8 * 1024 * 1024) {
  console.warn("⚠ GIF is large — consider fewer frames or max_colors=64.");
}
rmSync(FRAMES_DIR, { recursive: true, force: true });
console.log("done →", GIF_PATH);
