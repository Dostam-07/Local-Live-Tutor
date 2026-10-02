/**
 * Live TTS queue (user spec: pengi-style live conversation). Speaks complete
 * sentences the moment they arrive from the streaming tutor instead of after
 * the whole JSON response. Also the single place that knows how to:
 * - chain utterances without gaps (the next sentence is queued while one speaks),
 * - barge-in: stop() cancels instantly so the student can interrupt mid-word,
 * - keep tutorSpeaking true across the WHOLE answer (echo control depends on
 *   it — the mic must not hear the tutor), not flicker per utterance.
 */
import type { LessonLanguage } from "@local-live-tutor/shared";
import { isRtlLanguage } from "@local-live-tutor/shared";
import type { TutorVoicePref } from "./tutorVoice";
import { resolveTutorVoice, sttLangTag } from "./lessonLanguage";
import { toSpeechChunks } from "./speechText";
import { speakViaPiper } from "./offlineVoice";

export class SpeechQueue {
  private items: string[] = [];
  private speaking = false;
  private stopped = false;
  private activeCount = 0;

  constructor(
    private readonly opts: {
      language: LessonLanguage;
      voicePref: TutorVoicePref;
      onSpeakingChange: (speaking: boolean) => void;
    },
  ) {}

  /** Enqueue more sentences; starts speaking immediately if idle. */
  enqueue(sentences: string[]): void {
    if (this.stopped || sentences.length === 0) return;
    // Speech representation layer (user spec §5–§7): every chunk goes through
    // toSpeechChunks → toSpeechText BEFORE the engine sees it — math symbols
    // become words IN THE LESSON LANGUAGE (Hindi → "बराबर"), markup/UI
    // labels/meta are dropped, and long sentences are split into breath-
    // groups. Raw board text never reaches TTS.
    const spoken = sentences.flatMap((s) => toSpeechChunks(s, 180, this.opts.language));
    this.items.push(...spoken);
    this.items = this.items.slice(-60); // hard cap; never a runaway queue
    if (!this.speaking) void this.drain();
  }

  /** Barge-in: cancel everything mid-word. Safe to call repeatedly. */
  stop(): void {
    this.stopped = true;
    this.items = [];
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (this.speaking || this.activeCount > 0) {
      this.speaking = false;
      this.activeCount = 0;
      this.opts.onSpeakingChange(false);
    }
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  private drain(): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const next = this.items.shift();
    if (next === undefined) {
      if (this.speaking) {
        this.speaking = false;
        this.opts.onSpeakingChange(false);
      }
      return;
    }
    if (!this.speaking) {
      this.speaking = true;
      this.opts.onSpeakingChange(true);
    }
    // Small inter-chunk pause: the natural "breath" between steps.
    const pauseMs = 220;
    // Offline-voice fallback (roadmap): no native browser voice for this
    // language → the local Piper server voices the chunk instead. Resolves
    // false when Piper can't serve it (not configured / no model / down) and
    // the browser path below runs exactly as before.
    const pinned = this.opts.language !== "auto" ? this.opts.language : undefined;
    if (pinned && !resolveTutorVoice(pinned, this.opts.voicePref)) {
      const chunk = next;
      void speakViaPiper(chunk, pinned, () => {
        this.activeCount -= 1;
        if (this.stopped) return;
        window.setTimeout(() => this.drain(), pauseMs);
      }).then((spoken) => {
        if (spoken) return; // Piper owns this chunk's lifecycle
        this.activeCount -= 1; // Piper declined → browser path below
        this.speakBrowser(this.makeBrowserUtterance(chunk));
      });
      this.activeCount += 1;
      return;
    }
    this.speakBrowser(this.makeBrowserUtterance(next));
  }

  /** Builds a calm, tutor-paced browser utterance (user spec §4–§6). */
  private makeBrowserUtterance(text: string): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.94;
    utterance.pitch = 1.02;
    // Language-first voice resolution (user bug: a pinned Hindi lesson spoke
    // with an English voice). No native voice installed → null → the utterance's
    // `lang` tag lets the OS pick/serve a native voice.
    const voice = resolveTutorVoice(this.opts.language, this.opts.voicePref);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = sttLangTag(this.opts.language);
    }
    return utterance;
  }

  /** Speaks one browser utterance and advances the queue when it ends. */
  private speakBrowser(utterance: SpeechSynthesisUtterance): void {
    const synth = window.speechSynthesis;
    const pauseMs = 220;
    this.activeCount += 1;
    const advance = () => {
      this.activeCount -= 1;
      if (this.stopped) return;
      window.setTimeout(() => this.drain(), pauseMs);
    };
    utterance.onend = advance;
    utterance.onerror = advance;
    synth.speak(utterance);
  }
}
