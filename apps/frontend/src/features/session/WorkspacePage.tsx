/**
 * Workspace (ADR-0005 + ADR-0006): the chalkboard IS the lesson, and the
 * lesson is a conversation.
 *
 * Flow: the student lands, the tutor greets ("What are we learning today?"),
 * the student answers by voice or the always-on conversational bar — even
 * mid-explanation questions are welcome. Study material can arrive at any
 * time via the Upload orb (photo or PDF). After teaching, the tutor quizzes
 * (marks, XP) and deals flashcards. Download exports the complete lesson.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Message, Session, StudyStats, WhiteboardOperation } from "@local-live-tutor/shared";
import { BADGES } from "@local-live-tutor/shared";

import { Banner, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { consumeFirstMessage, type FirstInput } from "../../lib/firstMessage";
import { primeVoices, type TutorVoicePref } from "../../lib/tutorVoice";
import { resolveTutorVoice, sttLangTag } from "../../lib/lessonLanguage";
import { toSpeechChunks } from "../../lib/speechText";
import { LiveSpeechExtractor } from "../../lib/liveSpeech";
import { SpeechQueue } from "../../lib/speechQueue";
import { InactivityTimer, pickNudge } from "../../lib/inactivityNudge";
import { streamLessonOpener, streamMessage, streamRecap } from "../../lib/sse";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWhiteboardStore } from "../../stores/whiteboardStore";
import { CHALK_STEP_MS, scheduleChalkOps, runChalkSequence } from "../whiteboard/chalkSequencer";
import { applyOpToEditor, setBoardLanguage } from "../whiteboard/opsBridge";
import { WhiteboardPanel } from "../whiteboard/WhiteboardPanel";
import { LessonControlPopover } from "./LessonControls";
import { ProblemSetupOverlay } from "./ProblemSetupOverlay";
import { TranscriptDrawer, type ChatEntry } from "./TranscriptDrawer";
import { FeedbackPrompt } from "./FeedbackPrompt";
import { PushToTalkButton } from "./PushToTalkButton";
import { FlashcardsModal } from "./FlashcardsModal";
import { HandwritingModal } from "./HandwritingModal";
import { useVoiceConversation } from "./useVoiceConversation";

export default function WorkspacePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [started, setStarted] = useState(false); // greeting delivered
  const [material, setMaterial] = useState<string | null>(null); // confirmed topic/material
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Optional feedback prompt on New-session exit (personalization, spec §1). */
  const [exitFeedbackOpen, setExitFeedbackOpen] = useState(false);
  /** A real lesson = at least one tutor turn (greeting or teaching). */
  const hasRealLesson = entries.length > 0;
  const [tutorSpeaking, setTutorSpeaking] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [typed, setTyped] = useState("");
  const [xpToast, setXpToast] = useState<number | null>(null);
  const [flashcards, setFlashcards] = useState<Array<{ front: string; back: string }> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [greetingDelivered, setGreetingDelivered] = useState(false);
  /** End-of-lesson ritual (ADR-0009): streaming + post-download-CTA states. */
  const [recapping, setRecapping] = useState(false);
  const [ritualDone, setRitualDone] = useState(false);
  /** Encouragement note: ONLY on a hint or after a correct answer (user spec). */
  const [note, setNote] = useState<{ title: string; body: string } | null>(null);
  /** Cumulative study stats + level-up celebration (ADR-0007). */
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [badgeToast, setBadgeToast] = useState<string | null>(null);
  /** A posed quiz awaiting the student's answer (multiple-choice or spoken). */
  const [activeQuiz, setActiveQuiz] = useState<{
    question: string;
    choices?: string[];
  } | null>(null);
  /** Handwriting practice (roadmap): prompt + modal visibility. */
  const [handwriting, setHandwriting] = useState<string | null>(null);
  /**
   * Student-inactivity nudge (user spec: patient human tutor, not a timeout).
   * `nudgeFired` marks that the CURRENT nudge was delivered (re-set by any
   * interaction); unanswered counting drives the escalation ladder, and each
   * subsequent check-in waits twice as long. `interactionTick` bumps on
   * every meaningful student action, restarting the countdown.
   */
  const [nudgeFired, setNudgeFired] = useState(false);
  const [interactionTick, setInteractionTick] = useState(0);
  /** The gentle check-in text, visible until the student interacts. */
  const [nudge, setNudge] = useState<string | null>(null);
  /** Consecutive nudges the student hasn't answered (drives escalation). */
  const [unansweredNudges, setUnansweredNudges] = useState(0);
  /** True while the student is actively drawing on the board (pen down). */
  const [drawingOnBoard, setDrawingOnBoard] = useState(false);
  /**
   * Engagement tracking (parent view: quiet/resume patterns per subject).
   * `quietSinceRef` marks when the tutor started waiting; on each nudge we
   * record the quiet spell (subject + escalation rung), on the student's
   * return we record the resume (typed/spoke/tapped + total gap).
   */
  const quietSinceRef = useRef<number | null>(null);
  const lastNudgeAtRef = useRef<number | null>(null);

  const loadSessionBoard = useWhiteboardStore((s) => s.loadSession);
  const appendServerOps = useWhiteboardStore((s) => s.appendServerOps);
  const autoSpeak = useSettingsStore((s) => s.settings?.autoSpeak ?? false);
  const voiceMode = useSettingsStore((s) => s.settings?.voiceMode ?? false);
  const appVoice = useSettingsStore((s) => s.settings?.tutorVoice ?? "auto");
  const appPersona = useSettingsStore((s) => s.settings?.tutorPersona ?? "friendly");
  const appLanguage = useSettingsStore((s) => s.settings?.lessonLanguage ?? "auto");
  /** Quiet check-in knob (settings): seconds of silence before a gentle nudge; 0 = off. */
  const nudgeTimeoutSeconds = useSettingsStore((s) => s.settings?.nudgeTimeoutSeconds ?? 120);

  // Per-session persona & voice memory (roadmap): how THIS lesson is taught
  // rides on the session row — set via the board pill, saved with the lesson,
  // and restored automatically when the student reopens it. Falls back to
  // the app-wide settings for older sessions that never saved a snapshot.
  const tutorPersona = session?.persona ?? appPersona;
  const tutorVoicePref = session?.voice ?? appVoice;
  const lessonLanguage = session?.language ?? appLanguage;

  // RTL board layout (roadmap: right-to-left chalk flow for Arabic/Hebrew):
  // the renderer mirrors the chalk column whenever the lesson language pins
  // an RTL script. Applies to session loads AND live pill changes.
  useEffect(() => {
    setBoardLanguage(session?.language ?? appLanguage);
  }, [session?.language, appLanguage]);

  const ttsStopRef = useRef<() => void>(() => undefined);
  const knownOpIdsRef = useRef<Set<string>>(new Set());
  /** Fire-time learning context for the inactivity nudge (quiz vs stuck vs waiting). */
  const nudgeContextRef = useRef<"quiz" | "explained" | "stuck" | "waiting">("waiting");
  const inactivityTimerRef = useRef<InactivityTimer | null>(null);
  if (!inactivityTimerRef.current) inactivityTimerRef.current = new InactivityTimer();
  const entriesRef = useRef<ChatEntry[]>([]);
  entriesRef.current = entries;
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const noteTimerRef = useRef<number | undefined>(undefined);
  const hintCountRef = useRef(0);
  const levelRef = useRef(1);

  /**
   * Show the sticky note on a hint or a correct answer; auto-hide after 8s.
   * Escalating variants (user spec): correct answers streak up 🔥, and repeated
   * hints rotate warmer messages so it never feels like a broken record.
   */
  const showEncouragement = useCallback(
    (m: Message, stats?: StudyStats) => {
      const isHint = m.responseType === "hint";
      const correct = m.quizGrading?.correct === true;
      if (!isHint && !correct) return;
      if (correct) {
        const streak = stats?.answerStreak ?? 1;
        const title =
          streak >= 5
            ? "⚡ UNSTOPPABLE!"
            : streak >= 3
              ? "🔥 On fire!"
              : "🎉 You're doing great!";
        const body =
          streak >= 5
            ? `Five in a row — ${streak} streak! Keep the momentum going.`
            : streak >= 3
              ? `${streak} correct in a row. Small steps lead to big understanding.`
              : "Exactly right — small steps lead to big understanding.";
        setNote({ title, body });
      } else {
        hintCountRef.current += 1;
        const n = hintCountRef.current;
        const title = n >= 3 ? "🧠 Every expert was once stuck" : n === 2 ? "💪 You're close now" : "💡 Keep going!";
        const body =
          n >= 3
            ? "Asking for a hint is a power move — that's how learning works."
            : n === 2
              ? "One more nudge and it will click."
              : "Small steps lead to big understanding.";
        setNote({ title, body });
      }
      if (noteTimerRef.current !== undefined) window.clearTimeout(noteTimerRef.current);
      noteTimerRef.current = window.setTimeout(() => setNote(null), 8000);
    },
    [],
  );

  useEffect(
    () => () => {
      if (noteTimerRef.current !== undefined) window.clearTimeout(noteTimerRef.current);
    },
    [],
  );

  const refreshMessages = useCallback(async (): Promise<ChatEntry[]> => {
    if (!sessionId) return [];
    const messages = await api.listMessages(sessionId);
    const next = messages.map((message) => ({ message }));
    setEntries(next);
    entriesRef.current = next;
    return next;
  }, [sessionId]);

  const applySession = useCallback((next: Session | undefined | null) => {
    if (next) setSession(next);
  }, []);

  /** Late-bound greeting trigger; the load effect runs before openLesson exists. */
  const greetingRef = useRef<() => void>(() => undefined);
  /** First-input handoff from the welcome board (text or upload), if any. */
  const firstInputRef = useRef<FirstInput | null>(null);
  /** Late-bound runners for the handoff (sendTurn/upload live further down). */
  const handoffRunnersRef = useRef<{
    sendText: (text: string) => void;
    sendUpload: (upload: { name: string; dataUrl: string }) => void;
  }>({ sendText: () => undefined, sendUpload: () => undefined });

  // Load settings (persona/voice) and warm the TTS voice list early —
  // Chrome populates speechSynthesis.getVoices() asynchronously.
  useEffect(() => {
    void useSettingsStore.getState().load();
    primeVoices();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.getSession(sessionId);
        if (cancelled) return;
        setSession(loaded);
        setMaterial(loaded.extractedProblem ?? null);
        await loadSessionBoard(sessionId);
        knownOpIdsRef.current = new Set(
          useWhiteboardStore.getState().ops.map((op) => op.id),
        );
        const loadedEntries = await refreshMessages();
        const lastTutor = [...loadedEntries].reverse().find((e) => e.message.role === "tutor");
        if (lastTutor) setCaption(lastTutor.message.content);
        // Confirmation gate (ADR-0008): material with NO tutor turn yet means
        // the student never confirmed it (e.g. photo attached pre-session) —
        // keep the overlay up. Material + conversation = already confirmed.
        const hasConversation = Boolean(lastTutor);
        setStarted(Boolean(loaded.extractedProblem) && hasConversation);
        // Cumulative stats for the XP pill (level, streak, badges — ADR-0007).
        api.getStats().then((s) => { if (!cancelled) { setStats(s); levelRef.current = Math.floor(s.totalXp / 50) + 1; } }).catch(() => undefined);
        // Greeting-first (ADR-0006): a fresh session's tutor opens with
        // "What are we learning today?" — but the welcome board already did
        // that for free. If the student arrived carrying their first input,
        // THAT starts the lesson instead of a redundant greeting: text runs
        // as turn one; an upload flows through the confirmation gate
        // (ADR-0008) exactly like a photo-primed session. Sessions with
        // unconfirmed material and no handoff wait on the overlay.
        const handoff = consumeFirstMessage(sessionId);
        if (handoff) firstInputRef.current = handoff;
        if (!cancelled && !lastTutor) {
          const pending = firstInputRef.current;
          if (pending?.prefs) {
            // Explicit lesson settings from the welcome board apply before
            // turn one, so the very first teaching answer respects them.
            void api.updateSession(sessionId, pending.prefs).then(applySession).catch(() => undefined);
          }
          if (pending?.text) {
            firstInputRef.current = null;
            handoffRunnersRef.current.sendText(pending.text);
          } else if (pending?.upload) {
            firstInputRef.current = null;
            handoffRunnersRef.current.sendUpload(pending.upload);
          } else if (!loaded.extractedProblem) {
            greetingRef.current();
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load the session.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadSessionBoard, refreshMessages]);

  /** Speaks text aloud and flips tutorSpeaking for echo control. The text
   *  goes through the SPEECH REPRESENTATION LAYER first (user spec §5–§7):
   *  math → words, markup/UI labels dropped — never raw board text. The
   *  voice honors the lesson's language + voice preference and stays stable
   *  across turns. */
  const speakTutor = useCallback(
    (text: string) => {
      if (!autoSpeak || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      // Breath-group chunks with a small pause between them — a tutor
      // explaining, not a paragraph being raced through.
      const chunks = toSpeechChunks(text, 180, lessonLanguage);
      const voice = resolveTutorVoice(lessonLanguage, tutorVoicePref);
      const synth = window.speechSynthesis;
      const makeUtterance = (chunk: string) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.rate = 0.94;
        u.pitch = 1.02;
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else {
          u.lang = sttLangTag(lessonLanguage);
        }
        return u;
      };
      // Chain chunks recursively: each ends, breathes, then speaks the next —
      // one queue of speech, natural pauses, single cancel point (barge-in).
      const speakAt = (i: number) => {
        if (i >= chunks.length) {
          setTutorSpeaking(false);
          return;
        }
        const utterance = makeUtterance(chunks[i]!);
        if (i === 0) {
          utterance.onstart = () => setTutorSpeaking(true);
          ttsStopRef.current = () => {
            synth.cancel();
            setTutorSpeaking(false);
          };
        }
        utterance.onend = () => window.setTimeout(() => speakAt(i + 1), 220);
        utterance.onerror = () => setTutorSpeaking(false);
        synth.speak(utterance);
      };
      if (chunks.length === 0) {
        setTutorSpeaking(false);
        return;
      }
      speakAt(0);
    },
    [autoSpeak, tutorVoicePref, lessonLanguage],
  );

  const stopSpeaking = useCallback(() => {
    ttsStopRef.current();
    liveSpeechRef.current?.stop();
  }, []);

  /**
   * Live speech (user spec: talk like pengi — no waiting for the whole
   * reply). A per-lesson queue + extractor pair; `beginLiveSpeech` opens a
   * new stream window, `speakStreamDelta` feeds it, `endLiveSpeech` flushes
   * the final partial sentence. Barge-in: stopSpeaking() kills it mid-word.
   */
  const liveSpeechRef = useRef<SpeechQueue | null>(null);
  const liveExtractorRef = useRef<LiveSpeechExtractor | null>(null);
  const beginLiveSpeech = useCallback(() => {
    liveSpeechRef.current = new SpeechQueue({
      language: lessonLanguage,
      voicePref: tutorVoicePref,
      onSpeakingChange: setTutorSpeaking,
    });
    liveExtractorRef.current = new LiveSpeechExtractor("message");
  }, [lessonLanguage, tutorVoicePref]);
  const speakStreamDelta = useCallback((raw: string) => {
    const queue = liveSpeechRef.current;
    const extractor = liveExtractorRef.current;
    if (!queue || !extractor) return;
    const sentences = extractor.push(raw);
    if (sentences.length > 0) {
      queue.enqueue(sentences);
      // Live caption tracks exactly what is being said/queued.
      setCaption(extractor.spoken);
    }
  }, []);
  const endLiveSpeech = useCallback(() => {
    const queue = liveSpeechRef.current;
    const extractor = liveExtractorRef.current;
    if (!queue || !extractor) return;
    const rest = extractor.flush();
    if (rest) {
      queue.enqueue([rest]);
      setCaption(extractor.spoken);
    }
    liveExtractorRef.current = null;
  }, []);

  /** Chalk-in the ops from a completed turn, staggered to feel like writing. */
  const revealChalkOps = useCallback(
    (ops: WhiteboardOperation[]) => {
      if (ops.length === 0) return;
      const fresh = ops.filter((op) => !knownOpIdsRef.current.has(op.id));
      if (fresh.length === 0) return;
      const existing = useWhiteboardStore.getState().ops;
      const claimedRows: number[] = [
        ...existing
          .filter((op) => op.type === "write")
          .map((op) => Number(op.payload.y ?? 0)),
      ];
      const spaced = fresh.map((op) => {
        if (op.type !== "write") return op;
        let y = Math.max(Number(op.payload.y ?? 0), 150);
        const x = Number(op.payload.x ?? 0);
        while (
          claimedRows.some((cy) => Math.abs(cy - y) < 70) ||
          existing.some(
            (prev) =>
              prev.type === "write" &&
              Math.abs(Number(prev.payload.y ?? 0) - y) < 70,
          )
        ) {
          y += 80;
          if (y > 900) y = 40;
        }
        claimedRows.push(y);
        return { ...op, payload: { ...op.payload, y } };
      });
      // Reveal ops ONE per beat: each op lands in the store only when its
      // delay fires, so the panel applies them like real sequential writing
      // (appending them all at once would collapse the stagger).
      runChalkSequence(
        scheduleChalkOps(spaced, CHALK_STEP_MS),
        (op) => {
          knownOpIdsRef.current.add(op.id);
          appendServerOps([op]);
        },
      );
    },
    [appendServerOps],
  );

  /** Adopt fresh stats; celebrate level-ups and new badges (ADR-0007). */
  const absorbStats = useCallback((next?: StudyStats, newBadges?: string[]) => {
    if (!next) return;
    setStats(next);
    const nextLevel = Math.floor(next.totalXp / 50) + 1;
    if (nextLevel > levelRef.current) {
      levelRef.current = nextLevel;
      setLevelUp(nextLevel);
      window.setTimeout(() => setLevelUp(null), 4000);
    }
    const firstBadge = newBadges?.[0];
    if (firstBadge) {
      const info = BADGES.find((b) => b.id === firstBadge);
      if (info) {
        setBadgeToast(`${info.icon} Badge unlocked: ${info.label}`);
        window.setTimeout(() => setBadgeToast(null), 5000);
      }
    }
  }, []);

  const absorbTurn = useCallback(
    (result: {
      tutorMessage: Message;
      session?: Session;
      xpAwarded?: number;
      stats?: StudyStats;
      newBadges?: string[];
      /** Live speech already spoke this turn mid-stream (pengi mode). */
      spokenLive?: boolean;
    }) => {
      // Quiz lifecycle: a posed question lights up the interactive answer
      // card (buttons for choices, mic-ready for open questions); a grading
      // clears it. Spoken quizzes are read aloud: the question AND, when
      // present, the choices are appended so TTS speaks them too.
      let spoken = result.tutorMessage.content;
      // The quiet check-in reads the room: what it says depends on what the
      // tutor just did (posed a quiz / explained / simply waiting).
      nudgeContextRef.current = result.tutorMessage.quiz
        ? "quiz"
        : result.tutorMessage.responseType === "hint" || result.tutorMessage.responseType === "partial_step" || result.tutorMessage.responseType === "diagnostic"
          ? "explained"
          : "waiting";
      if (result.tutorMessage.quiz) {
        setActiveQuiz(result.tutorMessage.quiz);
        const q = result.tutorMessage.quiz;
        if (q.choices?.length) {
          spoken = `${spoken} Your options: ${q.choices.join(", ")}.`;
          // The choices were never in the streamed sentence flow — speak them.
          if (result.spokenLive) {
            liveSpeechRef.current?.enqueue([`Your options: ${q.choices.join(", ")}.`]);
          }
        }
      } else if (result.tutorMessage.quizGrading) {
        setActiveQuiz(null);
      }
      setCaption(spoken);
      // Live speech already spoke the streamed sentences — do NOT restart the
      // whole reply from the top (that is the old, laggy behavior).
      if (!result.spokenLive) {
        speakTutor(spoken);
      }
      showEncouragement(result.tutorMessage, result.stats);
      applySession(result.session);
      absorbStats(result.stats, result.newBadges);
      // Any completed tutor turn means the lesson conversation is live — the
      // answer bar and lesson orbs unlock (the welcome board's handoff turn
      // skips openLesson, so this is what flips the gate for it).
      setGreetingDelivered(true);
      setStarted((prev) => prev || Boolean(result.tutorMessage));
      if (result.tutorMessage.flashcards?.length) {
        setFlashcards(result.tutorMessage.flashcards);
      }
      if (result.xpAwarded) {
        setXpToast(result.xpAwarded);
        window.setTimeout(() => setXpToast(null), 3500);
      }
      void loadSessionBoard(sessionId ?? "").then(() => {
        const ops = useWhiteboardStore.getState().ops;
        const fresh = ops.filter((op) => !knownOpIdsRef.current.has(op.id));
        revealChalkOps(fresh);
      });
    },
    [speakTutor, showEncouragement, applySession, absorbStats, loadSessionBoard, sessionId, revealChalkOps],
  );

  /**
   * The quiet check-in (user spec): armed ONLY while the tutor is waiting on
   * the student — never while generating, speaking, recapping, or when the
   * lesson is over. Any meaningful student interaction (typing, speaking,
   * sending, answering a quiz, touching the board) restarts the countdown
   * and resets the escalation ladder. Unanswered nudges climb the ladder
   * (space → hint offer → smaller-sub-step offer) with a doubled wait each
   * time — patient, never nagging.
   */
  useEffect(() => {
    const timer = inactivityTimerRef.current;
    if (!timer) return;
    const lessonLive = started || greetingDelivered; // fresh greeting OR reopened lesson
    // Smart quiet-detection (user spec): the pen moving on the board or the
    // handwriting modal being open IS engagement — the timer pauses entirely
    // (it re-arms fresh when the drawing stops, so no nudge fires mid-stroke).
    const waitingOnStudent =
      lessonLive &&
      !thinking &&
      !tutorSpeaking &&
      !recapping &&
      !ritualDone &&
      !uploading &&
      !drawingOnBoard &&
      handwriting === null;
    if (!waitingOnStudent || nudgeTimeoutSeconds <= 0) {
      timer.cancel();
      quietSinceRef.current = null;
      return;
    }
    // The quiet clock starts when the tutor first starts waiting (and is NOT
    // restarted by nudges — quietSeconds measures the student's silence).
    quietSinceRef.current ??= Date.now();
    // Escalation ladder (user spec: distinguish thinking from stuck): after a
    // nudge goes unanswered the tutor checks in AGAIN — slower each time
    // (double the window, capped) — with a climbing ladder: space → hint
    // offer → smaller-sub-step offer. A human tutor doesn't nag on a fixed
    // clock; they wait longer before each next gentle check.
    const waitSeconds = Math.min(nudgeTimeoutSeconds * 2 ** unansweredNudges, 600);
    timer.arm(waitSeconds, () => {
      // Escalation reads the PRE-fire count: nudge 1 = space, 2 = hint offer,
      // 3+ = smaller-sub-step offer. Side effects stay OUT of the state
      // updater (StrictMode double-invokes updaters; they must stay pure).
      const text = pickNudge(nudgeContextRef.current, unansweredNudges);
      setUnansweredNudges(unansweredNudges + 1);
      setNudge(text);
      setNudgeFired(true);
      // A human tutor says it out loud, naturally — same speech layer as a
      // real turn (speech sets tutorSpeaking, which also unarms the timer).
      setCaption(text);
      speakTutor(text);
      // Engagement tracking (parent view): record the quiet spell — how long
      // the student had been silent and how far up the ladder this reached.
      const quietSeconds = quietSinceRef.current
        ? Math.round((Date.now() - quietSinceRef.current) / 1000)
        : undefined;
      lastNudgeAtRef.current = Date.now();
      void api
        .recordEngagement({
          sessionId: sessionId ?? "",
          kind: "nudge_fired",
          rung: unansweredNudges + 1,
          quietSeconds,
          subject: session?.subject ?? undefined,
          profileId: session?.profileId ?? undefined,
        })
        .catch(() => undefined); // telemetry must never disturb the lesson
    });
    return () => timer.cancel();
  }, [started, greetingDelivered, thinking, tutorSpeaking, recapping, ritualDone, uploading, drawingOnBoard, handwriting, nudgeTimeoutSeconds, unansweredNudges, interactionTick, speakTutor]);

  /** Any student interaction clears the nudge and restarts the countdown. */
  /**
   * Warm re-entry (user spec): set when the student returns after a nudge,
   * consumed by the NEXT sendTurn so the tutor opens with a one-breath recap
   * of the last board step. Cleared after one turn (or after 10 idle minutes
   * — a re-entry hint hours later would be stale and confusing).
   */
  const returnedAfterAbsenceRef = useRef(false);
  useEffect(() => {
    if (unansweredNudges > 0) returnedAfterAbsenceRef.current = true;
  }, [unansweredNudges]);
  useEffect(() => {
    if (!returnedAfterAbsenceRef.current) return;
    const t = window.setTimeout(() => {
      returnedAfterAbsenceRef.current = false;
    }, 600_000);
    return () => window.clearTimeout(t);
  }, [unansweredNudges]);

  const noteStudentInteraction = useCallback(
    (resumedVia?: "typed" | "spoke" | "tapped") => {
      // Engagement tracking (parent view): if a nudge was outstanding, the
      // student just came back — record the resume with the full quiet gap.
      if (unansweredNudges > 0 && sessionId) {
        const quietSeconds = quietSinceRef.current
          ? Math.round((Date.now() - quietSinceRef.current) / 1000)
          : undefined;
        void api
          .recordEngagement({
            sessionId,
            kind: "resumed",
            quietSeconds,
            resumedVia: resumedVia ?? "tapped",
            subject: session?.subject ?? undefined,
            profileId: session?.profileId ?? undefined,
          })
          .catch(() => undefined);
      }
      setNudge(null);
      setNudgeFired(false);
      setUnansweredNudges(0); // the student is back — the ladder resets
      quietSinceRef.current = null;
      lastNudgeAtRef.current = null;
      // returnedAfterAbsenceRef intentionally NOT cleared here: the flag is
      // consumed by the next sendTurn (the actual re-entry message).
      setInteractionTick((t) => t + 1);
    },
    [unansweredNudges, sessionId, session?.subject, session?.profileId],
  );

  const handleTurnComplete = useCallback(async () => {
    noteStudentInteraction();
    const all = await refreshMessages();
    const last = [...all].reverse().find((e) => e.message.role === "tutor");
    if (last) {
      setCaption(last.message.content);
      speakTutor(last.message.content);
      showEncouragement(last.message);
    }
    const freshSession = await api.getSession(sessionId ?? "").catch(() => undefined);
    applySession(freshSession);
    api.getStats().then((s) => absorbStats(s)).catch(() => undefined);
    void loadSessionBoard(sessionId ?? "").then(() => {
      const ops = useWhiteboardStore.getState().ops;
      const fresh = ops.filter((op) => !knownOpIdsRef.current.has(op.id));
      revealChalkOps(fresh);
    });
  }, [refreshMessages, speakTutor, showEncouragement, absorbStats, loadSessionBoard, sessionId, revealChalkOps, applySession, noteStudentInteraction]);

  /**
   * End-of-lesson ritual choreography (ADR-0009, user spec): the tutor ERASES
   * the board, CHALKS a compact recap card (staggered, like real writing),
   * SPEAKS the sign-off, and only then reveals the download CTA. Runs both
   * for the drawer/CTA entry AND for the conversational finish — the student
   * simply saying they're done (backend routes that turn to recapLesson).
   */
  const runRitual = useCallback(
    async (result: {
      tutorMessage: Message;
      whiteboardOps: WhiteboardOperation[];
      session?: Session;
      stats?: StudyStats;
      newBadges?: string[];
    }) => {
      setRecapping(true);
      try {
        // Deliberately NOT absorbTurn() here — its board reload would insta-
        // apply every ritual op in one commit and kill the choreography.
        // 1) ERASE — clear_region applied to the editor immediately.
        const eraseOp = result.whiteboardOps.find((op) => op.type === "clear_region");
        if (eraseOp) {
          const editor = (window as unknown as { __chalkEditor?: import("tldraw").Editor }).__chalkEditor;
          if (editor) {
            applyOpToEditor(editor, eraseOp, {
              width: window.innerWidth,
              height: window.innerHeight,
            });
          }
          knownOpIdsRef.current.add(eraseOp.id);
        }
        // 2) CHALK — recap ops land one per beat, like real sequential writing.
        const chalkOps = result.whiteboardOps.filter(
          (op) => op.type !== "clear_region" && !knownOpIdsRef.current.has(op.id),
        );
        runChalkSequence(
          scheduleChalkOps(chalkOps, CHALK_STEP_MS),
          (op) => {
            knownOpIdsRef.current.add(op.id);
            appendServerOps([op]);
          },
        );
        // 3) SPEAK — caption + TTS carry the streamed recap sign-off.
        setCaption(result.tutorMessage.content);
        speakTutor(result.tutorMessage.content);
        applySession(result.session);
        absorbStats(result.stats, result.newBadges);
        // 4) REVEAL the download CTA once the chalk finishes landing.
        const waitMs = chalkOps.length * CHALK_STEP_MS + 600;
        window.setTimeout(() => {
          setRitualDone(true);
          setRecapping(false);
        }, waitMs);
      } catch (err) {
        setUploadNote(err instanceof Error ? err.message : "Could not finish the lesson.");
        setRecapping(false);
      }
    },
    [appendServerOps, speakTutor, applySession, absorbStats],
  );

  const sendTurn = useCallback(
    async (content: string, forceDirectAnswer = false) => {
      if (!sessionId || thinking) return;
      // Warm re-entry (user spec): if the student is returning after a nudge,
      // tell the tutor so it OPENS with a recap of the last board step. The
      // flag is consumed by this one turn (recap on the re-entry only).
      const returnedAfterAbsence = returnedAfterAbsenceRef.current;
      returnedAfterAbsenceRef.current = false;
      noteStudentInteraction("typed");
      setThinking(true);
      beginLiveSpeech();
      try {
        const result = await streamMessage(
          sessionId,
          { content, inputType: "voice", forceDirectAnswer, returnedAfterAbsence },
          { onDelta: speakStreamDelta },
        );
        endLiveSpeech();
        await refreshMessages();
        // Conversational finish: the backend detected "I'm done / let's wrap
        // up" and ran the end-of-lesson ritual — play its choreography
        // (erase → chalk → speak → download CTA) instead of a normal turn.
        if (
          result.tutorMessage.responseType === "summary" &&
          result.session?.status === "completed"
        ) {
          await runRitual(result);
          return;
        }
        absorbTurn({ ...result, spokenLive: true });    } finally {
      endLiveSpeech();
      setThinking(false);
    }
  }, [
    sessionId,
    thinking,
    handleTurnComplete,
    refreshMessages,
    absorbTurn,
    runRitual,
    beginLiveSpeech,
    speakStreamDelta,
    endLiveSpeech,
    noteStudentInteraction,
  ]);
  ;

  /** Greeting-first opening: tutor says hello and asks what we're learning. */
  const openLesson = useCallback(async () => {
    if (!sessionId) return;
    setThinking(true);
    try {
      const result = await streamLessonOpener(sessionId, { onDelta: speakStreamDelta });
      endLiveSpeech();
      await refreshMessages();
      absorbTurn({ ...result, spokenLive: true });
    } catch {
      // Non-fatal: the student can still type/talk; the drawer shows history.
    } finally {
      endLiveSpeech();
      setThinking(false);
      setGreetingDelivered(true);
    }
  }, [sessionId, refreshMessages, absorbTurn, beginLiveSpeech, speakStreamDelta, endLiveSpeech]);

  /** Drawer / CTA entry: explicitly ask the tutor to wrap up the lesson. */
  const finishLesson = useCallback(async () => {
    if (!sessionId || recapping || ritualDone) return;
    setRecapping(true);
    try {
      const result = await streamRecap(sessionId, { onDelta: () => undefined });
      await refreshMessages();
      setRecapping(false);
      await runRitual(result);
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : "Could not finish the lesson.");
      setRecapping(false);
    }
  }, [sessionId, recapping, ritualDone, refreshMessages, runRitual]);

  const voice = useVoiceConversation({
    onCommit: (text) => {
      // A spoken answer is the strongest engagement signal there is.
      noteStudentInteraction("spoke");
      void sendTurn(text);
    },
    tutorSpeaking,
    // Multilingual roadmap: the mic listens in the lesson's language.
    language: sttLangTag(lessonLanguage),
    // Live conversation (user spec): talking over the tutor interrupts it
    // mid-sentence — the student never waits for permission to speak.
    onBargeIn: stopSpeaking,
    // Interim speech also restarts the quiet countdown (they're mid-answer).
    onInterim: () => noteStudentInteraction("spoke"),
  });

  // The load effect fires before openLesson is defined; bind it late.
  greetingRef.current = openLesson;

  const onMicClick = useCallback(() => {
    // Pressing the mic is a meaningful interaction by definition.
    noteStudentInteraction("spoke");
    if (voice.phase === "listening" || voice.phase === "thinking") {
      voice.stopListening();
    } else if (voice.phase === "speaking") {
      stopSpeaking();
    } else {
      voice.startListening();
    }
  }, [voice, stopSpeaking, noteStudentInteraction]);

  const clearBoard = useCallback(async () => {
    if (!sessionId) return;
    await fetch(`/api/sessions/${sessionId}/whiteboard`, { method: "DELETE" });
    useWhiteboardStore.getState().reset();
    knownOpIdsRef.current.clear();
    useWhiteboardStore.setState((state) => ({ ops: [...state.ops] }));
  }, [sessionId]);

  /** Upload a photo or PDF of study material at ANY time (ADR-0006). */
  const uploadDocumentData = useCallback(
    async (dataUrl: string, isPdf: boolean) => {
      if (!sessionId) return;
      setUploading(true);
      setUploadNote(null);
      try {
        const result = await api.uploadDocument(sessionId, dataUrl);
        setMaterial(result.text);
        setUploadNote(
          isPdf
            ? "PDF read — material added. Ask me anything about it!"
            : "Photo read — material added. Ask me anything about it!",
        );
        window.setTimeout(() => setUploadNote(null), 6000);
        // Let the tutor acknowledge the new material conversationally.
        void sendTurn(
          isPdf
            ? "I uploaded a PDF; please read it and teach me from it."
            : "I uploaded a photo of my material; please read it and teach me from it.",
        );
      } catch (err) {
        setUploadNote(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [sessionId, sendTurn],
  );

  const uploadDocument = useCallback(
    async (file: File) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
      });
      await uploadDocumentData(dataUrl, file.type === "application/pdf");
    },
    [uploadDocumentData],
  );

  // First-input handoff from the welcome board: bind the runners late (both
  // callbacks are defined by now) so the load effect can fire them.
  handoffRunnersRef.current = {
    sendText: (text) => void sendTurn(text),
    sendUpload: (upload) => {
      setUploadNote(`Reading ${upload.name}…`);
      void uploadDocumentData(upload.dataUrl, upload.name.toLowerCase().endsWith(".pdf"));
    },
  };

  /** Download the complete solved lesson as a PDF (user spec: PDF, not md). */
  const downloadLesson = useCallback(() => {
    if (!sessionId) return;
    window.location.href = `/api/sessions/${sessionId}/export.pdf`;
  }, [sessionId]);

  // Mic interaction (user spec §4): pressing the mic must NOT swap the UI —
  // the student stays in the exact same learning context. Listening shows as
  // a calm amber ring on the SAME orb; the speech bubble keeps showing the
  // tutor's last line and shows the interim transcript as a gentle prefix
  // ("listening · …") instead of replacing it.
  const micOrbCompact =
    voice.supported ? (
      <button
        type="button"
        aria-label={voice.phase === "listening" ? "Stop listening" : "Start voice"}
        aria-pressed={voice.phase === "listening"}
        onClick={onMicClick}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg shadow [touch-action:manipulation] transition-shadow ${
          voice.phase === "listening"
            ? "mic-live bg-[#f6c453] text-[#33302a]"
            : "bg-[#e3dccb] text-[#3f3a30]"
        }`}
      >
        <span aria-hidden="true">🎙</span>
      </button>
    ) : (
      <button
        type="button"
        aria-label="Voice input is not available in this browser; use the type bar"
        title="Voice input needs Chrome or Edge (Web Speech API). Tap to dismiss."
        onClick={onMicClick}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e3dccb] text-lg text-[#3c3a33] [touch-action:manipulation]"
      >
        <span aria-hidden="true">🎙</span>
      </button>
    );

  if (loadError) {
    return (
      <div className="p-6">
        <Banner tone="error">
          {loadError} — <Link to="/" className="underline">start a new session</Link>
        </Banner>
      </div>
    );
  }
  if (!session || !sessionId) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft">
        <Spinner /> Loading session…
      </div>
    );
  }

  const level = Math.floor((stats?.totalXp ?? session.xp) / 50) + 1;
  const xpIntoLevel = (stats?.totalXp ?? session.xp) % 50;
  const quizPct = session.quizScore[1] > 0 ? Math.round((session.quizScore[0] / session.quizScore[1]) * 100) : null;

  return (
    <div className="mockup-shell relative flex h-full min-h-0 flex-col">
      {/* Header: title · level/XP · New session (mockup top bar). */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="mockup-title whitespace-nowrap">AI Teacher</span>
          <span className="min-w-0 flex-1 truncate text-sm text-[#cfc6b8]">
            Socratic voice &amp; chalkboard tutor
            {session.currentGoal ? ` · ${session.currentGoal}` : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* XP / level / streak pill (gamification, ADR-0006). */}
          <div
            className="relative flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200"
            title={"Quiz score: ".concat(String(session.quizScore[0]), " of ", String(session.quizScore[1]))}
          >
            <span aria-hidden>⚡</span>
            <span className="font-semibold">Lv {level}</span>
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-black/40">
              <span
                className="block h-full rounded-full bg-amber-300"
                style={{ width: `${(xpIntoLevel / 50) * 100}%` }}
              />
            </span>
            <span className="tabular-nums">{session.xp} XP</span>
            {quizPct !== null && <span aria-hidden>· 🎯 {quizPct}%</span>}
            {(stats?.dailyStreak ?? 0) > 0 && (
              <span aria-hidden title={`${stats?.dailyStreak ?? 0}-day study streak`}>· 🔥 {stats?.dailyStreak}</span>
            )}
            {(stats?.badges.length ?? 0) > 0 && (
              <span
                aria-hidden
                title={(stats?.badges ?? []).map((b) => BADGES.find((x) => x.id === b)?.label ?? b).join(", ")}
              >
                · {stats?.badges.slice(-3).map((b) => BADGES.find((x) => x.id === b)?.icon ?? "🏅").join("")}
              </span>
            )}
            {xpToast !== null && (
              <span className="xp-toast absolute -top-8 right-0 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-black">
                +{xpToast} XP
              </span>
            )}
            {levelUp !== null && (
              <span className="level-up absolute -top-10 right-0 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1 text-sm font-extrabold text-black shadow-lg">
                ✨ LEVEL {levelUp}!
              </span>
            )}
            {badgeToast && (
              <span className="badge-toast absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl border border-amber-300/60 bg-[#2b2924] px-3 py-1 text-xs font-bold text-amber-200 shadow-lg">
                {badgeToast}
              </span>
            )}
          </div>
          {/* New session exit (self-improving personalization, spec §1):
              leaving a real lesson offers the optional feedback prompt first —
              Skip goes straight to the welcome board. */}
          {hasRealLesson ? (
            <button
              type="button"
              data-testid="new-session-btn"
              className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-[#f0ead9] hover:bg-white/10"
              onClick={() => setExitFeedbackOpen(true)}
            >
              ＋ New session
            </button>
          ) : (
            <Link
              to="/"
              className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-[#f0ead9] hover:bg-white/10"
            >
              ＋ New session
            </Link>
          )}
          <Link
            to="/history"
            className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-[#f0ead9] hover:bg-white/10"
          >
            My learning
          </Link>
          <button
            type="button"
            className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[#f0ead9] hover:bg-white/10"
            onClick={() => setDrawerOpen(true)}
          >
            Transcript
          </button>
        </div>
      </header>

      {/* Framed chalkboard. */}
      <div className="chalk-frame mx-5 min-h-0 flex-1">
        <div
          className="board-green relative h-full min-h-0"
          // Board contact (drawing, panning, zooming) is engagement too —
          // capture-phase so every child tool sees it first.
          onPointerDownCapture={() => noteStudentInteraction("tapped")}
        >
          <WhiteboardPanel sessionId={sessionId} onDrawingChange={setDrawingOnBoard} />

          {/* Sticky encouragement note — only on a hint or a correct answer. */}
          {note && (
            <div
              data-testid="encouragement-note"
              className="sticky-note pointer-events-none absolute right-4 top-24 z-30 max-w-[180px] px-3 py-2"
            >
              <p className="text-xs font-bold">{note.title}</p>
              <p className="mt-1 text-[11px] leading-snug">{note.body}</p>
            </div>
          )}

          {/* Subject pill → lesson controls (mockup top-right). Subject,
              grade level, and help style are the explicit knobs from the old
              setup form, now opt-in: they PATCH the live session and shape
              the tutor's next turn. */}
          <div className="absolute right-3 top-3 z-20">
            <LessonControlPopover
              subject={session.subject}
              gradeLevel={session.gradeLevel}
              helpLevel={session.helpLevel}
              disabled={thinking}
              persona={tutorPersona}
              voice={tutorVoicePref}
              language={lessonLanguage}
              // Board pill edits THIS lesson (per-session memory, roadmap):
              // persona/voice/language patch the session row and are restored
              // verbatim next time the student reopens it.
              updateSettings={(patch) => {
                applySession({ ...session, ...patch });
                void api
                  .updateSession(sessionId, patch)
                  .then(applySession)
                  .catch(() => setUploadNote("Could not save the lesson settings."));
              }}
              onChange={(patch) => {
                // Optimistic: the pill reflects the choice instantly.
                applySession({ ...session, ...patch });
                void api
                  .updateSession(sessionId, patch)
                  .then(applySession)
                  .catch(() => setUploadNote("Could not save the lesson settings."));
              }}
            />
          </div>

          {/* Upload notice. */}
          {uploadNote && (
            <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border border-white/15 bg-black/45 px-3 py-1.5 text-xs text-[#f0ead9] backdrop-blur-sm">
              {uploadNote}
            </div>
          )}

          {/* First-run material overlay ONLY when the student has something to
              confirm (uploaded file / typed topic). A fresh session stays on
              the open board so the greeting conversation can start (ADR-0006). */}
          {!started && material && !greetingDelivered && (
            <ProblemSetupOverlay
              session={session}
              onConfirmed={() => {
                setStarted(true);
                void api.getSession(sessionId).then(setSession);
                void openLesson();
              }}
            />
          )}

          {/* Ritual completion CTA (ADR-0009): download appears ONLY after
              the erase → recap-chalk → spoken sign-off choreography. */}
          {ritualDone && (
            <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
              <a
                href={`/api/sessions/${sessionId}/export.pdf`}
                data-testid="ritual-download"
                className="flex items-center gap-2 rounded-full border border-amber-300/50 bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-200 shadow-lg backdrop-blur-sm transition-colors hover:bg-amber-400/30 [touch-action:manipulation]"
              >
                <span aria-hidden>⬇️</span> Download your solved lesson
              </a>
            </div>
          )}

          {/* Live quiz card (user spec: quizzes can be multiple-choice or
              spoken). Buttons for choices; the mic stays open for open ones.
              dir=auto: RTL quiz text renders correctly (RTL roadmap). */}
          {activeQuiz && !ritualDone && (
            <div
              data-testid="quiz-card"
              role="group"
              aria-label="Quiz question"
              dir="auto"
              className="absolute inset-x-4 bottom-[76px] z-30 mx-auto max-w-2xl rounded-2xl border border-amber-300/40 bg-[#2b2924]/95 p-3 shadow-xl"
            >
              <p className="mb-2 flex items-start gap-2 text-sm font-semibold text-[#f6e9c8]">
                <span aria-hidden>🎯</span>
                <span>{activeQuiz.question}</span>
              </p>
              {activeQuiz.choices?.length ? (
                <div className="flex flex-wrap gap-2">
                  {activeQuiz.choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      disabled={thinking}
                      onClick={() => {
                        noteStudentInteraction("tapped");
                        setActiveQuiz(null);
                        void sendTurn(choice);
                      }}
                      className="rounded-full border border-amber-300/40 bg-amber-400/10 px-3.5 py-2 text-sm font-semibold text-[#ffe9b0] transition-colors hover:bg-amber-400/25 disabled:opacity-50 [touch-action:manipulation]"
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-chalk/70">
                  Speak or type your answer — or say “I don’t know” for a hint.
                </p>
              )}
            </div>
          )}

          {/* Answer bar: conversational — ask anything at any time. */}
          {(started || greetingDelivered) && (
            <div className="absolute inset-x-4 bottom-3 z-20">
            <div className="answer-bar flex items-center gap-2 px-2 py-2">
              {micOrbCompact}
              <input
                className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-chalk outline-none"
                placeholder="Ask anything — or answer the tutor…"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  // Typing IS engagement: restart the quiet countdown, and
                  // drop the check-in bubble the moment the student acts.
                  noteStudentInteraction("typed");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && typed.trim()) {
                    void sendTurn(typed);
                    setTyped("");
                  }
                }}
              />
              <button
                type="button"
                aria-label="Send answer"
                disabled={thinking || typed.trim().length === 0}
                onClick={() => {
                  void sendTurn(typed);
                  setTyped("");
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f6c453] text-lg text-[#33302a] shadow disabled:opacity-50"
              >
                ➤
              </button>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Action orb row (mockup): Voice · Type · Upload · Hint · Explain · Check · Cards · Save · Clear.
          shrink-0: on short viewports the board shrinks instead of clipping the orbs/labels. */}
      <div className="flex shrink-0 flex-wrap items-start justify-center gap-3 px-5 py-3 sm:gap-5">
        <Orb label="Voice" icon="🎙" active={voice.phase === "listening"} onClick={onMicClick} />
        <Orb
          label="Type"
          icon="⌨"
          onClick={() => {
            setDrawerOpen(true);
            window.setTimeout(() => {
              document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
            }, 350);
          }}
        />
        <Orb
          label="Upload"
          icon="📎"
          disabled={uploading || thinking}
          onClick={() => {
            noteStudentInteraction("tapped");
            uploadInputRef.current?.click();
          }}
        />
        <Orb
          label="Hint"
          icon="💡"
          disabled={thinking || (!started && !greetingDelivered)}
          onClick={() => void sendTurn("I'm stuck — give me a hint, please.")}
        />
        <Orb
          label="Explain"
          icon="💬"
          disabled={thinking || (!started && !greetingDelivered)}
          onClick={() => void sendTurn("Explain this completely so I really understand it.")}
        />
        <Orb
          label="Quiz"
          icon="✅"
          disabled={thinking || (!started && !greetingDelivered)}
          onClick={() => void sendTurn("Quiz me on what we just covered.")}
        />
        <Orb
          label="Cards"
          icon="🃏"
          disabled={thinking || (!started && !greetingDelivered)}
          onClick={() => void sendTurn("Please make me flashcards from this lesson.")}
        />
        <Orb
          label="Write"
          icon="✍️"
          disabled={thinking}
          onClick={() =>
            setHandwriting(
              activeQuiz?.question ??
              session?.extractedProblem?.slice(0, 150) ??
              "",
            )
          }
        />
        <Orb label="Save" icon="⬇️" onClick={downloadLesson} />
        <Orb label="Clear" icon="🧽" onClick={() => void clearBoard()} />
      </div>

      {/* Hidden file input: images + PDFs. */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadDocument(file);
          e.target.value = "";
        }}
      />

      {/* Tutor speech bubble (mockup bottom bar). Voice errors surface here —
          same place the student is already looking. */}
      <div className="shrink-0 px-5 pb-4">
        {/* dir=auto (RTL roadmap): Arabic/Hebrew captions align correctly
            without flipping the whole UI for LTR lessons. */}
        <div className="speech-bubble mx-auto max-w-4xl px-4 py-2.5 text-sm" data-testid="speech-bubble" dir="auto">
          <span className="mr-1">✨</span>
          {voice.error ? (
            <span data-testid="voice-fallback" className="text-chalk-pink">
              {voice.error}
            </span>
          ) : voice.interim ? (
            // Listening caption (user spec §4): the tutor's last line STAYS,
            // the live transcript joins it as a quiet prefix — the context
            // never disappears while the student talks.
            <span>
              <span className="text-chalk-dim">{caption ? `${caption}  ·  ` : "listening · "}</span>
              <span className="text-chalk">{voice.interim}</span>
            </span>
          ) : (
            caption ??
            (thinking ? "The tutor is thinking…" : "Say hello and tell me what we're learning today!")
          )}
        </div>
      </div>

      <TranscriptDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sessionId={sessionId}
        entries={entries}
        onTurnComplete={() => {
          void handleTurnComplete();
        }}
        onStudentOps={() => undefined}
        pendingVoiceText={null}
        onVoiceTextConsumed={() => undefined}
        onFinishLesson={() => {
          setDrawerOpen(false);
          void finishLesson();
        }}
        finishing={recapping}
      />

      <FlashcardsModal cards={flashcards} onClose={() => setFlashcards(null)} />
      {/* Optional exit feedback (self-improving personalization, spec §1, §6):
          a small modal, always skippable, shown when the student leaves a real
          lesson via ＋ New session. */}
      {exitFeedbackOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Session feedback"
          onClick={(e) => {
            if (e.target === e.currentTarget) navigate("/");
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#2b2924] p-4 shadow-2xl">
            <FeedbackPrompt
              sessionId={sessionId ?? ""}
              onDismiss={() => navigate("/")}
              onDone={() => {
                // Brief moment to read the confirmation, then move on.
                window.setTimeout(() => navigate("/"), 2600);
              }}
            />
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mt-3 w-full rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-[#cfc6b8] hover:bg-white/5"
            >
              Go to the welcome board
            </button>
          </div>
        </div>
      )}
      {handwriting !== null && (
        <HandwritingModal
          sessionId={sessionId ?? ""}
          initialPrompt={handwriting}
          onClose={() => setHandwriting(null)}
        />
      )}
    </div>
  );
}

function Orb({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="orb">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={`orb-button ${active ? (label === "Voice" ? "mic-active" : "active") : ""} ${disabled ? "opacity-50" : ""}`}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
      <span className="orb-label" aria-hidden="true">{label}</span>
    </div>
  );
}
