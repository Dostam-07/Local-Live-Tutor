/**
 * README screenshot capture (real app, real model — no mock data).
 * Drives the RUNNING dev servers (frontend 5173, backend 8787 with the live
 * OpenRouter provider) and saves PNGs to docs/screenshots/ for the README.
 *
 * Run: pnpm --filter @local-live-tutor/frontend exec playwright test --config=playwright.capture.config.ts
 * (or: node --import tsx this-file) — kept as a standalone script, not a test.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("../../docs/screenshots");
mkdirSync(OUT, { recursive: true });

const BASE = "http://localhost:5173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// ---------- 1. Welcome board ----------
await page.goto(BASE);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-welcome.png` });
console.log("shot: 01-welcome");

// ---------- 2. Live lesson: teach → chalk → quiz card ----------
await page.getByPlaceholder(/Ask anything/).fill("I want to learn about photosynthesis");
await page.getByPlaceholder(/Ask anything/).press("Enter");
// Wait until the tutor's reply lands in the speech bubble (real model latency).
await page.waitForFunction(
  () => {
    const bubble = document.querySelector('[data-testid="speech-bubble"]');
    return bubble && bubble.textContent && bubble.textContent.length > 80;
  },
  { timeout: 90_000 },
);
// Give the staggered chalk a beat to finish writing.
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/02-lesson.png` });
console.log("shot: 02-lesson");

// ---------- 3. Quiz card with choice buttons ----------
const quizOrb = page.getByRole("button", { name: "Quiz", exact: true });
await quizOrb.click();
await page.waitForFunction(
  () => Boolean(document.querySelector('[data-testid="quiz-card"]')),
  { timeout: 90_000 },
);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/03-quiz.png` });
console.log("shot: 03-quiz");

// ---------- 4. Settings: persona + voice ----------
await page.goto(`${BASE}/settings`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/04-settings.png` });
console.log("shot: 04-settings");

// ---------- 5. My learning ----------
await page.goto(`${BASE}/history`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/05-history.png` });
console.log("shot: 05-history");

await browser.close();
console.log("done →", OUT);
