import { defineConfig } from "@playwright/test";

// Unique DB per run: gamification stats (XP/streaks/badges) live in SQLite KV,
// so a fresh file per run keeps every run deterministic — no dependence on
// deleting a file that a crashed previous run may still hold open (Windows).
const e2eDatabasePath = `./data/tutor-e2e-${Date.now()}.sqlite`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @local-live-tutor/backend exec node --import tsx src/server.ts",
      port: 8790,
      reuseExistingServer: false,
      timeout: 30_000,
      // Deterministic E2E: mock provider, isolated DB, .env never loaded
      // (NODE_ENV=test), so a developer's OpenRouter key can never leak in.
      env: {
        NODE_ENV: "test",
        LLM_PROVIDER: "mock",
        PORT: "8790",
        DATABASE_URL: e2eDatabasePath,
        UPLOAD_DIR: "./data/uploads-e2e",
      },
    },
    {
      command: "pnpm --filter @local-live-tutor/frontend exec vite --port 5174 --strictPort",
      env: { VITE_API_PROXY: "http://127.0.0.1:8790" },
      port: 5174,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
