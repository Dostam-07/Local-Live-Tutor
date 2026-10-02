# ADR-0003: Structured-output pipeline and the model op vocabulary

**Status:** Accepted · **Date:** 2026-09-09

## Context

PRD §9 mandates strict JSON validation with a defined failure ladder (one structured repair
→ text-only fallback → local log → never crash). §5.4 forbids the model from generating
code or DOM. Local models frequently produce malformed JSON, so the pipeline must assume
failure as the common case, not the exception.

## Decision

1. Every tutor response passes the strict `tutorResponseSchema`; a lenient variant fills
   missing optional fields before a repair attempt is spent.
2. Raw model text is streamed to the UI as it arrives; *only validated* structured data
   commits (message persistence, whiteboard ops, objective updates).
3. Whiteboard ops are re-validated individually (`whiteboardOpSchema`); invalid ops are
   dropped, never crash the session.
4. The model-facing vocabulary is exactly the nine PRD §5.4 types. A tenth type (`draw`)
   exists for student freehand ink persistence and is accepted only from the student path
   (`studentOpSchema`), enforced by separate schemas.
5. Mock provider deterministically reproduces: valid structured turns, escalation, the
   answer-request integrity path, and invalid-JSON output (`INVALID_JSON_TEST` marker) so
   the full ladder is testable offline (PRD §16: tests never depend on a live model).

## Consequences

- The PRD §20 reliability metric (≥90% recovery without crashing) is structural, not
  aspirational.
- A streamed-but-invalid response shows as streaming text briefly before the fallback
  message commits; acceptable trade-off for perceived latency (§20: first token <10s).
