/**
 * Study routes (ADR-0006): document upload (photo / PDF of any study
 * material) and the downloadable lesson report.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  engagementEventSchema,
  handwritingGradeSchema,
  importLinkSchema,
  srsGradeSchema,
} from "@local-live-tutor/shared";

import { Errors } from "../errors.js";
import { extractDocument } from "../services/documents/documents.js";
import { buildLessonExport } from "../services/documents/export.js";
import { renderLessonPdf } from "../services/documents/pdf.js";
import { fetchStudyMaterial } from "../services/documents/linkImport.js";
import { gradeHandwriting } from "../services/tutoring/handwriting.js";
import type { AppDeps } from "./index.js";

const IMAGE_MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

const documentSchema = z.object({
  /** Raw document as a data URL: image/* or application/pdf. */
  dataUrl: z.string().min(1),
});

const masteredSchema = z.object({
  fronts: z.array(z.string().min(1)).max(200),
});

function parseDataUrl(dataUrl: string): { base64: string; mime: string; ext: string } {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw Errors.validation("Expected a base64 data URL.");
  const mime = match[1];
  const base64 = match[2];
  const ext = mime === "application/pdf" ? "pdf" : (mime.split("/")[1] || "bin");
  if (!IMAGE_MIMES[ext]) {
    throw Errors.validation("Only PNG, JPEG, WebP images and PDF documents are supported.");
  }
  return { base64, mime, ext };
}

export async function registerStudyRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  /**
   * POST /document — upload a photo or PDF of study material. Extracts the
   * content (vision for images/scans, text for PDFs) and stores it as the
   * session's study material. The student still confirms before the lesson.
   */
  app.post("/api/sessions/:id/document", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const parsed = documentSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());

    const doc = parseDataUrl(parsed.data.dataUrl);
    const result = await extractDocument(deps, id, doc);
    const session = deps.sessions.update(id, {
      extractedProblem: result.text,
      originalImagePath: result.storagePath,
    });
    return { session, text: result.text, kind: result.kind };
  });

  /**
   * GET /export — the complete solved lesson as structured JSON (used for the
   * markdown and printable downloads on the frontend).
   */
  app.get("/api/sessions/:id/export", async (request) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    return buildLessonExport(deps, id);
  });

  /** GET /api/stats — cumulative study stats (streaks, badges, mastery). */
  app.get("/api/stats", async () => deps.studyStats.get());

  // ---------- Spaced repetition (roadmap) ----------

  /** GET /api/srs/due — the active profile's flashcards due for review. */
  app.get("/api/srs/due", async () => {
    const profileId = deps.profiles.getCurrent() ?? undefined;
    return { due: deps.srs.due(profileId), count: deps.srs.dueCount(profileId) };
  });

  /**
   * POST /api/srs/grade — record a flashcard review outcome from the modal
   * (0 forgot · 1 hard · 2 good · 3 easy) and move the schedule.
   */
  app.post("/api/srs/grade", async (request) => {
    const parsed = srsGradeSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const profileId = deps.profiles.getCurrent() ?? undefined;
    const card = deps.srs.grade(profileId, parsed.data.front, parsed.data.grade);
    if (!card) throw Errors.notFound("Flashcard");
    return { card, stats: deps.studyStats.get() };
  });

  /**
   * POST /api/stats/mastered — mark flashcards mastered (by front text).
   * Body: { fronts: string[] }. Idempotent; returns updated stats + badges.
   */
  app.post("/api/stats/mastered", async (request) => {
    const parsed = masteredSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    return deps.studyStats.markMastered(parsed.data.fronts);
  });

  /** GET /export.md — the same report rendered as a downloadable markdown file. */
  app.get("/api/sessions/:id/export.md", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const exportData = await buildLessonExport(deps, id);
    const md = renderMarkdown(exportData);
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    reply.header(
      "Content-Disposition",
      `attachment; filename="lesson-${id.slice(0, 8)}.md"`,
    );
    return md;
  });

  /**
   * GET /export.pdf — the solved lesson as a real PDF in the study format:
   * ① question overview ② answers with verdicts ③ step-by-step explanation,
   * then board log / conversation / quiz / flashcards / journey. (User spec:
   * downloads are PDF, not markdown.)
   */
  app.get("/api/sessions/:id/export.pdf", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deps.sessions.getById(id)) throw Errors.notFound("Session");
    const exportData = await buildLessonExport(deps, id);
    const bytes = await renderLessonPdf(exportData);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename="lesson-${id.slice(0, 8)}.pdf"`,
    );
    return reply.send(Buffer.from(bytes));
  });

  // ---------- Handwriting practice (roadmap: student chalks, tutor grades) ----------

  /**
   * POST /api/sessions/:id/handwriting — grade the student's board writing.
   * The frontend captures the board image (plus optional typed transcription
   * and ink text) and the tutor grades content + legibility. Vision-capable
   * providers read the image; text-only providers grade the transcription.
   */
  app.post("/api/sessions/:id/handwriting", async (request) => {
    const { id } = request.params as { id: string };
    const session = deps.sessions.getById(id);
    if (!session) throw Errors.notFound("Session");
    const parsed = handwritingGradeSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const result = await gradeHandwriting(deps, session, parsed.data);
    return { feedback: result };
  });

  // ---------- Study link import (roadmap: Classroom / Moodle / any URL) ----------

  /**
   * POST /api/import/link — fetch a study page (Google Classroom assignment,
   * Moodle course page, wiki, worksheet URL…) and extract the material for
   * the confirm gate. SSRF-guarded: only public http(s) hosts, size/time
   * capped, HTML reduced to readable text.
   */
  app.post("/api/import/link", async (request) => {
    const parsed = importLinkSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const material = await fetchStudyMaterial(parsed.data.url, deps.registry);
    return material;
  });

  // ---------- Engagement events (parent view: quiet/resume patterns) ----------

  /**
   * POST /api/engagement — the frontend records one nudge cycle: the tutor
   * fired a check-in (with quiet seconds + escalation rung) or the student
   * resumed (with how they came back). Local-only, family-owned data.
   */
  app.post("/api/engagement", async (request, reply) => {
    const parsed = engagementEventSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());
    const session = deps.sessions.getById(parsed.data.sessionId);
    if (!session) throw Errors.notFound("Session");
    const event = deps.engagement.record({
      ...parsed.data,
      profileId: parsed.data.profileId ?? session.profileId ?? undefined,
      subject: parsed.data.subject ?? session.subject ?? undefined,
    });
    reply.code(201);
    return event;
  });

  /**
   * GET /api/engagement?weeks=N&profileId=… — aggregated quiet/resume
   * patterns (used by the parent view's engagement panel).
   */
  app.get("/api/engagement", async (request) => {
    const query = request.query as { weeks?: string; profileId?: string };
    const weeks = Math.max(1, Math.min(12, Number(query.weeks ?? "1") || 1));
    const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();
    return deps.engagement.summarize(since, query.profileId || undefined);
  });

  // ---------- Parent view (roadmap: weekly summary per student) ----------

  /**
   * GET /api/parent/summary?weeks=N — per-student weekly learning summary:
   * lessons, quiz accuracy, XP, streak, due flashcards, and engagement
   * patterns (quiet spells + resumes per subject).
   */
  app.get("/api/parent/summary", async (request) => {
    const query = request.query as { weeks?: string };
    const weeks = Math.max(1, Math.min(12, Number(query.weeks ?? "1") || 1));
    const since = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString();

    const profiles = deps.profiles.list();
    const currentProfileId = deps.profiles.getCurrent();
    const rows: Array<{
      profileId: string | null;
      name: string;
      lessons: number;
      finished: number;
      quizCorrect: number;
      quizAsked: number;
      xp: number;
    }> = [];

    const summarize = (profileId: string | null, name: string) => {
      const sessions = deps.sessions
        .list(500, profileId ?? undefined)
        .filter((s) => s.createdAt >= since);
      const active = sessions.filter((s) => s.status !== "abandoned");
      rows.push({
        profileId,
        name,
        lessons: active.length,
        finished: sessions.filter((s) => s.status === "completed").length,
        quizCorrect: active.reduce((acc, s) => acc + s.quizScore[0], 0),
        quizAsked: active.reduce((acc, s) => acc + s.quizScore[1], 0),
        xp: active.reduce((acc, s) => acc + s.xp, 0),
      });
    };

    if (profiles.length === 0) {
      summarize(null, "Everyone (solo mode)");
    } else {
      for (const profile of profiles) summarize(profile.id, profile.name);
    }

    return {
      weeks,
      since,
      rows,
      stats: deps.studyStats.get(),
      dueCards: deps.srs.dueCount(currentProfileId ?? undefined),
      engagement: deps.engagement.summarize(since, currentProfileId ?? undefined),
    };
  });
}

function renderMarkdown(data: Awaited<ReturnType<typeof buildLessonExport>>): string {
  const lines: string[] = [];
  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(
    `**Subject:** ${data.session.subject} · **Level:** ${data.session.gradeLevel ?? "—"} · **XP earned:** ${data.xp} · **Quiz score:** ${data.quizScore[0]}/${data.quizScore[1]}`,
  );
  lines.push("");
  // Study journey (ADR-0007): streaks, badges, mastery.
  const badgeLabels: Record<string, string> = {
    first_correct: "🌟 First Win",
    streak_3: "🔥 On Fire (3 in a row)",
    streak_5: "⚡ Unstoppable (5 in a row)",
    quiz_5: "🎯 Quiz Regular (5 answered)",
    xp_100: "💯 Century (100 XP)",
    cards_10: "🃏 Card Shark (10 mastered)",
  };
  lines.push("## Study journey");
  lines.push("");
  lines.push(
    `- **Total XP:** ${data.stats.totalXp} · **Level:** ${Math.floor(data.stats.totalXp / 50) + 1}`,
  );
  lines.push(
    `- **Answer streak:** ${data.stats.answerStreak} (best ${data.stats.bestAnswerStreak}) · **Daily streak:** ${data.stats.dailyStreak} days (best ${data.stats.bestDailyStreak})`,
  );
  lines.push(`- **Hints taken this lesson:** ${data.hintsTaken}`);
  if (data.stats.badges.length > 0) {
    lines.push(
      `- **Badges:** ${data.stats.badges.map((b) => badgeLabels[b] ?? b).join(", ")}`,
    );
  }
  if (data.flashcards.some((c) => c.mastered)) {
    lines.push(
      `- **Flashcards mastered:** ${data.flashcards.filter((c) => c.mastered).length}/${data.flashcards.length}`,
    );
  }
  lines.push("");
  if (data.problem) {
    lines.push("## Study material");
    lines.push("");
    lines.push(data.problem);
    lines.push("");
  }
  if (data.boardLines.length > 0) {
    lines.push("## What was on the board");
    lines.push("");
    for (const line of data.boardLines) lines.push(`- ${line}`);
    lines.push("");
  }
  if (data.chalkLog.length > 0) {
    lines.push("## Chalk log (in order)");
    lines.push("");
    for (const entry of data.chalkLog) {
      if (entry.text) {
        lines.push(`- ${entry.actor === "tutor" ? "🧑‍🏫" : "🙋"} ${entry.type}: ${entry.text}`);
      }
    }
    lines.push("");
  }
  lines.push("## Conversation");
  lines.push("");
  for (const turn of data.transcript) {
    lines.push(`**${turn.role === "tutor" ? "Tutor" : "Student"}** (${turn.createdAt}):`);
    lines.push("");
    lines.push(turn.content);
    lines.push("");
  }
  if (data.quizResults.length > 0) {
    lines.push("## Quiz results");
    lines.push("");
    for (const q of data.quizResults) {
      lines.push(`- ${q.correct ? "✅" : "❌"} ${q.question} — ${q.feedback ?? ""}`);
    }
    lines.push("");
  }
  if (data.flashcards.length > 0) {
    lines.push("## Flashcards");
    lines.push("");
    for (const card of data.flashcards) {
      lines.push(`- ${card.mastered ? "✅" : "⬜"} **${card.front}** → ${card.back}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
