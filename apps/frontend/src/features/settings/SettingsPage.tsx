/**
 * Settings (PRD §5.7, §12, §13). Models are listed from the live provider;
 * the OpenRouter key is configured server-side and only its status is shown.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  AppSettings,
  LessonLanguage,
  ModelInfo,
  TutorPersona,
  TutorPreference,
  TutorVoice,
} from "@local-live-tutor/shared";

import { Banner, Button, Panel, Spinner, StatusPill, TextField, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { primeVoices } from "../../lib/tutorVoice";
import { resolveTutorVoice, sttLangTag } from "../../lib/lessonLanguage";
import { piperAvailability } from "../../lib/offlineVoice";
import { LANGUAGE_LABELS } from "@local-live-tutor/shared";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProfilesStore } from "../../stores/profilesStore";

const PERSONA_LABELS: Record<TutorPersona, string> = {
  friendly: "Friendly & warm (default)",
  calm: "Calm & steady",
  sweet: "Sweet & encouraging",
  sarcastic: "Sarcastic (playful wit)",
  genz: "Gen-Z (casual slang)",
  strict: "Strict teacher (high standards)",
};

const VOICE_LABELS: Record<TutorVoice, string> = {
  auto: "Auto (browser default)",
  female: "Female voice",
  male: "Male voice",
};

export default function SettingsPage() {
  const { settings, health, load, update, refreshHealth } = useSettingsStore();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelDetail, setModelDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshModels = useCallback(async () => {
    if (!settings) return;
    const result = await api.providerModels(settings.llmProvider);
    setModels(result.models);
    setModelDetail(result.detail ?? null);
  }, [settings]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  if (!settings) {
    return (
      <div className="flex items-center justify-center p-10 text-sm text-ink-soft">
        <Spinner /> Loading settings…
      </div>
    );
  }

  const save = async (patch: Partial<AppSettings>) => {
    setSaving(true);
    setSaved(false);
    try {
      await update(patch);
      setSaved(true);
      await refreshHealth();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-lg font-bold">Settings</h1>

      <Panel title="Model provider">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <TextField label="Provider">
            <select
              className={inputClass}
              value={settings.llmProvider}
              onChange={(e) => void save({ llmProvider: e.target.value as AppSettings["llmProvider"] })}
            >
              <option value="ollama">Ollama (local, private)</option>
              <option value="openrouter">OpenRouter (remote)</option>
            </select>
          </TextField>
          <TextField label="Ollama base URL">
            <input
              className={inputClass}
              defaultValue={settings.ollamaBaseUrl ?? ""}
              onBlur={(e) => void save({ ollamaBaseUrl: e.target.value })}
            />
          </TextField>
          <TextField label={`Ollama model (${models.length} installed)`}>
            <input
              className={inputClass}
              list="ollama-models"
              defaultValue={settings.ollamaModel ?? ""}
              placeholder="Pick or type a model"
              onBlur={(e) => void save({ ollamaModel: e.target.value })}
            />
            <datalist id="ollama-models">
              {models.map((model) => (
                <option key={model.name} value={model.name} />
              ))}
            </datalist>
          </TextField>
          <TextField label="Ollama vision model (for image problems)">
            <input
              className={inputClass}
              list="ollama-models"
              defaultValue={settings.ollamaVisionModel ?? ""}
              onBlur={(e) => void save({ ollamaVisionModel: e.target.value })}
            />
          </TextField>
          <TextField label="OpenRouter model (free models change often)">
            <input
              className={inputClass}
              defaultValue={settings.openRouterModel ?? ""}
              onBlur={(e) => void save({ openRouterModel: e.target.value })}
            />
          </TextField>
          <div className="flex items-end">
            <StatusPill tone={settings.openRouterApiKeyConfigured ? "ok" : "warn"}>
              API key {settings.openRouterApiKeyConfigured ? "configured on server" : "not configured"}
            </StatusPill>
          </div>
        </div>
        {modelDetail && (
          <div className="px-4 pb-3">
            <Banner tone="warn">{modelDetail}</Banner>
          </div>
        )}
        <div className="border-t border-paper-grid px-4 py-3">
          <Banner tone="info">
            <strong>Privacy:</strong> with Ollama, problems and conversations never leave this
            machine. Choosing OpenRouter sends data to a remote service — that is the
            remote-processing warning required by the PRD.
          </Banner>
        </div>
      </Panel>

      <Panel title="Voice">
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <TextField label="Speech-to-text">
            <select
              className={inputClass}
              value={settings.sttProvider}
              onChange={(e) => void save({ sttProvider: e.target.value as AppSettings["sttProvider"] })}
            >
              <option value="browser">Browser (Web Speech)</option>
              <option value="whisper_local">Local Whisper (if configured)</option>
              <option value="none">Off</option>
            </select>
          </TextField>
          <TextField label="Text-to-speech">
            <select
              className={inputClass}
              value={settings.ttsProvider}
              onChange={(e) => void save({ ttsProvider: e.target.value as AppSettings["ttsProvider"] })}
            >
              <option value="browser">Browser voices</option>
              <option value="piper_local">Local Piper (if configured)</option>
              <option value="none">Off</option>
            </select>
          </TextField>
          <TextField label="Auto-read tutor replies">
            <select
              className={inputClass}
              value={settings.autoSpeak ? "on" : "off"}
              onChange={(e) => void save({ autoSpeak: e.target.value === "on" })}
            >
              <option value="off">Off (default)</option>
              <option value="on">On</option>
            </select>
          </TextField>
          <TextField label="Voice conversation mode">
            <select
              className={inputClass}
              value={settings.voiceMode ? "on" : "off"}
              onChange={(e) => void save({ voiceMode: e.target.value === "on" })}
            >
              <option value="on">On — continuous talk-it-out lessons (recommended)</option>
              <option value="off">Off — mic per message</option>
            </select>
          </TextField>
          <TextField label="Tutor voice">
            <select
              className={inputClass}
              value={settings.tutorVoice}
              onChange={(e) => void save({ tutorVoice: e.target.value as TutorVoice })}
            >
              {(Object.keys(VOICE_LABELS) as TutorVoice[]).map((v) => (
                <option key={v} value={v}>
                  {VOICE_LABELS[v]}
                </option>
              ))}
            </select>
          </TextField>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => {
                primeVoices();
                const sample =
                  settings.tutorVoice === "female"
                    ? "Hi! I'm your tutor — ready to learn something great today?"
                    : "Hey! I'm your tutor — ready to learn something great today?";
                if (!("speechSynthesis" in window)) return;
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(sample);
                const voice = resolveTutorVoice(settings.lessonLanguage, settings.tutorVoice);
                if (voice) {
                  utterance.voice = voice;
                  utterance.lang = voice.lang;
                } else {
                  utterance.lang = sttLangTag(settings.lessonLanguage);
                }
                window.speechSynthesis.speak(utterance);
              }}
            >
              ▶ Preview voice
            </Button>
          </div>
          <OfflineVoicesStatus language={settings.lessonLanguage} />
        </div>
      </Panel>

      <Panel title="Tutor persona">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <TextField label="Teaching style">
            <select
              className={inputClass}
              value={settings.tutorPersona}
              onChange={(e) => void save({ tutorPersona: e.target.value as TutorPersona })}
            >
              {(Object.keys(PERSONA_LABELS) as TutorPersona[]).map((p) => (
                <option key={p} value={p}>
                  {PERSONA_LABELS[p]}
                </option>
              ))}
            </select>
          </TextField>
          <TextField label="Read the room (adaptive persona)">
            <select
              className={inputClass}
              value={settings.adaptivePersona ? "on" : "off"}
              onChange={(e) => void save({ adaptivePersona: e.target.value === "on" })}
            >
              <option value="on">On — extra encouraging when you're stuck, playful when cruising</option>
              <option value="off">Off — always speak in the chosen style</option>
            </select>
          </TextField>
          <TextField label="Check-in when you're quiet">
            <select
              className={inputClass}
              value={String(settings.nudgeTimeoutSeconds)}
              onChange={(e) => void save({ nudgeTimeoutSeconds: Number(e.target.value) })}
            >
              <option value="0">Off — wait as long as I need</option>
              <option value="60">After 1 minute of quiet</option>
              <option value="90">After 1½ minutes of quiet</option>
              <option value="120">After 2 minutes of quiet (recommended)</option>
              <option value="180">After 3 minutes of quiet</option>
              <option value="300">After 5 minutes of quiet</option>
            </select>
          </TextField>
          <div className="pb-1 text-xs text-ink-soft sm:col-span-2">
            Shapes how the tutor talks — humor, warmth, and pace. The teaching
            method (Socratic steps, honesty, safety) stays the same in every
            persona, and it applies from the very next message. With "read the
            room" on, a struggling stretch drops the jokes and slows down; a
            cruising stretch celebrates and raises the challenge. The quiet
            check-in is a gentle "still there?" — it never marks you wrong,
            never reveals the answer, and fires at most once per pause.
          </div>
        </div>
      </Panel>

      <Panel title="Lesson language">
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <TextField label="Language">
            <select
              aria-label="Language"
              className={inputClass}
              value={settings.lessonLanguage}
              onChange={(e) => void save({ lessonLanguage: e.target.value as LessonLanguage })}
            >
              {(Object.keys(LANGUAGE_LABELS) as LessonLanguage[]).map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </TextField>
          <div className="flex items-end pb-1 text-xs text-ink-soft">
            "Match my language" replies in whatever language you speak or type.
            Pick a specific language to pin the whole lesson — teaching, board
            chalk, quizzes, and the tutor's voice all switch to it.
          </div>
        </div>
      </Panel>      <ProfileDefaultsPanel />
      <TutorPreferencesPanel />
      <Panel title="Privacy">
        <div className="space-y-3 p-4 text-sm text-ink-soft">
          <p>
            Telemetry is permanently disabled in this build ({String(settings.telemetryEnabled)}).
            The app runs without accounts. All sessions live in a local SQLite file.
          </p>
          <Button
            variant="danger"
            onClick={async () => {
              if (!window.confirm("Delete ALL local session data?")) return;
              await api.deleteAllSessions();
              window.alert("All local sessions deleted.");
            }}
          >
            Delete all local data
          </Button>
        </div>
      </Panel>

      <div className="flex items-center gap-2 text-xs text-ink-soft">
        {saving && <Spinner label="Saving" />}
        {saved && <span>Saved ✓</span>}
      </div>
    </div>
  );
}

/**
 * Offline voices status (roadmap: language-accurate offline voices). Shows
 * whether the local Piper server is configured/up and which languages have a
 * voice model installed on THIS machine — the honest state, no mocks. When a
 * pinned language has no OS voice but Piper has one, lessons speak in that
 * language fully offline.
 */
function OfflineVoicesStatus({ language }: { language: LessonLanguage }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof piperAvailability>> | null>(null);
  useEffect(() => {
    void piperAvailability().then(setStatus);
  }, []);
  if (!status) return null;
  const pinned = language !== "auto" ? language : undefined;
  const piperCovers = pinned ? status.languages.includes(pinned) : false;
  const browserCovers = pinned
    ? window.speechSynthesis?.getVoices().some((v) => v.lang.split("-")[0]?.toLowerCase() === pinned) ?? false
    : true;
  const tone = !pinned || browserCovers || piperCovers ? "text-ink-soft" : "text-amber-600";
  return (
    <div className={`pb-1 text-xs sm:col-span-2 ${tone}`} data-testid="offline-voices-status">
      {status.configured ? (
        <>
          Offline voices: Piper server {status.serverUp ? "running" : "not running"}
          {status.languages.length > 0
            ? ` — voices installed for: ${status.languages.join(", ")}`
            : " — no voice models found in the voices folder"}
          {pinned && !browserCovers && piperCovers
            ? ` — your ${pinned} lessons will speak through Piper (fully offline).`
            : ""}
          {pinned && !browserCovers && !piperCovers
            ? ` — no offline voice for ${pinned} yet; add a Piper model to the voices folder to fix that.`
            : ""}
        </>
      ) : (
        <>Offline voices: not configured — lessons use your browser/OS voice packs. Run a Piper server and set PIPER_TTS_URL to add fully offline voices.</>
      )}
    </div>
  );
}

/**
 * Per-profile defaults (roadmap: multi-student local profiles). Each student
 * gets their own starting style, voice, language, and grade level — applied
 * to their new lessons and editable here.
 */
function ProfileDefaultsPanel() {
  const { profiles, currentProfileId, load, update } = useProfilesStore();
  const current = profiles.find((p) => p.id === currentProfileId) ?? null;

  useEffect(() => {
    void load();
  }, [load]);

  if (profiles.length === 0) {
    return (
      <Panel title="Student profiles">
        <div className="p-4 text-sm text-ink-soft">
          Solo mode — no profiles yet. Add students from the header switcher
          (top bar) to give each learner their own defaults, history, and XP.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Student profiles">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {profiles.map((p) => (
            <span
              key={p.id}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                p.id === currentProfileId ? "bg-tutor-blue text-white" : "bg-paper text-ink-soft"
              }`}
            >
              {p.id === currentProfileId ? "✓ " : ""}
              {p.name}
            </span>
          ))}
        </div>
        {current && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={`${current.name}'s teaching style`}>
              <select
                className={inputClass}
                value={current.defaultPersona ?? ""}
                onChange={(e) =>
                  void update(current.id, {
                    defaultPersona: (e.target.value || undefined) as TutorPersona | undefined,
                  })
                }
              >
                <option value="">App default</option>
                {(Object.keys(PERSONA_LABELS) as TutorPersona[]).map((p) => (
                  <option key={p} value={p}>
                    {PERSONA_LABELS[p]}
                  </option>
                ))}
              </select>
            </TextField>
            <TextField label={`${current.name}'s voice`}>
              <select
                className={inputClass}
                value={current.defaultVoice ?? ""}
                onChange={(e) =>
                  void update(current.id, {
                    defaultVoice: (e.target.value || undefined) as TutorVoice | undefined,
                  })
                }
              >
                <option value="">App default</option>
                <option value="auto">Auto</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </TextField>
            <TextField label={`${current.name}'s lesson language`}>
              <select
                className={inputClass}
                value={current.defaultLanguage ?? ""}
                onChange={(e) =>
                  void update(current.id, {
                    defaultLanguage: (e.target.value || undefined) as LessonLanguage | undefined,
                  })
                }
              >
                <option value="">App default</option>
                <option value="auto">Match my language</option>
                {(Object.keys(LANGUAGE_LABELS) as LessonLanguage[])
                  .filter((l) => l !== "auto")
                  .map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
              </select>
            </TextField>
            <TextField label={`${current.name}'s grade level`}>
              <select
                className={inputClass}
                value={current.defaultGradeLevel ?? ""}
                onChange={(e) =>
                  void update(current.id, {
                    defaultGradeLevel: (e.target.value || undefined) as
                      | "elementary"
                      | "middle_school"
                      | "high_school"
                      | "college"
                      | undefined,
                  })
                }
              >
                <option value="">App default</option>
                <option value="elementary">Elementary</option>
                <option value="middle_school">Middle school</option>
                <option value="high_school">High school</option>
                <option value="college">College</option>
              </select>
            </TextField>
          </div>
        )}
        <p className="text-xs text-ink-soft">
          These defaults prefill {current?.name}'s new lessons (per-session
          memory keeps each lesson exactly as they left it).
        </p>
      </div>
    </Panel>
  );
}

const PREF_CATEGORY_LABEL: Record<string, string> = {
  explanation: "Explanation style",
  pacing: "Pacing",
  problem_solving: "Problem solving",
  examples: "Examples",
  interaction: "Interaction",
  voice: "Voice",
  other: "Other",
};

/**
 * My Tutor Preferences (self-improving personalization, spec §4, §7): the
 * student sees exactly what the tutor remembers about how they learn, can
 * edit/remove lines, add their own, confirm patterns, or wipe everything.
 * The student is always in control.
 */
function TutorPreferencesPanel() {
  const [prefs, setPrefs] = useState<TutorPreference[]>([]);
  const [patterns, setPatterns] = useState<
    Array<{ kind: string; count: number; suggested: { text: string; category: string } | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState<TutorPreference["category"]>("explanation");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void api
      .listPreferences()
      .then((r) => setPrefs(r.preferences))
      .catch(() => setError("Could not load preferences."))
      .finally(() => setLoading(false));
    void api
      .listPatterns()
      .then((r) => setPatterns(r.patterns))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addDraft = async () => {
    if (draft.trim().length < 3) return;
    try {
      await api.addPreference(draft.trim(), draftCategory);
      setDraft("");
      load();
    } catch {
      setError("Could not save that preference.");
    }
  };

  return (
    <Panel title="My tutor preferences">
      {error && <Banner tone="error">{error}</Banner>}
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-3" data-testid="tutor-preferences">
          {prefs.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Nothing saved yet — the tutor teaches everyone the same way. End a session with some
              feedback (or add a preference below) and it will start adapting to how YOU learn.
            </p>
          ) : (
            <ul className="space-y-2">
              {prefs.map((p) =>
                editingId === p.id ? (
                  <li key={p.id} className="flex items-center gap-2">
                    <input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className={inputClass}
                      aria-label="Edit preference"
                    />
                    <Button
                      variant="primary"
                      onClick={() => {
                        void api
                          .updatePreference(p.id, editText)
                          .then(() => {
                            setEditingId(null);
                            load();
                          })
                          .catch(() => setError("Could not update."));
                      }}
                    >
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </li>
                ) : (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-ink">✓ {p.text}</p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {PREF_CATEGORY_LABEL[p.category] ?? p.category}
                        {" · "}
                        {p.source === "pattern"
                          ? "from a pattern you confirmed"
                          : "from your feedback"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        aria-label={`Edit: ${p.text}`}
                        title="Edit"
                        className="rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-white/10 hover:text-ink"
                        onClick={() => {
                          setEditingId(p.id);
                          setEditText(p.text);
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove: ${p.text}`}
                        title="Remove"
                        className="rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-white/10 hover:text-ink"
                        onClick={() => {
                          void api.removePreference(p.id).then(load);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}

          {/* Repeated patterns awaiting confirmation (spec §8) — never
              auto-applied; the student decides. */}
          {patterns.length > 0 && (
            <div className="rounded-lg border border-amber-300/30 bg-amber-400/10 p-3">
              <p className="text-xs font-semibold text-amber-200">
                I noticed a pattern — want me to make it a rule?
              </p>
              {patterns.map((p) =>
                p.suggested ? (
                  <div key={p.kind} className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-amber-100/90">
                      {p.suggested.text} ({p.count}×)
                    </p>
                    <Button
                      variant="primary"
                      onClick={() => {
                        void api.confirmPattern(p.kind).then(load);
                      }}
                    >
                      Save it
                    </Button>
                  </div>
                ) : null,
              )}
            </div>
          )}

          {/* Add a preference by hand. */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a preference, e.g. use cricket examples"
              className={`${inputClass} min-w-0 flex-1`}
              aria-label="New preference"
            />
            <select
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value as TutorPreference["category"])}
              className={inputClass}
              aria-label="Preference category"
            >
              {Object.entries(PREF_CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button variant="primary" disabled={draft.trim().length < 3} onClick={() => void addDraft()}>
              Add
            </Button>
          </div>

          {/* Full reset = personalization off (spec §7). */}
          {prefs.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-3">
              <p className="text-xs text-ink-soft">
                Personalization lives only in your local database — deleting it removes it forever.
              </p>
              {confirmReset ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="danger"
                    onClick={() => {
                      void api.resetPreferences().then(() => {
                        setConfirmReset(false);
                        load();
                      });
                    }}
                  >
                    Yes, reset
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                  Reset personalization
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
