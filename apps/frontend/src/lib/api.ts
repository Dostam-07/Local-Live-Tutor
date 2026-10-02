/**
 * Typed REST client (PRD §11 surface). The frontend never sees API keys —
 * settings expose only the configured boolean (PRD §13).
 */
import type {
  AppSettings,
  CreateProfileInput,
  ExtractionResult,
  HandwritingFeedback,
  LessonExport,
  Message,
  Profile,
  Session,
  StudyStats,
  UpdateProfileInput,
  WhiteboardOperation,
  EngagementSummary,
  EngagementEvent,
  FeedbackInterpretation,
  TutorPreference,
} from "@local-live-tutor/shared";

/** Weekly per-student learning summary (roadmap: parent view). */
export type ParentSummary = {
  weeks: number;
  since: string;
  rows: Array<{
    profileId: string | null;
    name: string;
    lessons: number;
    finished: number;
    quizCorrect: number;
    quizAsked: number;
    xp: number;
  }>;
  stats: StudyStats;
  dueCards: number;
  engagement: EngagementSummary;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as
    | T
    | { error?: { code: string; message: string; details?: unknown } }
    | null;
  if (!response.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } })?.error;
    throw new ApiError(
      err?.code ?? "internal_error",
      err?.message ?? `Request failed (${response.status})`,
      response.status,
      err?.details,
    );
  }
  return data as T;
}

export const api = {
  // Health & providers
  health: () => request<{ ok: boolean }>("GET", "/api/health"),
  providerHealth: () =>
    request<{
      primary: { provider: string; available: boolean; detail?: string; models?: { name: string }[] };
      fallbackAllowed: boolean;
      effective: { provider: string; model: string };
      capabilities: { text: boolean; vision: boolean; streaming: boolean; structuredOutput: boolean };
    }>("GET", "/api/providers/health"),
  providerModels: (provider: string) =>
    request<{ models: { name: string; supportsVision?: boolean }[]; detail?: string }>(
      "GET",
      `/api/providers/models?provider=${encodeURIComponent(provider)}`,
    ),

  // Settings
  getSettings: () => request<AppSettings>("GET", "/api/settings"),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>("PATCH", "/api/settings", patch),

  // Profiles (roadmap: multi-student local profiles)
  listProfiles: () =>
    request<{ profiles: Profile[]; currentProfileId: string | null }>("GET", "/api/profiles"),
  createProfile: (input: CreateProfileInput) =>
    request<Profile>("POST", "/api/profiles", input),
  updateProfile: (id: string, patch: UpdateProfileInput) =>
    request<Profile>("PATCH", `/api/profiles/${id}`, patch),
  deleteProfile: (id: string) => request<void>("DELETE", `/api/profiles/${id}`),

  // Student Tutoring Profile (self-improving personalization).
  sendFeedback: (text: string, sessionId?: string) =>
    request<FeedbackInterpretation & { saved: number }>("POST", "/api/feedback", {
      text,
      ...(sessionId ? { sessionId } : {}),
    }),
  listPreferences: () =>
    request<{ preferences: TutorPreference[] }>("GET", "/api/preferences"),
  addPreference: (text: string, category: TutorPreference["category"]) =>
    request<{ preference: TutorPreference }>("POST", "/api/preferences", {
      text,
      category,
    }),
  updatePreference: (id: string, text: string) =>
    request<{ preference: TutorPreference }>("PATCH", `/api/preferences/${id}`, { text }),
  removePreference: (id: string) =>
    request<{ removed: boolean }>("DELETE", `/api/preferences/${id}`),
  resetPreferences: () =>
    request<{ removed: number }>("DELETE", "/api/preferences"),
  listPatterns: () =>
    request<{
      patterns: Array<{
        kind: string;
        count: number;
        suggested: { text: string; category: string } | null;
      }>;
    }>("GET", "/api/preferences/patterns"),
  confirmPattern: (kind: string) =>
    request<{ preference: TutorPreference }>(
      "POST",
      `/api/preferences/patterns/${kind}/confirm`,
    ),
  activateProfile: (id: string) =>
    request<{ ok: boolean; currentProfileId: string }>(
      "POST",
      `/api/profiles/${id}/activate`,
    ),

  // Sessions
  createSession: (input: Partial<Session> = {}) =>
    request<Session>("POST", "/api/sessions", input),
  listSessions: () => request<Session[]>("GET", "/api/sessions"),
  getSession: (id: string) => request<Session>("GET", `/api/sessions/${id}`),
  updateSession: (id: string, patch: Record<string, unknown>) =>
    request<Session>("PATCH", `/api/sessions/${id}`, patch),
  deleteSession: (id: string) => request<void>("DELETE", `/api/sessions/${id}`),
  deleteAllSessions: () => request<{ deleted: number }>("DELETE", "/api/sessions"),

  // Problem
  setTextProblem: (id: string, text: string) =>
    request<{ session: Session }>("POST", `/api/sessions/${id}/problem/text`, { text }),
  confirmProblem: (id: string, text: string) =>
    request<{ confirmed: boolean }>("POST", `/api/sessions/${id}/problem/confirm`, { text }),
  uploadImageProblem: (id: string, imageDataUrl: string) =>
    request<{ session: Session; extraction: ExtractionResult; imagePath: string }>(
      "POST",
      `/api/sessions/${id}/problem/image`,
      { imageDataUrl },
    ),
  // Documents (ADR-0006): photo or PDF study material.
  uploadDocument: (id: string, dataUrl: string) =>
    request<{ session: Session; text: string; kind: "image" | "pdf" }>(
      "POST",
      `/api/sessions/${id}/document`,
      { dataUrl },
    ),
  // Lesson export (ADR-0006).
  exportLesson: (id: string) => request<LessonExport>("GET", `/api/sessions/${id}/export`),

  // Study stats (ADR-0007 gamification).
  getStats: () => request<StudyStats>("GET", `/api/stats`),
  markMastered: (fronts: string[]) =>
    request<{ stats: StudyStats; newBadges: string[] }>(
      "POST",
      `/api/stats/mastered`,
      { fronts },
    ),

  // Spaced repetition (roadmap: SRS flashcard review).
  srsDue: () =>
    request<{ due: { front: string; back: string }[]; count: number }>("GET", `/api/srs/due`),
  srsGrade: (front: string, grade: 0 | 1 | 2 | 3) =>
    request<{ card: unknown; stats: StudyStats }>("POST", `/api/srs/grade`, { front, grade }),

  // Handwriting practice (roadmap: student chalks, tutor grades).
  gradeHandwriting: (
    id: string,
    input: { prompt: string; written: string; expected?: string; imageDataUrl?: string },
  ) =>
    request<{ feedback: HandwritingFeedback }>(
      "POST",
      `/api/sessions/${id}/handwriting`,
      input,
    ),

  // Study link import (roadmap: Classroom / Moodle / any URL).
  importLink: (url: string) =>
    request<{ title: string; text: string; url: string }>("POST", `/api/import/link`, { url }),

  // Parent view (roadmap: weekly per-student summary).
  parentSummary: (weeks = 1) =>
    request<ParentSummary>("GET", `/api/parent/summary?weeks=${weeks}`),
  /** Records one engagement event (nudge fired / student resumed). */
  recordEngagement: (event: {
    sessionId: string;
    kind: "nudge_fired" | "resumed";
    rung?: number;
    quietSeconds?: number;
    resumedVia?: "typed" | "spoke" | "tapped";
    subject?: string;
    profileId?: string;
  }) => request<EngagementEvent>("POST", "/api/engagement", event),

  // Messages & board
  listMessages: (id: string) => request<Message[]>("GET", `/api/sessions/${id}/messages`),
  getWhiteboard: (id: string) =>
    request<{ operations: WhiteboardOperation[] }>("GET", `/api/sessions/${id}/whiteboard`),
  pushStudentOps: (id: string, operations: { type: string; payload: Record<string, unknown> }[]) =>
    request<{ operations: WhiteboardOperation[] }>(
      "POST",
      `/api/sessions/${id}/whiteboard/operations`,
      { operations },
    ),
  clearWhiteboard: (id: string) =>
    request<{ deleted: number }>("DELETE", `/api/sessions/${id}/whiteboard`),

  // Summary
  summarize: (id: string) => request<Message>("POST", `/api/sessions/${id}/summary`),
};

export type TurnResult = {
  studentMessage: Message;
  tutorMessage: Message;
  whiteboardOps: WhiteboardOperation[];
  provider: string;
  model: string;
  fellBackToText: boolean;
  xpAwarded?: number;
  session?: Session;
  /** Cumulative study stats after this turn (ADR-0007), when stats moved. */
  stats?: StudyStats;
  /** Badges newly unlocked by this turn (ADR-0007). */
  newBadges?: string[];
};
