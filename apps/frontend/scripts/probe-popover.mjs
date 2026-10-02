import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173/");
const bar = page.getByPlaceholder(/Ask anything/);
await bar.fill("Teach me the water cycle");
await bar.press("Enter");
await page.waitForURL(/\/sessions\//, { timeout: 30000 });
await page.waitForTimeout(1000);
const btn = page.getByRole("button", { name: /Lesson settings/ });
console.log("btn count:", await btn.count());
// Auto-wait for the first turn to finish (button disabled while thinking).
await btn.waitFor({ state: "visible", timeout: 10000 });
await page.waitForFunction(
  () => !document.querySelector('button[aria-label^="Lesson settings"]')?.disabled,
  undefined, { timeout: 120000 },
);
console.log("button enabled — clicking");
await btn.click();
await page.waitForTimeout(800);
const dialog = page.getByRole("dialog", { name: "Lesson settings" });
console.log("dialog count after click:", await dialog.count());
console.log("aria-expanded:", await btn.getAttribute("aria-expanded"));
await page.screenshot({ path: "popover-probe.png" });
await browser.close();
