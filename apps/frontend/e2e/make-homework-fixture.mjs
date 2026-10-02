/**
 * Generates a realistic "photo of homework" fixture (PNG) by rendering a
 * worksheet in headless Chromium and screenshotting it — no native image
 * dependencies required. Used by the photo-of-homework E2E verification.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("apps/frontend/e2e/fixtures/homework-worksheet.png");
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: 850px 1100px; margin: 0; }
  body { margin: 0; width: 850px; height: 1100px; background: #fdfbf4; font-family: Georgia, 'Times New Roman', serif; color: #1a1a2e; }
  .page { padding: 56px 64px; }
  .header { border-bottom: 3px solid #1a1a2e; padding-bottom: 14px; display: flex; justify-content: space-between; align-items: baseline; }
  h1 { font-size: 30px; margin: 0; letter-spacing: 1px; }
  .meta { font-size: 15px; color: #444; }
  .directions { margin-top: 26px; font-size: 17px; font-style: italic; }
  ol { margin-top: 22px; padding-left: 34px; }
  ol li { font-size: 22px; margin-bottom: 46px; }
  .eq { font-family: 'Cambria Math', Georgia, serif; letter-spacing: 1px; }
  .footer { position: absolute; bottom: 40px; left: 64px; right: 64px; display: flex; justify-content: space-between; font-size: 13px; color: #666; border-top: 1px solid #999; padding-top: 10px; }
  .doodle { position: absolute; bottom: 90px; right: 80px; font-size: 15px; color: #555; transform: rotate(-4deg); border: 2px dashed #888; border-radius: 10px; padding: 10px 16px; }
</style></head>
<body>
  <div class="page">
    <div class="header">
      <h1>Algebra Homework — Solving Equations</h1>
      <div class="meta">Worksheet 4.2 &nbsp;·&nbsp; Name: ________</div>
    </div>
    <p class="directions">Solve each equation for x. Show your work step by step.</p>
    <ol>
      <li><span class="eq">3x + 5 = 20</span></li>
      <li><span class="eq">2(x − 4) = 10</span></li>
      <li><span class="eq">x/4 + 3 = 7</span></li>
    </ol>
    <div class="doodle">Bonus: explain the balance rule in your own words ✎</div>
    <div class="footer"><span>Ms. Rivera · Grade 8 Math</span><span>Page 1 of 1</span></div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 850, height: 1100 } });
await page.setContent(html);
await page.screenshot({ path: OUT, fullPage: false });
await browser.close();

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`fixture written: ${OUT} (${kb} KB)`);
