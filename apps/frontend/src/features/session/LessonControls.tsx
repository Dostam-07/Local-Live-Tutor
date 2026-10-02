/**
 * Board-side lesson controls: subject, grade level, and help style live in a
 * small popover off the board's subject pill (user spec — the explicit knobs
 * from the old setup form, available to students who want them without
 * forcing a form on everyone). Changes PATCH the live session and shape the
 * tutor's very next turn (prompt context reads the session fresh per turn).
 */
import { useEffect, useRef, useState } from "react";
import {
  GRADE_LEVELS,
  HELP_LEVELS,
  LANGUAGE_LABELS,
  SUBJECTS,
  type GradeLevel,
  type HelpLevel,
  type LessonLanguage,
  type Subject,
  type TutorPersona,
  type TutorVoice,
} from "@local-live-tutor/shared";

export const SUBJECT_LABELS: Record<Subject, string> = {
  math: "Math",
  science: "Science",
  english: "English",
  history: "History",
  geography: "Geography",
  computer_science: "Computer science",
  languages: "Languages",
  other: "Auto / other",
};

export const GRADE_LABELS: Record<GradeLevel, string> = {
  elementary: "Elementary",
  middle_school: "Middle school",
  high_school: "High school",
  college: "College",
};

export const HELP_LABELS: Record<HelpLevel, string> = {
  socratic: "Ask me questions",
  hints: "Give me hints",
  step_by_step: "Walk me step by step",
  direct: "Explain directly",
};

export type LessonControlsPatch = {
  subject?: Subject;
  gradeLevel?: GradeLevel;
  helpLevel?: HelpLevel;
  language?: LessonLanguage;
  /** Style/voice/language knobs (per-session memory, roadmap): on the welcome
   *  board these are stashed as prefs and sent with the session create; in a
   *  live lesson they PATCH the session row. */
  persona?: TutorPersona;
  voice?: TutorVoice;
};

export const PERSONA_LABELS: Record<TutorPersona, string> = {
  friendly: "Friendly",
  calm: "Calm",
  sweet: "Sweet",
  sarcastic: "Sarcastic",
  genz: "Gen-Z",
  strict: "Strict",
};

export const VOICE_LABELS: Record<TutorVoice, string> = {
  auto: "Auto",
  female: "Female",
  male: "Male",
};

const selectCls =
  "rounded-md border border-white/15 bg-[#2b2924] px-2 py-1.5 text-xs text-[#f0ead9] outline-none focus:border-amber-300/60";

export function LessonControlPopover({
  subject,
  gradeLevel,
  helpLevel,
  onChange,
  disabled = false,
  persona,
  voice,
  language,
  updateSettings,
}: {
  subject: Subject;
  gradeLevel?: GradeLevel;
  helpLevel: HelpLevel;
  onChange: (patch: LessonControlsPatch) => void;
  disabled?: boolean;
  /** Current tutor persona (per-session memory, roadmap). */
  persona: TutorPersona;
  /** Current tutor voice preference (per-session memory, roadmap). */
  voice: TutorVoice;
  /** Current lesson language (multilingual roadmap). */
  language?: LessonLanguage;
  /** Persists persona/voice/language onto THIS lesson. */
  updateSettings: (patch: {
    persona?: TutorPersona;
    voice?: TutorVoice;
    language?: LessonLanguage;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — standard popover behavior.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // The pill is measured on open (see onClick) and the panel opens to its
  // LEFT via position: fixed (user fix: the absolute dropdown dropped below
  // the pill and was clipped by the board edge / overlapped by the answer
  // bar). Fixed coords ignore every ancestor's overflow, so the panel is
  // always fully visible, neatly beside the pill over the board.

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Lesson settings${persona !== "friendly" ? ` — ${PERSONA_LABELS[persona]}` : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        title="Subject, grade level, and help style"
        onClick={() => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) {
            const PANEL_W = 248;
            const margin = 8;
            setPos({
              // Left of the pill, vertically aligned with its top (clamped
              // so it never leaves the viewport).
              left: Math.max(margin, rect.left - PANEL_W - margin),
              top: Math.min(
                Math.max(margin, rect.top - margin),
                Math.max(margin, window.innerHeight - 372),
              ),
            });
          }
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-[#f0ead9] backdrop-blur-sm transition-colors hover:bg-black/45 disabled:opacity-50 [touch-action:manipulation]"
      >
        <span aria-hidden>📖</span>
        <span>{SUBJECT_LABELS[subject]}</span>
        {/* Non-default style is surfaced so the student can see at a glance
            how THIS lesson is taught (per-session memory, roadmap). */}
        {persona !== "friendly" && (
          <span aria-hidden className="text-[10px] font-semibold opacity-90">
            · {PERSONA_LABELS[persona]}
          </span>
        )}
        <span aria-hidden className="text-[10px] opacity-70">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && pos && (
        // position:fixed at measured coords — never clipped by the board,
        // never under the answer bar (user fix).
        <div
          role="dialog"
          aria-label="Lesson settings"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 248 }}
          className="z-50 max-h-[356px] overflow-y-auto rounded-xl border border-white/15 bg-[#2b2924] p-3 shadow-xl"
        >
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#cfc6b8]">
              Lesson settings
            </p>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs text-[#f0ead9]">
                Subject
                <select
                  aria-label="Subject"
                  value={subject}
                  onChange={(e) => onChange({ subject: e.target.value as Subject })}
                  className={selectCls}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {SUBJECT_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#f0ead9]">
                Grade level
                <select
                  aria-label="Grade level"
                  value={gradeLevel ?? "middle_school"}
                  onChange={(e) => onChange({ gradeLevel: e.target.value as GradeLevel })}
                  className={selectCls}
                >
                  {GRADE_LEVELS.map((g) => (
                    <option key={g} value={g}>
                      {GRADE_LABELS[g]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#f0ead9]">
                Help style
                <select
                  aria-label="Help style"
                  value={helpLevel}
                  onChange={(e) => onChange({ helpLevel: e.target.value as HelpLevel })}
                  className={selectCls}
                >
                  {HELP_LEVELS.map((h) => (
                    <option key={h} value={h}>
                      {HELP_LABELS[h]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[#cfc6b8]/80">
              Applies from your very next message — the tutor adapts immediately.
            </p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-[#cfc6b8]">
              Tutor style, voice &amp; language
            </p>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs text-[#f0ead9]">
                Style
                <select
                  aria-label="Style"
                  value={persona}
                  onChange={(e) => void updateSettings({ persona: e.target.value as TutorPersona })}
                  className={selectCls}
                >
                  {(Object.keys(PERSONA_LABELS) as TutorPersona[]).map((p) => (
                    <option key={p} value={p}>
                      {PERSONA_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#f0ead9]">
                Voice
                <select
                  aria-label="Voice"
                  value={voice}
                  onChange={(e) => void updateSettings({ voice: e.target.value as TutorVoice })}
                  className={selectCls}
                >
                  {(Object.keys(VOICE_LABELS) as TutorVoice[]).map((v) => (
                    <option key={v} value={v}>
                      {VOICE_LABELS[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#f0ead9]">
                Lesson language
                <select
                  aria-label="Lesson language"
                  value={language ?? "auto"}
                  onChange={(e) => void updateSettings({ language: e.target.value as LessonLanguage })}
                  className={selectCls}
                >
                  {(Object.keys(LANGUAGE_LABELS) as LessonLanguage[]).map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[#cfc6b8]/80">
              Style, voice &amp; language are remembered with THIS lesson —
              reopen it anytime and the tutor picks up exactly where you left
              off.
            </p>
        </div>
      )}
    </div>
  );
}
