# ADR-0008: Photo-of-homework entry with free vision extraction

Date: 2026-09-10
Status: Accepted (extends the problem-input surface of ADR-0005/0006; the
integrity gate PRD §15 — student confirms extraction before tutoring — is
reaffirmed, not relaxed)

## Context

Homework starts on paper. The existing paths (typed text, voice, paste,
drag-drop *inside* the session) all require the student to begin a session
first. The user asked for photo-of-homework entry **at lesson start**, with
the tutor reading the page using a **free OpenRouter vision model**, and
the student **confirming the extraction before the lesson starts**.

## Decision

### 1. Photo attach on the home page

`NewSessionPage` gains an "Attach a photo of your homework" drop-zone
(PNG/JPEG/WebP). The photo is read as a data URL client-side and shown as
a preview with a Remove action. It is optional; typed topics and the
greeting-first flow are unchanged.

On **Start session**, the client: (1) creates the session, (2) uploads the
photo via `POST /api/sessions/:id/document` (the existing ADR-0006
document pipeline), (3) only then navigates to the workspace. The button
label reflects the phases ("Reading your photo…").

### 2. Extraction by the free vision pool

The backend document pipeline extracts the page with
`provider.vision()`, which rotates the **dedicated free vision pool**
(ADR-0006 §2: catalog-filtered on `input_modalities ∋ "image"`, zero
pricing, non-chat models excluded). The extraction prompt is
subject-agnostic (math, science, English, history…) and strictly
transcription: it may describe diagrams in words but never solve anything.

- Images go straight to vision. Text PDFs use the dependency-free PDF text
  extractor. Scanned/image-only PDFs cannot be rendered to images without
  native dependencies, so they return a typed `ocr_unclear` error with a
  clear "upload a screenshot instead" recovery path.
- Extracted text is stored on the session (`extractedProblem`) along with
  the original file for reference.

### 3. Confirmation is the gate to the lesson

The workspace load effect distinguishes three states:

| Material | Tutor turn yet | State |
|---|---|---|
| none | none | Fresh → greeting-first, no overlay |
| present | none | **Unconfirmed → confirmation overlay stays up** |
| present | present | Confirmed → normal conversational workspace |

The overlay (ADR-0005's `ProblemSetupOverlay`) prefills its textarea with
the vision-extracted text for the student to verify/edit, shows the
attached image, and only **Start the lesson** (which confirms the text)
dismisses it and triggers the opener. The greeting is suppressed for
unconfirmed-photo sessions so the overlay is never fighting the mic. The
answer bar stays hidden until confirmation — nothing can start the lesson
before a human has read what the model read.

### 4. Mid-session uploads unchanged

The Upload orb keeps its existing behavior (material added mid-conversation,
tutor acknowledges conversationally) — the new gate applies only to the
pre-session entry path where nothing has been confirmed yet.

## Consequences

- Extraction happens synchronously in "Start session", so a slow free
  vision model delays navigation by a few seconds; the button state covers
  this. A background extraction with a pending-state workspace would be
  the next iteration if this proves annoying.
- The confirmation overlay is the single source of "lesson not started",
  so `started` is no longer derivable from material alone — it is
  `material && hasConversation` on load.
- Vision quality is bounded by the current free multimodal catalog; the
  typed `ocr_unclear` failure and the editable confirmation text keep the
  failure mode recoverable (PRD §14).
