# ADR-0004: Provider seam, explicit-consent fallback, and key secrecy

**Status:** Accepted · **Date:** 2026-09-09

## Context

PRD §5.7: multiple model backends without changing tutoring logic; Ollama default; no
silent cross-provider data flow; explicit consent for fallback. §13/§15: API keys never in
the browser; remote processing must be obvious.

## Decision

- One `LLMProvider` interface (`chat`, `streamChat`, optional `vision`, `healthCheck`,
  `listModels`); a registry resolves the configured provider and, **only when** the user has
  consented via `ALLOW_PROVIDER_FALLBACK`, walks the PRD priority order (ollama →
  openrouter → mock). Without consent, an unavailable Ollama raises the typed
  `ollama_unreachable` §14 state.
- Keys live in server-side environment configuration only. `GET /api/settings` returns
  `openRouterApiKeyConfigured: boolean` derived server-side; `PATCH /api/settings` ignores
  any client-sent key fields.
- Every turn records the provider and model that processed it; the settings screen shows a
  remote-processing warning whenever OpenRouter is selected.

## Consequences

- A student can never unknowingly send data to a remote provider (PRD §5.7).
- Adding future providers (an OpenAI-compatible local server, etc.) is one class plus one
  registry case; tutoring code is untouched.
