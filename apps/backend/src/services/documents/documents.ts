/**
 * Document study (ADR-0006): the student uploads a photo or PDF of anything
 * study-related — a worksheet, textbook page, notes, an essay prompt — and it
 * becomes the session's study material.
 *
 * - Images → vision extraction (free vision models on OpenRouter; mock in
 *   tests).
 * - PDFs → dependency-free text extraction. Scanned/image-only PDFs (little
 *   or no extractable text) return a clear "upload a screenshot instead"
 *   error — vision models do not accept PDF bytes, and rendering pages to
 *   images would need native dependencies.
 */
import fs from "node:fs";
import path from "node:path";

import type { Session } from "@local-live-tutor/shared";

import { loadEnv } from "../../config/env.js";
import { Errors } from "../../errors.js";
import type { AppDeps } from "../../routes/index.js";
import { extractPdfText } from "./pdfText.js";

const MAX_DOC_BYTES = 15 * 1024 * 1024;
/** Below this many extracted chars, a PDF is treated as scanned/image-only. */
const MIN_PDF_TEXT_CHARS = 80;

export type DocumentExtractResult = {
  text: string;
  kind: "image" | "pdf";
  storagePath: string;
};

const VISION_MATERIAL_PROMPT =
  "You extract study material from images for an AI tutor. This may be math, science, English, history, geography, or any other subject — a worksheet, textbook page, notes, or an essay prompt. NEVER solve or answer the material. Transcribe everything relevant verbatim (questions, text, diagrams described in words). Return ONLY JSON: {\"text\": string, \"unclear\": boolean, \"unclearNote\": string?}.";

export async function extractDocument(
  deps: AppDeps,
  sessionId: string,
  doc: { base64: string; mime: string; ext: string },
): Promise<DocumentExtractResult> {
  const session = deps.sessions.getById(sessionId);
  if (!session) throw Errors.notFound("Session");

  const env = loadEnv();
  fs.mkdirSync(env.uploadDir, { recursive: true });
  const storagePath = path.join(env.uploadDir, `${sessionId}-doc.${doc.ext}`);

  let text = "";
  if (doc.mime === "application/pdf") {
    const buf = Buffer.from(doc.base64, "base64");
    if (buf.byteLength > MAX_DOC_BYTES) {
      throw Errors.validation("Document exceeds the 15 MB limit.");
    }
    fs.writeFileSync(storagePath, buf);
    const pdf = extractPdfText(buf);
    if (pdf.text.length >= MIN_PDF_TEXT_CHARS) {
      text = pdf.text;
    } else {
      // Scanned (image-only) PDF: we cannot render pages without native
      // dependencies, and vision models do not accept PDF bytes. Ask the
      // student for a screenshot or the typed topic instead (PRD §14 states).
      throw Errors.ocrUnclear(
        "This looks like a scanned PDF (no selectable text). Upload a screenshot of the page instead, or type the topic and we'll start from there.",
      );
    }
  } else {
    const buf = Buffer.from(doc.base64, "base64");
    if (buf.byteLength > MAX_DOC_BYTES) {
      throw Errors.validation("Image exceeds the 15 MB limit.");
    }
    fs.writeFileSync(storagePath, buf);
    text = await visionExtract(deps, session, doc.base64, doc.mime);
  }

  if (!text.trim()) {
    throw Errors.ocrUnclear(
      "I could not read the document. Try a clearer photo, or type the topic instead.",
    );
  }
  return { text, kind: doc.mime === "application/pdf" ? "pdf" : "image", storagePath };
}

async function visionExtract(
  deps: AppDeps,
  session: Session,
  base64: string,
  mime: string,
): Promise<string> {
  const { provider } = await deps.registry.resolve();
  if (typeof provider.vision !== "function") {
    throw Errors.visionUnsupported();
  }
  const response = await provider.vision({
    imageBase64: base64,
    imageMime: mime,
    forceJson: true,
    messages: [
      { role: "system", content: VISION_MATERIAL_PROMPT },
      { role: "user", content: "Extract the study material from this document." },
    ],
  });
  const parsed = JSON.parse(response.text) as {
    text?: string;
    unclear?: boolean;
    unclearNote?: string;
  };
  if (parsed.unclear || !parsed.text?.trim()) {
    throw Errors.ocrUnclear(parsed.unclearNote);
  }
  return parsed.text;
}
