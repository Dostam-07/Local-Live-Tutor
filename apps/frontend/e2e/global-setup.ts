import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Deterministic E2E: wipe the mock backend's SQLite database and uploads dir
 * before every run so XP/streak/badge state never leaks between runs — the
 * persisted-KV equivalent of starting each test with a clean classroom.
 * (The real backend's data/ lives elsewhere and is never touched.)
 */
export default function globalSetup() {
  const backendData = fileURLToPath(new URL("../../backend/data/", import.meta.url));
  try {
    for (const entry of readdirSync(backendData)) {
      if (entry.startsWith("tutor-e2e")) {
        rmSync(join(backendData, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // No data dir yet — first run, nothing to clean.
  }
}
