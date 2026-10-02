/**
 * Push-to-talk (PRD §5.5): MediaRecorder, 60 s cap, visible indicator, cancel.
 * STT provider priority: browser Web Speech → manual fallback (typed text).
 * Styled for the chalkboard theme (ADR-0005).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function PushToTalkButton({ onTranscribed }: { onTranscribed: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const media = "MediaRecorder" in navigator && navigator.mediaDevices?.getUserMedia;
    setSupported(Boolean(media));
  }, []);

  const stopEverything = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    recognitionRef.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
      setRecording(true);

      // 60-second cap (PRD §5.5).
      timeoutRef.current = window.setTimeout(() => stopEverything(), 60_000);

      // Prefer browser speech recognition when available (PRD priority).
      const SpeechRecognitionCtor =
        (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = "en-US";
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onresult = (event: any) => {
          let text = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            text += event.results[i][0].transcript;
          }
          onTranscribed(text.trim());
        };
        recognition.onerror = () => setError("Speech recognition failed — type instead.");
        recognition.start();
        recognitionRef.current = recognition;
      }

      recorder.onstop = () => {
        stopEverything();
      };
    } catch {
      setError("Microphone unavailable — you can type your response instead.");
    }
  }, [onTranscribed, stopEverything]);

  if (!supported) {
    return (
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          aria-label="Voice input is unavailable in this browser"
          title="Voice input needs the Web Speech API (Chrome or Edge) and a microphone."
          onClick={() => {
            setShowUnavailable(true);
            window.setTimeout(() => setShowUnavailable(false), 5000);
          }}
          className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm text-chalk-dim"
        >
          🎤 ✕
        </button>
        {showUnavailable && (
          <span data-testid="ptt-fallback" className="max-w-44 text-center text-[10px] leading-snug text-chalk-pink">
            Voice needs Chrome or Edge — type below instead.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {recording ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={stopEverything}
            aria-label="Stop recording"
            className="mic-listening rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white"
          >
            ⏺ recording…
          </button>
          <button
            type="button"
            onClick={stopEverything}
            className="rounded-full px-2 py-2 text-xs text-chalk-dim hover:text-chalk"
          >
            cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          aria-label="Start recording"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm text-chalk hover:bg-white/10"
        >
          🎤
        </button>
      )}
      {error && <span className="text-[10px] text-chalk-pink">{error}</span>}
    </div>
  );
}
