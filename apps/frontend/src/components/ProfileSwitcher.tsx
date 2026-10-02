/**
 * Profile switcher (roadmap: multi-student local profiles). Lives in the
 * global header: shows who is at the chalkboard, lets a family member switch,
 * and creates/removes profiles. Switching re-runs the page-level fetches via
 * a location key so History/stats re-scope instantly.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LessonLanguage, TutorPersona, TutorVoice } from "@local-live-tutor/shared";

import { useProfilesStore } from "../stores/profilesStore";

const selectCls =
  "rounded-md border border-paper-grid bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-tutor-blue";

export function ProfileSwitcher() {
  const { profiles, currentProfileId, load, create, activate, remove } = useProfilesStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

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

  const current = profiles.find((p) => p.id === currentProfileId) ?? null;

  const switchTo = async (id: string) => {
    setBusy(true);
    try {
      await activate(id);
      setOpen(false);
      // Remount the current page so its profile-scoped fetches re-run.
      navigate(0);
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await create({ name: trimmed });
      setName("");
      setCreating(false);
      setOpen(false);
      navigate(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Student profile: ${current ? current.name : "Solo"}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[180px] items-center gap-1.5 rounded-lg border border-paper-grid px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-paper"
      >
        <span aria-hidden>🧑‍🎓</span>
        <span className="truncate">{current ? current.name : "Solo"}</span>
        <span aria-hidden className="text-[10px] opacity-70">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Student profiles"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-paper-grid bg-surface p-3 shadow-xl"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Who's learning?
          </p>
          <div className="flex flex-col gap-1">
            {profiles.length === 0 && (
              <p className="px-1 py-1 text-xs text-ink-soft">
                Solo mode — everyone shares one space. Create profiles to give each student their
                own lessons, XP, and defaults.
              </p>
            )}
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void switchTo(p.id)}
                  className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-paper ${
                    p.id === currentProfileId ? "font-semibold text-tutor-blue" : "text-ink"
                  }`}
                >
                  {p.id === currentProfileId ? "✓ " : ""}
                  {p.name}
                  {p.defaultLanguage && p.defaultLanguage !== "auto" ? (
                    <span className="ml-1 text-[10px] uppercase text-ink-soft">
                      {p.defaultLanguage}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${p.name}? Their lessons stay in the database.`)) {
                      void remove(p.id);
                    }
                  }}
                  className="rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-paper hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {creating ? (
            <div className="mt-2 flex items-center gap-1">
              <input
                autoFocus
                value={name}
                maxLength={60}
                placeholder="Student's name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitCreate();
                }}
                className="min-w-0 flex-1 rounded-md border border-paper-grid bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-tutor-blue"
              />
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => void submitCreate()}
                className="rounded-md bg-tutor-blue px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-2 w-full rounded-md border border-dashed border-paper-grid px-2 py-1.5 text-xs text-ink-soft hover:bg-paper"
            >
              + Add a student
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Optional per-profile defaults editor (kept minimal; used by Settings). */
export const PROFILE_PERSONA_OPTIONS: TutorPersona[] = [
  "friendly",
  "calm",
  "sweet",
  "sarcastic",
  "genz",
  "strict",
];
export const PROFILE_VOICE_OPTIONS: TutorVoice[] = ["auto", "female", "male"];
export const PROFILE_LANGUAGE_OPTIONS: LessonLanguage[] = [
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "hi",
  "pt",
  "it",
  "zh",
  "ja",
  "ko",
  "ar",
  "ru",
];
export { selectCls as profileSelectCls };
