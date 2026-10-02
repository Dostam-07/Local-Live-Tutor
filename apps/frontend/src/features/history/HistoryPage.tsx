/**
 * Learning hub (user spec): everything the student has learnt in one section.
 * A stats strip (XP, streak, badges, accuracy, flashcards mastered), subject
 * filters, search, and a card per lesson — each with its own download link —
 * replacing the old plain session list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Session, StudyStats, Subject } from "@local-live-tutor/shared";
import { BADGES } from "@local-live-tutor/shared";

import { api } from "../../lib/api";
import { Banner, Button, EmptyState, Panel } from "../../components/ui";

const SUBJECT_EMOJI: Record<Subject, string> = {
  math: "🧮",
  science: "🌱",
  english: "📖",
  history: "🏛",
  geography: "🌍",
  computer_science: "💻",
  languages: "🗣",
  other: "📚",
};

const SUBJECT_LABEL: Record<Subject, string> = {
  math: "Math",
  science: "Science",
  english: "English",
  history: "History",
  geography: "Geography",
  computer_science: "Computer science",
  languages: "Languages",
  other: "General",
};

function Stat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center">
      <span aria-hidden className="text-base leading-none">
        {icon}
      </span>
      <span className="text-sm font-bold tabular-nums text-[#f0ead9]">{value}</span>
      <span className="truncate text-[10px] uppercase tracking-wide text-[#cfc6b8]">{label}</span>
    </div>
  );
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<Subject | "all">("all");

  const refresh = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([api.listSessions(), api.getStats().catch(() => null)]);
      setSessions(list);
      if (s) setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sessions.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subjects actually present in the student's lessons (for the filter chips).
  const subjects = useMemo(() => {
    const set = new Set<Subject>();
    for (const s of sessions) set.add(s.subject);
    return [...set];
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (subjectFilter !== "all" && s.subject !== subjectFilter) return false;
      if (!q) return true;
      const hay = `${s.title ?? ""} ${s.extractedProblem ?? ""} ${s.currentGoal ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sessions, query, subjectFilter]);

  // Aggregate learning numbers across every lesson.
  const totals = useMemo(() => {
    let asked = 0;
    let correct = 0;
    let xp = 0;
    let completed = 0;
    for (const s of sessions) {
      asked += s.quizScore[1];
      correct += s.quizScore[0];
      xp += s.xp;
      if (s.status === "completed") completed += 1;
    }
    return { asked, correct, xp, completed };
  }, [sessions]);

  const level = Math.floor((stats?.totalXp ?? totals.xp) / 50) + 1;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">My learning</h1>
        <Button
          variant="danger"
          onClick={async () => {
            if (!window.confirm("Delete ALL local session data? This cannot be undone.")) return;
            await api.deleteAllSessions();
            await refresh();
          }}
        >
          Delete all local data
        </Button>
      </div>
      {error && <Banner tone="error">{error}</Banner>}

      {/* Stats strip: the "what have I learnt" summary (ADR-0007 gamification). */}
      {sessions.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat icon="⚡" value={`Lv ${level}`} label={`${stats?.totalXp ?? totals.xp} XP`} />
          <Stat icon="🔥" value={String(stats?.dailyStreak ?? 0)} label="day streak" />
          <Stat
            icon="🎯"
            value={totals.asked > 0 ? `${Math.round((totals.correct / totals.asked) * 100)}%` : "—"}
            label={`${totals.correct}/${totals.asked} quiz`}
          />
          <Stat icon="🏁" value={String(totals.completed)} label="finished" />
          <Stat icon="🃏" value={String(stats?.masteredFlashcards.length ?? 0)} label="cards" />
          <Stat
            icon="🏅"
            value={String(stats?.badges.length ?? 0)}
            label={(stats?.badges ?? []).map((b) => BADGES.find((x) => x.id === b)?.icon ?? "").join("") || "badges"}
          />
        </div>
      )}

      {/* Search + subject chips. */}
      {sessions.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search what you've learnt…"
            aria-label="Search lessons"
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#f0ead9] placeholder:text-[#cfc6b8] outline-none focus:border-amber-300/50"
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSubjectFilter("all")}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold [touch-action:manipulation] ${
                subjectFilter === "all"
                  ? "border-amber-300/60 bg-amber-400/15 text-amber-200"
                  : "border-white/10 bg-white/5 text-[#cfc6b8] hover:bg-white/10"
              }`}
            >
              All
            </button>
            {subjects.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSubjectFilter(subjectFilter === s ? "all" : s)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold [touch-action:manipulation] ${
                  subjectFilter === s
                    ? "border-amber-300/60 bg-amber-400/15 text-amber-200"
                    : "border-white/10 bg-white/5 text-[#cfc6b8] hover:bg-white/10"
                }`}
              >
                <span aria-hidden className="mr-1">
                  {SUBJECT_EMOJI[s]}
                </span>
                {SUBJECT_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      <Panel>
        {sessions.length === 0 ? (
          <EmptyState
            title="Nothing learnt yet"
            hint="Start a new session and every lesson — topic, quiz marks, recap — will be kept here, stored only on this machine."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No lessons match" hint="Try a different search or subject filter." />
        ) : (
          <ul className="grid gap-3 p-3 sm:grid-cols-2">
            {filtered.map((session) => {
              const pct =
                session.quizScore[1] > 0
                  ? Math.round((session.quizScore[0] / session.quizScore[1]) * 100)
                  : null;
              return (
                <li
                  key={session.id}
                  className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/sessions/${session.id}`}
                      className="min-w-0 flex-1 truncate text-sm font-semibold text-tutor-blue hover:underline"
                      title={session.title ?? session.extractedProblem ?? "Lesson"}
                    >
                      <span aria-hidden className="mr-1.5">
                        {SUBJECT_EMOJI[session.subject]}
                      </span>
                      {session.title ?? session.extractedProblem ?? `${SUBJECT_LABEL[session.subject]} lesson`}
                    </Link>
                    {session.status === "completed" && (
                      <span
                        className={
                          session.title?.includes("· paused")
                            ? "shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300"
                            : "shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300"
                        }
                        title={
                          session.title?.includes("· paused")
                            ? "Auto-saved after a quiet stretch — tap to pick up right where you left off"
                            : "Lesson finished with a recap"
                        }
                      >
                        {session.title?.includes("· paused") ? "⏸ paused" : "✓ done"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#cfc6b8]">
                    {SUBJECT_LABEL[session.subject]} ·{" "}
                    {new Date(session.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {session.status === "completed" ? (session.title?.includes("· paused") ? "paused — saved" : "finished") : session.status}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#f0ead9]/80">
                    <span title="XP earned in this lesson">⚡ {session.xp} XP</span>
                    {pct !== null && (
                      <span title={`${session.quizScore[0]} of ${session.quizScore[1]} quiz answers correct`}>
                        🎯 {pct}%
                      </span>
                    )}
                    {session.gradeLevel && (
                      <span className="capitalize">{session.gradeLevel.replace("_", " ")}</span>
                    )}
                  </div>
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Link
                      to={`/sessions/${session.id}`}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[#f0ead9] hover:bg-white/10 [touch-action:manipulation]"
                    >
                      Reopen
                    </Link>
                    <a
                      href={`/api/sessions/${session.id}/export.pdf`}
                      className="rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/25 [touch-action:manipulation]"
                    >
                      ⬇️ Notes
                    </a>
                    <Button
                      variant="ghost"
                      className="ml-auto !px-2 !py-1 !text-xs"
                      onClick={async () => {
                        await api.deleteSession(session.id);
                        await refresh();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
