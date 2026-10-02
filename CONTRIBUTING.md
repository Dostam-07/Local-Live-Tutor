# Contributing to AI Teacher 🧑‍🏫

Thanks for wanting to make the chalkboard tutor better! This guide gets you from clone to merged PR.

## Project in one paragraph

A local-first, voice-driven tutor that teaches on a simulated chalkboard: it speaks every point while writing it in color-coded chalk, quizzes you, gamifies progress (XP, streaks, flashcards), and exports the lesson as a PDF. Strict TypeScript pnpm monorepo: `packages/shared` (Zod schemas + contracts), `apps/backend` (Fastify + SQLite via Drizzle), `apps/frontend` (React + tldraw chalkboard).

## Ground rules (non-negotiable)

These are product principles enforced in code and tests — PRs that violate them will be asked to change:

1. **No mock data at runtime.** Lessons, grades, and stats come from the live model and the real database. The only mock is the `LLMProvider` test double behind the provider seam, used **exclusively** by the automated suites.
2. **Free models only.** The OpenRouter integration uses the auto-resolved free-model pool. Don't introduce paid-model calls or hardcode a model name that could break the pool.
3. **The model can only chalk.** Every model reply must flow through the schema-validate → repair → typed-whiteboard-op pipeline (ADR-0003). Never eval, inject, or trust raw model output in the DOM.
4. **The API key stays server-side.** Nothing about the key (beyond a configured boolean) may reach the browser.
5. **Teach real facts.** Tutor copy must preserve the factual-accuracy and safety rules in `packages/shared/src/prompts.ts` — including for new personas.

## Getting set up

Requirements: **Node ≥ 20**, **pnpm** (`corepack enable` handles it), and **ffmpeg on PATH** only if you want to regenerate README imagery.

```bash
git clone <your-fork-url>
cd local-live-tutor
pnpm install
cp apps/backend/.env.example apps/backend/.env   # if present; otherwise create it
# then edit apps/backend/.env:
#   LLM_PROVIDER=openrouter
#   OPENROUTER_API_KEY=sk-or-v1-...   (get a free key at openrouter.ai)
pnpm dev          # shared build + backend :8787 + frontend :5173
```

No key? The dev servers still boot; you just can't run live lessons. Unit/integration tests run fully offline against the mock provider.

## The gates your PR must pass

Run these from the repo root — all must be green before review:

```bash
pnpm typecheck    # strict TS across the monorepo
pnpm test         # shared build + all unit/integration tests
pnpm e2e          # Playwright E2E (boots its own isolated servers)
pnpm build        # every package builds
```

CI runs the same list on every push, so failing locally means failing in CI.

### If you touched the UI or the tutoring flow

Add or update tests in the same PR:
- New Zod schema fields → extend `packages/shared/tests/`
- New API behavior → `apps/backend/tests/integration/api.test.ts`
- New board/op behavior → `apps/frontend/tests/` (deterministic, no editor needed)
- New user-visible flow → `apps/frontend/e2e/tutor-loop.spec.ts`

### If you changed anything visual

Regenerate the README imagery so the docs never drift from the app (with dev servers running):

```bash
pnpm --filter @local-live-tutor/frontend shots      # five screenshots
pnpm --filter @local-live-tutor/frontend hero-gif   # animated hero (needs ffmpeg)
```

Commit the refreshed files under `docs/screenshots/` with your change.

## Architecture decisions

Bigger changes need an ADR first — a short doc in `docs/adr/` (next free number, Context / Decision / Consequences) so the reasoning survives in the repo. Read the existing ones before proposing changes to the op log, provider seam, or prompting contract; they explain *why* the seams look the way they do.

## Commit & PR style

- **Commits:** short imperative subject focused on the *why* ("Fix quiz grader dropping partial credit", not "update file").
- **PRs:** one coherent change per PR. Describe what a reviewer should test manually (e.g. "start a lesson, answer wrong, expect a hint not the answer").
- **Screenshots/GIFs** in the PR description for anything visual.
- Keep the chalkboard aesthetic: dark board, WCAG AA contrast, no heavy dependencies for small problems.

## Reporting bugs

Open an issue with: what you asked the tutor, what it did, what you expected, backend console output, and your OS/browser. **Never paste your OpenRouter key** — it lives in `apps/backend/.env`, which is gitignored; keep it that way.

## Licensing

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE) that covers the project.
