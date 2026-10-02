# ADR-0001: pnpm monorepo with a shared contracts package

**Status:** Accepted · **Date:** 2026-09-09

## Context

The PRD (§6.1) allows a React+Vite/Fastify split or a Next.js full-stack app. Tutoring
logic, whiteboard operations, and model output schemas must be identical on both sides of
the API; the PRD requires strict shared validation (§9) and forbids trusting model output.

## Decision

pnpm workspaces monorepo: `apps/frontend` (React+Vite), `apps/backend` (Fastify), and
`packages/shared` — the single source of truth for domain types, Zod schemas (including the
`tutorResponseSchema`), and prompt construction.

## Consequences

- Model output and whiteboard ops are validated with the *same* code that compiles the
  frontend types — contract drift is a compile error.
- Provider boundaries stay clean (a PRD priority); SSE streaming remains simple.
- Slightly more build orchestration (`shared` compiles before dependents) — handled by root
  scripts.
- A Next.js consolidation remains possible later since all business logic lives behind the
  backend's service layer, not in route handlers.
