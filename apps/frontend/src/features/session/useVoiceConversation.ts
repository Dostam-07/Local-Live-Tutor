/**
 * Continuous voice conversation (ADR-0005, Pengi-style).
 *
 * State machine:
 *   idle ──start()──▶ listening ⇄ (silence ≥ COMMIT_DELAY_MS)──▶ thinking ──▶
 *   speaking (tutor TTS; recognition paused) ──▶ listening …
 *
 * - Live interim transcript surfaces as a caption while you talk.
 * - `committedText` fires once per finalized utterance; the workspace sends it.
 * - Recognition pauses while the tutor speaks so the tutor doesn't hear itself
 *   (echo control) and resumes automatically afterwards.
 * - Browsers without Web Speech can still type (the workspace drawer).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const COMMIT_DELAY_MS = 1200;

export type VoicePhase =
  | "unsupported"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceConversation(options: {
  onCommit: (text: string) => void;
  /** True while the tutor's TTS is playing — the mic must not commit then. */
  tutorSpeaking: boolean;
  /** BCP-47 tag to listen in (roadmap: multilingual lessons), e.g. "es-ES". */
  language?: string;
  /**
   * Barge-in (user spec: live conversation, pengi-style): speech detected
   * WHILE the tutor talks interrupts the tutor mid-word. The recognizer
   * actually STAYS armed during tutor speech (unlike the old pause-entirely
   * design) but only reacts once — firing this callback, which stops the TTS.
   */
  onBargeIn?: () => void;
  /**
   * Fires on every interim recognition update (inactivity nudge): the
   * student talking IS engagement, even before the utterance commits.
   */
  onInterim?: () => void;
}) {
  const { onCommit, tutorSpeaking, language, onBargeIn, onInterim } = options;
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListeningRef = useRef(false);
  const silenceTimerRef = useRef<number | null>(null);
  const interimRef = useRef("");
  const finalBufferRef = useRef("");
  /** When the recognizer armed during tutor speech (echo-grace window). */
  const bargeInArmedSinceRef = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);
  const tutorSpeakingRef = useRef(tutorSpeaking);
  const languageRef = useRef(language);
  const onBargeInRef = useRef(onBargeIn);
  const onInterimRef = useRef(onInterim);

  onCommitRef.current = onCommit;
  tutorSpeakingRef.current = tutorSpeaking;
  languageRef.current = language;
  onBargeInRef.current = onBargeIn;
  onInterimRef.current = onInterim;

  // Language switches (student changes the lesson language mid-lesson) apply
  // to the live recognizer immediately.
  useEffect(() => {
    if (recognitionRef.current && language) recognitionRef.current.lang = language;
  }, [language]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const setPhaseSafe = useCallback((next: VoicePhase) => {
    setPhase((current) => (current === "unsupported" || current === "muted" ? current : next));
  }, []);

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      const text = `${finalBufferRef.current} ${interimRef.current}`.trim();
      if (text.length > 0) {
        finalBufferRef.current = "";
        interimRef.current = "";
        setInterim("");
        setPhaseSafe("thinking");
        onCommitRef.current(text);
      }
      // No speech in the window: simply keep listening.
    }, COMMIT_DELAY_MS);
  }, [clearSilenceTimer, setPhaseSafe]);

  const startRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !wantListeningRef.current) return;
    try {
      recognition.start();
    } catch {
      // Already started — harmless.
    }
  }, []);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    clearSilenceTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    setPhase("idle");
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    const ctor = getRecognitionCtor();
    if (!ctor) {
      setPhase("unsupported");
      setError(
        "Voice input isn't available in this browser — it needs the Web Speech API (Chrome or Edge). You can type in the bar below; everything else works the same.",
      );
      return;
    }
    setError(null);
    wantListeningRef.current = true;

    if (!recognitionRef.current) {
      const recognition = new ctor();
      recognition.lang = languageRef.current ?? "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        // Barge-in: real speech (not the tutor's echo — the mic hears the
        // speaker, so require a minimum transcript length) interrupts the
        // tutor. One short grace window after speech starts filters the
        // echo tail of the tutor's own voice.
        if (tutorSpeakingRef.current) {
          let heard = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            heard += event.results[i]?.[0]?.transcript ?? "";
          }
          bargeInArmedSinceRef.current ??= Date.now();
          if (heard.trim().length >= 12 && Date.now() - bargeInArmedSinceRef.current > 700) {
            bargeInArmedSinceRef.current = null;
            onBargeInRef.current?.();
          }
          return;
        }
        bargeInArmedSinceRef.current = null;
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) continue;
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) {
            finalBufferRef.current = `${finalBufferRef.current} ${transcript}`.trim();
          } else {
            interimText += transcript;
          }
        }
        interimRef.current = interimText;
        setInterim(interimText);
        if (interimText.trim().length > 0) {
          // Mid-utterance speech counts as engagement (inactivity nudge).
          onInterimRef.current?.();
        }
        setPhaseSafe("listening");
        // Any new speech resets the silence clock; silence commits the turn.
        armSilenceTimer();
      };

      recognition.onend = () => {
        // Chrome ends the session periodically; restart while the user wants
        // continuous listening and the tutor is not speaking.
        if (wantListeningRef.current && !tutorSpeakingRef.current) {
          window.setTimeout(() => startRecognition(), 250);
        }
      };

      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        if (event.error === "not-allowed") {
          wantListeningRef.current = false;
          setPhase("muted");
          setError("Microphone blocked. Allow mic access, then press the mic again.");
          return;
        }
        setError("Voice recognition hiccup — still listening, or type instead.");
      };

      recognitionRef.current = recognition;
    }

    setPhaseSafe("listening");
    startRecognition();
  }, [armSilenceTimer, setPhaseSafe, startRecognition]);

  // Live conversation (user spec): the recognizer STAYS RUNNING while the
  // tutor speaks so the student can interrupt naturally (barge-in) instead of
  // waiting for the tutor to finish. Echo of the tutor's own voice is filtered
  // by the grace window + minimum length in onresult. The phase still shows
  // "speaking" so the UI reads correctly.
  useEffect(() => {
    if (tutorSpeaking) {
      clearSilenceTimer();
      setPhaseSafe("speaking");
      if (recognitionRef.current) {
        try {
          // start() throws when already running — that's fine; we only want
          // to guarantee it IS running.
          startRecognition();
        } catch {
          /* noop */
        }
      }
    } else if (wantListeningRef.current) {
      bargeInArmedSinceRef.current = null;
      setPhaseSafe("listening");
      startRecognition();
    }
  }, [tutorSpeaking, clearSilenceTimer, setPhaseSafe, startRecognition]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearSilenceTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* noop */
      }
    };
  }, [clearSilenceTimer]);

  return {
    phase,
    interim,
    error,
    startListening,
    stopListening,
    /** True when the browser cannot do speech recognition at all. */
    supported: typeof window !== "undefined" && getRecognitionCtor() !== null,
  };
}
