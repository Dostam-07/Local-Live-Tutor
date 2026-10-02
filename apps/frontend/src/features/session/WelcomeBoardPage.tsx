/**
 * Welcome board (user spec): the chalkboard is the home screen, but NO
 * session exists until the student actually says, types, or uploads
 * something. The tutor's greeting ("What are we learning today?") is a local
 * welcome line on an empty board — free, instant, and no empty sessions pile
 * up in History from idle visits.
 *
 * First input → create the session → hand the text/upload to the workspace,
 * which teaches from it immediately (no duplicate greeting there).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { stashFirstMessage } from "../../lib/firstMessage";
import { sttLangTag } from "../../lib/lessonLanguage";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProfilesStore } from "../../stores/profilesStore";
import {
  LessonControlPopover,
  SUBJECT_LABELS,
  type LessonControlsPatch,
} from "./LessonControls";
import { useVoiceConversation } from "./useVoiceConversation";

export default function WelcomeBoardPage() {
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  /** Explicit lesson settings — only sent when the student actually sets them. */
  const [prefs, setPrefs] = useState<LessonControlsPatch>({});
  /** Study-link import (roadmap): inline URL entry on the board. */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  /** Spaced repetition (roadmap): due flashcards for the warm-up badge. */
  const [dueCards, setDueCards] = useState(0);
  /** Live persona/voice so the popover reflects saved changes immediately. */
  const savedPersona = useSettingsStore((s) => s.settings?.tutorPersona ?? "friendly");
  const savedVoice = useSettingsStore((s) => s.settings?.tutorVoice ?? "auto");
  const savedLanguage = useSettingsStore((s) => s.settings?.lessonLanguage ?? "auto");
  const currentProfileId = useProfilesStore((s) => s.currentProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const profile = profiles.find((p) => p.id === currentProfileId) ?? null;
  // Active profile's defaults prefill the board knobs (multi-student roadmap):
  // each student opens the board already tuned the way they learn best.
  const effectivePersona = prefs.persona ?? profile?.defaultPersona ?? savedPersona;
  const effectiveVoice = prefs.voice ?? profile?.defaultVoice ?? savedVoice;
  const effectiveLanguage = prefs.language ?? profile?.defaultLanguage ?? savedLanguage;
  /** StrictMode mounts effects twice — never double-create a session. */
  const creatingRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const voice = useVoiceConversation({
    onCommit: (text) => void begin(text, undefined),
    tutorSpeaking: false,
    // Multilingual (user bug: the welcome mic always listened in English).
    // The board pill's language (explicit pick or profile default) drives STT
    // so a Hindi lesson hears Hindi from the very first word.
    language: sttLangTag(effectiveLanguage),
  });

  /** Create the session with the student's first input, then board it. */
  const begin = useCallback(
    async (text?: string, upload?: { name: string; dataUrl: string }) => {
      const trimmed = text?.trim();
      if (!trimmed && !upload) return;
      if (creatingRef.current) return;
      creatingRef.current = true;
      setError(null);
      setBusy(upload ? "Reading your file…" : "Setting up the board…");
      voice.stopListening();
      try {
        const session = await api.createSession(prefs);
        stashFirstMessage(session.id, {
          ...(trimmed ? { text: trimmed } : {}),
          ...(upload ? { upload } : {}),
          ...(Object.keys(prefs).length > 0 ? { prefs } : {}),
        });
        navigate(`/sessions/${session.id}`, { replace: true });
      } catch (err) {
        creatingRef.current = false;
        setBusy(null);
        setError(err instanceof Error ? err.message : "Could not start the session.");
      }
    },
    [navigate, voice, prefs],
  );

  const submitTyped = useCallback(() => {
    if (!typed.trim() || busy) return;
    void begin(typed);
  }, [typed, busy, begin]);

  const attachFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => void begin(undefined, { name: file.name, dataUrl: String(reader.result) });
      reader.onerror = () => setError("Could not read that file.");
      reader.readAsDataURL(file);
    },
    [begin],
  );

  // Load settings so the provider pill in the app shell is accurate.
  useEffect(() => {
    void useSettingsStore.getState().load();
    // Due-flashcard badge (roadmap: SRS warm-up). Silent on failure — the
    // badge is a nicety, never a blocker for starting a lesson.
    api
      .srsDue()
      .then((r) => setDueCards(r.count))
      .catch(() => undefined);
  }, []);

  /** Fetch a study link and start the lesson from its extracted material. */
  const importLink = useCallback(async () => {
    const url = linkUrl.trim();
    if (!url || busy) return;
    setBusy("Reading that link…");
    setError(null);
    try {
      const material = await api.importLink(url);
      setLinkOpen(false);
      setLinkUrl("");
      setUploadNote(`Loaded: ${material.title}`);
      window.setTimeout(() => setUploadNote(null), 5000);
      await begin(material.text.slice(0, 4000));
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Could not import that link.");
    }
  }, [linkUrl, busy, begin]);

  const micButton =
    voice.supported ? (
      <button
        type="button"
        aria-label={voice.phase === "listening" ? "Stop listening" : "Start voice"}
        onClick={() => (voice.phase === "listening" ? voice.stopListening() : voice.startListening())}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg shadow [touch-action:manipulation] ${
          voice.phase === "listening" ? "mic-live bg-[#f6c453] text-[#33302a]" : "bg-[#e3dccb] text-[#4c463c]"
        }`}
      >
        <span aria-hidden="true">🎙</span>
      </button>
    ) : (
      <button
        type="button"
        aria-label="Voice input is not available in this browser"
        title="Voice input needs Chrome or Edge (Web Speech API)."
        onClick={voice.startListening}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e3dccb]/60 text-lg text-[#4c463c]/50 [touch-action:manipulation]"
      >
        <span aria-hidden="true">🎙</span>
      </button>
    );

  return (
    <div className="mockup-shell relative flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
        <span className="mockup-title whitespace-nowrap">AI Teacher</span>
        <span className="min-w-0 flex-1 truncate text-sm text-[#cfc6b8]">
          Socratic voice &amp; chalkboard tutor
        </span>
      </header>

      {/* Framed chalkboard — same stage as a lesson, just before the lesson. */}
      <div className="chalk-frame mx-5 min-h-0 flex-1">
        <div className="board-green relative h-full min-h-0" data-testid="chalkboard-surface">
          {/* Welcome chalk — the tutor's stand-up greeting, no session yet. */}
          <div className="pointer-events-none absolute inset-x-0 top-[16%] z-10 flex flex-col items-center gap-6 px-6 text-center">
            <p className="chalk-font chalk-text text-3xl sm:text-4xl">Welcome! 👋</p>
            <p className="chalk-font chalk-text text-2xl sm:text-3xl">What are we learning today?</p>
            <p className="chalk-font text-lg text-[#f0ead9]/75">
              Say it, type it below, upload a photo / PDF, or paste a link.
            </p>
            {dueCards > 0 && (
              <p className="chalk-font text-sm text-amber-200/90" data-testid="srs-due-badge">
                🧠 {dueCards} flashcard{dueCards === 1 ? "" : "s"} due for review — we'll warm up
                with them first.
              </p>
            )}
            <p className="chalk-font text-sm text-[#f0ead9]/60">
              Want them exact? Set subject, grade &amp; help style from the 📖 pill above.
            </p>
          </div>

          {voice.phase === "listening" && (
            <div className="absolute inset-x-4 top-3 z-20 rounded-lg border border-white/15 bg-black/45 px-3 py-1.5 text-center text-sm text-[#f0ead9] backdrop-blur-sm">
              🎙 Listening… "{voice.interim || "…"}"
            </div>
          )}
          {/* Lesson settings (opt-in): subject / grade / help style — sent
              with the first input only if the student actually set them. */}
          <div className="absolute right-3 top-3 z-20">
            <LessonControlPopover
              subject={prefs.subject ?? "other"}
              gradeLevel={prefs.gradeLevel}
              helpLevel={prefs.helpLevel ?? "socratic"}
              persona={effectivePersona}
              voice={effectiveVoice}
              language={effectiveLanguage}
              updateSettings={(patch) => setPrefs((prev) => ({ ...prev, ...patch }))}
              onChange={(patch) => setPrefs((prev) => ({ ...prev, ...patch }))}
            />
          </div>
          {uploadNote && (
            <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-white/15 bg-black/45 px-3 py-1.5 text-xs text-[#f0ead9] backdrop-blur-sm">
              {uploadNote}
            </div>
          )}
        </div>
      </div>

      {/* Conversational answer bar — the only way in, exactly like a lesson. */}
      <div className="shrink-0 px-5 pt-3">
        <div className="answer-bar mx-auto flex max-w-4xl items-center gap-2 px-2 py-2">
          {micButton}
          <input
            className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-[#33302a] outline-none"
            placeholder="Ask anything — or say what to teach you today…"
            value={typed}
            disabled={busy !== null}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed.trim()) submitTyped();
            }}
          />
          <button
            type="button"
            aria-label="Send"
            disabled={busy !== null || typed.trim().length === 0}
            onClick={submitTyped}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f6c453] text-lg text-[#33302a] shadow disabled:opacity-50"
          >
            ➤
          </button>
          <button
            type="button"
            aria-label="Upload a photo or PDF"
            disabled={busy !== null}
            onClick={() => uploadInputRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e3dccb] text-lg text-[#4c463c] shadow [touch-action:manipulation] disabled:opacity-50"
          >
            📎
          </button>
          <button
            type="button"
            aria-label="Import a study link"
            title="Import from Google Classroom, Moodle, or any study page"
            disabled={busy !== null}
            onClick={() => setLinkOpen((v) => !v)}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg shadow [touch-action:manipulation] disabled:opacity-50 ${
              linkOpen ? "bg-[#f6c453] text-[#33302a]" : "bg-[#e3dccb] text-[#4c463c]"
            }`}
          >
            🔗
          </button>
        </div>
        {linkOpen && (
          <div className="mx-auto mt-2 flex max-w-4xl items-center gap-2">
            <input
              autoFocus
              type="url"
              aria-label="Study link URL"
              placeholder="Paste a Google Classroom, Moodle, or study page link…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void importLink();
                if (e.key === "Escape") setLinkOpen(false);
              }}
              className="h-10 min-w-0 flex-1 rounded-lg border border-paper-grid bg-surface px-3 text-sm text-ink outline-none focus:border-tutor-blue"
            />
            <button
              type="button"
              disabled={!linkUrl.trim() || busy !== null}
              onClick={() => void importLink()}
              className="h-10 shrink-0 rounded-lg bg-tutor-blue px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Import
            </button>
          </div>
        )}
      </div>

      {/* Tutor speech bubble: greeting is local, voice errors surface here. */}
      <div className="shrink-0 px-5 pb-4">
        <div className="speech-bubble mx-auto max-w-4xl px-4 py-2.5 text-sm">
          <span className="mr-1">✨</span>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> {busy}
            </span>
          ) : error ? (
            <span className="text-chalk-pink">{error}</span>
          ) : voice.error ? (
            <span data-testid="voice-fallback" className="text-chalk-pink">
              {voice.error}
            </span>
          ) : voice.interim ? (
            `You: ${voice.interim}`
          ) : (
            "Hey! I'm so glad you're here. What are we learning today?"
          )}
        </div>
      </div>

      {/* Hidden file input: images + PDFs. */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) attachFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
