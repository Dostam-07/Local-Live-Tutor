/**
 * Parent view (roadmap): a weekly summary of what each student studied —
 * lessons, finished lessons, quiz accuracy, XP, streaks, and due flashcards.
 * Local-only: this page simply reads the family's own database; no accounts,
 * no sharing. Weeks selector (1–12) and per-student rows.
 */
import { useCallback, useEffect, useState } from "react";

import { Banner, Panel, Spinner } from "../../components/ui";
import { api, type ParentSummary } from "../../lib/api";

function accuracy(correct: number, asked: number): string {
  if (asked === 0) return "—";
  return `${Math.round((correct / asked) * 100)}%`;
}

/** Human-friendly duration for quiet spells ("4 min", "1 min 50 s"). */
function quietLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${m} min` : `${m} min ${rest}s`;
}

const SUBJECT_LABELS: Record<string, string> = {
  math: "Math",
  science: "Science",
  english: "English",
  history: "History",
  geography: "Geography",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
  other: "Other",
  computerscience: "Computer science",
};

function subjectLabel(subject?: string | null): string {
  if (!subject) return "General";
  return SUBJECT_LABELS[subject.toLowerCase()] ?? subject.charAt(0).toUpperCase() + subject.slice(1);
}

/** A gentle, honest description of an engagement rung. */
function rungLabel(rung: number): string {
  return rung <= 1 ? "gentle check-in" : rung === 2 ? "offered a hint" : "offered a smaller step";
}

export default function ParentPage() {
  const [summary, setSummary] = useState<ParentSummary | null>(null);
  const [weeks, setWeeks] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (w: number) => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.parentSummary(w));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the weekly summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(weeks);
  }, [load, weeks]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold">Parent view</h1>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Period
          <select
            aria-label="Summary period"
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className="rounded-lg border border-paper-grid bg-surface px-2 py-1.5 text-sm text-ink"
          >
            <option value={1}>This week</option>
            <option value={2}>Last 2 weeks</option>
            <option value={4}>Last month</option>
            <option value={12}>Last 3 months</option>
          </select>
        </label>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner /> Loading…
        </div>
      )}

      {summary && (
        <>
          <Panel title="The week at a glance">
            <div className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
              <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
                <p className="text-lg font-bold tabular-nums text-ink">{summary.stats.totalXp}</p>
                <p className="text-[10px] uppercase tracking-wide text-ink-soft">total XP</p>
              </div>
              <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
                <p className="text-lg font-bold tabular-nums text-ink">
                  {summary.stats.dailyStreak}d
                </p>
                <p className="text-[10px] uppercase tracking-wide text-ink-soft">day streak</p>
              </div>
              <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
                <p className="text-lg font-bold tabular-nums text-ink">
                  {summary.stats.badges.length}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-ink-soft">badges earned</p>
              </div>
              <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
                <p className="text-lg font-bold tabular-nums text-ink">{summary.dueCards}</p>
                <p className="text-[10px] uppercase tracking-wide text-ink-soft">cards due</p>
              </div>
            </div>
          </Panel>

          <Panel title={`Per student — last ${summary.weeks} week${summary.weeks === 1 ? "" : "s"}`}>
            <div className="divide-y divide-paper-grid">
              {summary.rows.length === 0 && (
                <p className="p-4 text-sm text-ink-soft">No students yet — create profiles from the header switcher.</p>
              )}
              {summary.rows.map((row) => (
                <div key={row.profileId ?? "solo"} className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-semibold text-ink">{row.name}</p>
                    <p className="text-xs text-ink-soft">
                      {row.lessons} lesson{row.lessons === 1 ? "" : "s"} started
                      {row.finished > 0 ? ` · ${row.finished} finished` : ""}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold tabular-nums text-ink">
                      {accuracy(row.quizCorrect, row.quizAsked)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                      quiz accuracy ({row.quizCorrect}/{row.quizAsked})
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold tabular-nums text-ink">{row.xp}</p>
                    <p className="text-[10px] uppercase tracking-wide text-ink-soft">XP this period</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <EngagementPanel summary={summary.engagement} weeks={summary.weeks} />

          <p className="text-xs leading-relaxed text-ink-soft">
            All data is local to this device — nothing is uploaded anywhere. Quiz accuracy counts
            quizzes, handwriting practice, and warm-up reviews answered in the selected period.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Engagement patterns (parent view): when the tutor had to check in because
 * the student went quiet, how long the quiet spells lasted, when the student
 * came back, and how that differs per subject. Framed honestly and kindly —
 * a quiet spell is "thinking time", not misbehavior; the deepest escalation
 * rung shows where extra patience was needed.
 */
function EngagementPanel({
  summary,
  weeks,
}: {
  summary: ParentSummary["engagement"];
  weeks: number;
}) {
  if (summary.quietSpells === 0 && summary.resumes === 0) {
    return (
      <Panel title="Engagement patterns">
        <p className="p-4 text-sm text-ink-soft">
          No quiet spells recorded in the last {weeks} week{weeks === 1 ? "" : "s"} — the tutor
          never had to check in. Quiet spells appear when a student pauses long enough that the
          tutor gently asks if they're still there.
        </p>
      </Panel>
    );
  }

  const subjects = summary.perSubject.filter((s) => s.quietSpells > 0 || s.resumes > 0);
  const maxSpells = Math.max(1, ...subjects.map((s) => s.quietSpells));

  return (
    <Panel title="Engagement patterns — when they go quiet, and when they come back">
      <div className="space-y-4 p-4">
        {/* Headline numbers. */}
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
            <p className="text-lg font-bold tabular-nums text-ink">{summary.quietSpells}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink-soft">quiet spells</p>
          </div>
          <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
            <p className="text-lg font-bold tabular-nums text-ink">
              {quietLabel(summary.avgQuietSeconds)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-ink-soft">avg quiet time</p>
          </div>
          <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
            <p className="text-lg font-bold tabular-nums text-ink">
              {quietLabel(summary.longestQuietSeconds)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-ink-soft">longest pause</p>
          </div>
          <div className="rounded-xl border border-paper-grid px-3 py-2 text-center">
            <p className="text-lg font-bold tabular-nums text-ink">
              {quietLabel(summary.avgResumeSeconds)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-ink-soft">avg time back</p>
          </div>
        </div>

        {/* Per-subject patterns (only subjects with real events appear). */}
        {subjects.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Per subject
            </p>
            <div className="space-y-2">
              {subjects.map((s) => (
                <div key={s.subject} className="rounded-xl border border-paper-grid px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-ink">{subjectLabel(s.subject)}</span>
                    <span className="text-xs text-ink-soft">
                      {s.quietSpells} quiet spell{s.quietSpells === 1 ? "" : "s"} · avg{" "}
                      {quietLabel(s.avgQuietSeconds)}
                      {s.resumes > 0 ? ` · came back ${s.resumes}×` : " · no resume recorded"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-grid">
                    <div
                      className="h-full rounded-full bg-tutor-blue/70"
                      style={{ width: `${Math.max(8, (s.quietSpells / maxSpells) * 100)}%` }}
                    />
                  </div>
                  {s.deepestRung >= 2 && (
                    <p className="mt-1 text-xs text-ink-soft">
                      Needed the most patience here — tutor {rungLabel(s.deepestRung)} before they
                      returned.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent quiet spells drill-down. */}
        {summary.recentQuietSpells.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Recent quiet spells
            </p>
            <div className="divide-y divide-paper-grid rounded-xl border border-paper-grid">
              {summary.recentQuietSpells.slice(0, 6).map((spell, i) => (
                <div
                  key={`${spell.sessionId}-${spell.at}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="text-ink">
                    {subjectLabel(spell.subject)} · quiet {quietLabel(spell.quietSeconds)}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {new Date(spell.at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    {" · "}
                    {spell.resumed ? "resumed ✓" : "no resume yet"} · tutor {rungLabel(spell.rung)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs leading-relaxed text-ink-soft">
          Quiet spells are recorded when the tutor gently checks in after a pause — they usually
          mean thinking, not trouble. Long spells that end without a resume may mean the lesson was
          simply left open.
        </p>
      </div>
    </Panel>
  );
}
