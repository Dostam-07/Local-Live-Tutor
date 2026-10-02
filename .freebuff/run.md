# Run — Local Live Tutor (preview)

Two dev processes: Fastify backend (API + SSE) on **8787**, Vite frontend on **5173** (proxies `/api` → 8787).

## 1. Reproduce uncommitted artifacts (fresh checkout)

- **Copy `apps/backend/.env`** from the main checkout (never commit it). It holds `OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODELS` fallback IDs, `LLM_PROVIDER=openrouter`, `UPLOAD_DIR`. Values are secret — copy the file, not the contents into docs.
- **Install dependencies**: `pnpm install` (workspace root; pnpm ≥ 11, Node ≥ 20).
- **Build the shared package** (backend + frontend import its output): `pnpm --filter @local-live-tutor/shared build`.
- DB is SQLite at the path from `DATABASE_PATH` (default `data/app.db`); migrations are applied automatically on boot. Uploaded photos/PDFs land in `UPLOAD_DIR` (default `data/uploads`).

## 2. Run the servers (detached)

Backend (from `apps/backend`):

```powershell
(Start-Process -FilePath 'node.exe' -ArgumentList '--import','tsx','src/server.ts' -WorkingDirectory '<repo>\apps\backend' -RedirectStandardOutput '<repo>\.freebuff\preview-be.log' -RedirectStandardError '<repo>\.freebuff\preview-be.log.err' -WindowStyle Hidden -PassThru).Id
```

Frontend (from `apps/frontend`):

```powershell
(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory '<repo>\apps\frontend' -RedirectStandardOutput '<repo>\.freebuff\preview-fe.log' -RedirectStandardError '<repo>\.freebuff\preview-fe.log.err' -WindowStyle Hidden -PassThru).Id
```

Readiness: `GET http://localhost:8787/api/health` → `{"ok":true}`, and `http://localhost:5173/` returns the app HTML.

## Notes

- E2E (Playwright) runs fully isolated on its own ports (vite **5174** → mock backend **8790**), so it never touches the live dev servers or the real LLM provider.
- Smoke scripts hit the LIVE backend: `node scripts/smoke-conversational.mjs`, `node scripts/smoke-opener.mjs`, `node scripts/smoke.mjs` (they create + delete their own sessions).
- The OpenRouter provider resolves its model pool live from OpenRouter's catalog (zero-cost chat models only) and rotates per request; `.env` model IDs are only a fallback.
