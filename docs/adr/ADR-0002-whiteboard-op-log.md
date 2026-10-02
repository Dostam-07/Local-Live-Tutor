# ADR-0002: Store-owned whiteboard operation log; tldraw as a renderer

**Status:** Accepted · **Date:** 2026-09-09

## Context

PRD §5.4 requires a constrained whiteboard operation vocabulary (9 op types), server-side
schema validation of every op, persistence, and tutor/student ink separation. tldraw's own
document model is rich but not designed as a validation boundary for LLM output.

## Decision

The Zustand `whiteboardStore` owns the **op log** (the domain truth, identical to what the
backend persists). tldraw is a *renderer*: an adapter (`opsBridge.ts`) translates validated
ops into tldraw shapes, and student strokes are captured back into ops for persistence.
Undo/redo operate on the op log, not on tldraw internals.

## Consequences

- Persistence, reload, and undo are deterministic and testable without a canvas.
- Swapping renderers (Excalidraw or a custom SVG board — both user-approved fallbacks) only
  requires rewriting the adapter; the op log, API, and stores are unchanged.
- tldraw-specific niceties (multiplayer, own undo stack) are unused; acceptable for MVP.
- Student freehand ink uses one extra op type (`draw`) that the **model** is never allowed
  to emit — enforced by keeping it out of `tutorResponseSchema` (ADR-0003).
