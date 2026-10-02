/**
 * PDF lesson export (user spec): the solved lesson as a real PDF with a fixed
 * study format — ① the question/material overview, ② the answers with their
 * verdicts, ③ a step-by-step explanation — followed by the transcript, board
 * log, quiz results, flashcards, and the study journey.
 *
 * pdf-lib is pure JS (no native builds). Only the built-in standard fonts are
 * used, so text is encoded as Latin-1: non-representable characters are
 * sanitized defensively (arrows, math symbols, emoji).
 *
 * Color coding mirrors the chalkboard kinds (user spec): question=blue,
 * fact=white/ink, answer=green, explanation=amber, student=pink, so the PDF
 * reads like the board did.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { LessonExport } from "@local-live-tutor/shared";

const KIND_HEX: Record<string, string> = {
  question: "#7FD1FF",
  fact: "#F4F7F2",
  answer: "#8CE99A",
  explanation: "#FBD870",
};

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const INK = hexToRgb("#2A2A33");
const MUTED = hexToRgb("#6B7280");
const BOARD = hexToRgb("#20362F");
const CHALK_WHITE = hexToRgb("#F4F7F2");

const PAGE_W = 595.28; // A4 @ 72dpi
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Latin-1-safe text for standard fonts (WinAnsi). */
function sanitize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u21D2/g, "=>")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\u2260/g, "!=")
    .replace(/\u00D7/g, "x")
    .replace(/\u00F7/g, "/")
    .replace(/\u2212/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/\u2248/g, "~")
    .replace(/\u221A/g, "sqrt")
    .replace(/\u03C0/g, "pi")
    .replace(/\u03B8/g, "theta")
    .replace(/\u03B1/g, "alpha")
    .replace(/\u03B2/g, "beta")
    .replace(/\u00B0/g, " deg")
    // Everything else non-Latin-1 (emoji, CJK, etc.) out.
    .replace(/[^\u0000-\u00FF]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of sanitize(text).split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        // A single overlong word is hard-split rather than overflowing.
        let chunk = word;
        while (font.widthOfTextAtSize(chunk, size) > maxWidth && chunk.length > 1) {
          let cut = chunk.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxWidth) {
            cut -= 1;
          }
          lines.push(chunk.slice(0, cut));
          chunk = chunk.slice(cut);
        }
        line = chunk;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

type Doc = {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  body: PDFFont;
  bold: PDFFont;
};

function addPage(doc: Doc): void {
  doc.page = doc.pdf.addPage([PAGE_W, PAGE_H]);
  doc.y = PAGE_H - MARGIN;
}

function ensure(doc: Doc, needed: number): void {
  if (doc.y - needed < MARGIN) addPage(doc);
}

/** Section rule + heading in the kind's accent color. */
function sectionHeading(doc: Doc, text: string, hex: string): void {
  ensure(doc, 46);
  doc.y -= 10;
  doc.page.drawLine({
    start: { x: MARGIN, y: doc.y },
    end: { x: PAGE_W - MARGIN, y: doc.y },
    thickness: 1,
    color: hexToRgb(hex),
  });
  doc.y -= 20;
  doc.page.drawText(sanitize(text), {
    x: MARGIN,
    y: doc.y,
    size: 14,
    font: doc.bold,
    color: hexToRgb(hex),
  });
  doc.y -= 22;
}

function paragraph(
  doc: Doc,
  text: string,
  opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number } = {},
): void {
  const size = opts.size ?? 10.5;
  const font = opts.font ?? doc.body;
  const x = MARGIN + (opts.indent ?? 0);
  for (const line of wrap(text, font, size, CONTENT_W - (opts.indent ?? 0))) {
    ensure(doc, size + 6);
    doc.page.drawText(line, { x, y: doc.y, size, font, color: opts.color ?? INK });
    doc.y -= size + 4.5;
  }
}

function bullet(
  doc: Doc,
  text: string,
  hex: string,
  opts: { size?: number; indent?: number; font?: PDFFont } = {},
): void {
  const indent = opts.indent ?? 14;
  ensure(doc, 16);
  doc.page.drawCircle({
    x: MARGIN + indent - 8,
    y: doc.y + 3.5,
    size: 2,
    color: hexToRgb(hex),
  });
  paragraph(doc, text, { color: hexToRgb(hex), indent: indent + 2, ...opts });
}

/** Chalkboard-styled header band with the lesson title. */
function coverBand(doc: Doc, title: string, subtitle: string): void {
  const bandH = 108;
  doc.page.drawRectangle({
    x: 0,
    y: PAGE_H - bandH,
    width: PAGE_W,
    height: bandH,
    color: BOARD,
  });
  doc.page.drawText(sanitize("Local Live Tutor"), {
    x: MARGIN,
    y: PAGE_H - 30,
    size: 9,
    font: doc.body,
    color: hexToRgb("#9FC3B4"),
  });
  const titleLines = wrap(title, doc.bold, 19, CONTENT_W);
  let ty = PAGE_H - 58;
  for (const line of titleLines.slice(0, 2)) {
    doc.page.drawText(line, { x: MARGIN, y: ty, size: 19, font: doc.bold, color: CHALK_WHITE });
    ty -= 24;
  }
  doc.page.drawText(sanitize(subtitle), {
    x: MARGIN,
    y: PAGE_H - bandH + 12,
    size: 9,
    font: doc.body,
    color: hexToRgb("#C9DCD2"),
  });
  doc.y = PAGE_H - bandH - 28;
}

export async function renderLessonPdf(data: LessonExport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const doc: Doc = { pdf, page: pdf.addPage([PAGE_W, PAGE_H]), y: 0, body, bold };

  const subject = String(data.session.subject ?? "other");
  const subtitle = [
    `Subject: ${subject}`,
    data.session.gradeLevel ? `Level: ${data.session.gradeLevel.replace("_", " ")}` : null,
    `XP: ${data.xp}`,
    `Quiz: ${data.quizScore[0]}/${data.quizScore[1]}`,
    `Date: ${data.session.createdAt.slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join("  |  ");
  coverBand(doc, data.title, subtitle);
  doc.y -= 6;

  // ---- 1. The question / study material (user format section 1) ----
  sectionHeading(doc, "1. The question / study material", KIND_HEX.question!);
  if (data.problem) {
    paragraph(doc, data.problem);
  } else {
    paragraph(
      doc,
      "(No separate problem statement — this lesson was an open conversation.)",
      { color: MUTED },
    );
  }

  // ---- 2. Answers (user format section 2) ----
  const verdicts = data.quizResults;
  sectionHeading(doc, "2. Answers", KIND_HEX.answer!);
  const answered = verdicts.filter((q) => q.feedback || q.question);
  if (answered.length === 0) {
    paragraph(doc, "(No graded questions in this lesson.)", { color: MUTED });
  } else {
    for (const q of verdicts) {
      bullet(doc, `Q: ${q.question}`, KIND_HEX.question!, { font: bold, indent: 8 });
      bullet(
        doc,
        `${q.correct ? "Correct" : "Not correct"} - ${q.feedback || "graded by the tutor"}`,
        q.correct ? KIND_HEX.answer! : "#F0938F",
        { indent: 22 },
      );
      doc.y -= 4;
    }
  }

  // ---- 3. Step-by-step explanation (user format section 3) ----
  sectionHeading(doc, "3. Step-by-step explanation", KIND_HEX.explanation!);
  const explanationLines = data.chalkLog.filter(
    (entry) =>
      entry.kind === "explanation" ||
      ((entry.type === "write" || entry.type === "draw_equation") && !entry.kind),
  );
  const factLines = data.chalkLog.filter((entry) => entry.kind === "fact");
  if (explanationLines.length === 0 && factLines.length === 0) {
    // Fall back to the tutor's transcript turns (always present in a real lesson).
    const tutorTurns = data.transcript.filter((t) => t.role === "tutor");
    if (tutorTurns.length === 0) paragraph(doc, "(No explanation recorded.)", { color: MUTED });
    for (const turn of tutorTurns) paragraph(doc, turn.content, { indent: 8 });
  } else {
    if (factLines.length > 0) {
      paragraph(doc, "Key facts and definitions:", { font: bold, indent: 8 });
      for (const entry of factLines) {
        for (const line of entry.text.split("\n")) {
          if (line.trim()) bullet(doc, line.trim(), KIND_HEX.fact!, { indent: 22 });
        }
      }
      doc.y -= 6;
    }
    if (explanationLines.length > 0) {
      paragraph(doc, "How the tutor explained and solved it:", { font: bold, indent: 8 });
      for (const entry of explanationLines) {
        for (const line of entry.text.split("\n")) {
          if (line.trim()) bullet(doc, line.trim(), KIND_HEX.explanation!, { indent: 22 });
        }
      }
    }
  }

  // ---- Board log (color-coded, mirrors the chalk) ----
  if (data.chalkLog.some((e) => e.text)) {
    sectionHeading(doc, "Board log (as it was written)", "#9FC3B4");
    for (const entry of data.chalkLog) {
      if (!entry.text) continue;
      const hex = KIND_HEX[entry.kind ?? ""] ?? (entry.actor === "student" ? "#F9A8C2" : "#D7DEDA");
      const who = entry.actor === "student" ? "You" : "Tutor";
      for (const line of entry.text.split("\n")) {
        if (line.trim()) bullet(doc, `${who}: ${line.trim()}`, hex, { indent: 8 });
      }
    }
  }

  // ---- Conversation ----
  sectionHeading(doc, "Conversation", "#9FC3B4");
  for (const turn of data.transcript) {
    const isTutor = turn.role === "tutor";
    paragraph(doc, turn.content, {
      font: isTutor ? body : bold,
      color: isTutor ? INK : hexToRgb("#8A4B66"),
      indent: isTutor ? 8 : 0,
    });
    doc.y -= 3;
  }

  // ---- Quiz results / flashcards ----
  if (verdicts.length > 0) {
    sectionHeading(doc, "Quiz results", KIND_HEX.answer!);
    for (const q of verdicts) {
      bullet(
        doc,
        `${q.correct ? "[correct]" : "[review]"} ${q.question} - ${q.feedback ?? ""}`,
        q.correct ? KIND_HEX.answer! : "#F0938F",
        { indent: 8 },
      );
    }
  }
  if (data.flashcards.length > 0) {
    sectionHeading(doc, "Flashcards", "#B39DDB");
    for (const card of data.flashcards) {
      bullet(doc, `${card.front} -> ${card.back}`, "#B39DDB", { indent: 8 });
    }
  }

  // ---- Study journey ----
  sectionHeading(doc, "Your study journey", "#FBD870");
  const level = Math.floor(data.stats.totalXp / 50) + 1;
  const journey = [
    `Lesson XP: ${data.xp} | Total XP: ${data.stats.totalXp} (Level ${level})`,
    `Quiz accuracy: ${data.quizScore[0]}/${data.quizScore[1]} this lesson | ${data.stats.totalCorrect} correct all-time`,
    `Streaks: ${data.stats.answerStreak} answers in a row (best ${data.stats.bestAnswerStreak}) | ${data.stats.dailyStreak}-day study streak`,
    `Hints taken this lesson: ${data.hintsTaken}`,
    data.stats.badges.length > 0 ? `Badges: ${data.stats.badges.join(", ")}` : null,
    data.flashcards.some((c) => c.mastered)
      ? `Mastered flashcards: ${data.flashcards.filter((c) => c.mastered).length}/${data.flashcards.length}`
      : null,
  ].filter(Boolean) as string[];
  for (const line of journey) bullet(doc, line, "#FBD870", { indent: 8 });

  const bytes = await pdf.save();
  return bytes;
}
