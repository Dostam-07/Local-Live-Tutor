/**
 * Flashcards modal (ADR-0006 + ADR-0007): flip-through cards generated from
 * the lesson, now voice-driven — tap the mic, say your answer out loud, then
 * self-mark the card. Mastered cards sync to /api/stats/mastered so progress
 * survives sessions and feeds the badges (Card Shark 🃏).
 *
 * - Click/space to flip, arrows to navigate.
 * - 🎙 Speak it: one-shot speech recognition prefills your spoken answer.
 * - "I knew it" marks the card mastered; both buttons advance.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Flashcard } from "@local-live-tutor/shared";

import { api } from "../../lib/api";

type CardState = Flashcard & { mastered: boolean };

export function FlashcardsModal({
  cards,
  onClose,
}: {
  cards: Flashcard[] | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [spoken, setSpoken] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [masteredFronts, setMasteredFronts] = useState<Set<string>>(new Set());
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const deck: CardState[] = (cards ?? []).map((c) => ({
    ...c,
    mastered: masteredFronts.has(c.front),
  }));

  const syncMastered = useCallback((fronts: string[]) => {
    if (fronts.length === 0) return;
    api.markMastered(fronts).catch(() => undefined);
  }, []);

  /** Spaced repetition (roadmap): self-marks move the review schedule. */
  const scheduleReview = useCallback((front: string, grade: 0 | 1 | 2 | 3) => {
    api.srsGrade(front, grade).catch(() => undefined);
  }, []);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    setSpoken(null);
    setMasteredFronts(new Set());
  }, [cards]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setVoiceNote("Voice isn't available in this browser — flip the card and type or think your answer.");
      window.setTimeout(() => setVoiceNote(null), 5000);
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event: any) => {
        let text = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          text += event.results[i][0].transcript;
        }
        setSpoken(text.trim());
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => setListening(false);
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  useEffect(() => {
    if (!cards) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stopListening();
        onClose();
      }
      if (event.key === " ") {
        event.preventDefault();
        setFlipped((f) => !f);
      }
      if (event.key === "ArrowRight") {
        setIndex((i) => Math.min(i + 1, cards.length - 1));
        setFlipped(false);
        setSpoken(null);
      }
      if (event.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
        setFlipped(false);
        setSpoken(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cards, onClose, stopListening]);

  useEffect(() => () => stopListening(), [stopListening]);

  if (!cards || cards.length === 0) return null;
  const card = deck[index];
  if (!card) return null;

  const markKnown = () => {
    if (!masteredFronts.has(card.front)) {
      setMasteredFronts((prev) => new Set(prev).add(card.front));
      syncMastered([card.front]);
    }
    // Knew it → interval grows (grade 2 "good"); the card returns later.
    scheduleReview(card.front, 2);
    if (index < deck.length - 1) {
      setIndex(index + 1);
      setFlipped(false);
      setSpoken(null);
    } else {
      setFlipped(true); // stay on the last card; celebration shows below
    }
  };

  const markUnsure = () => {
    // Show me again → back to learning (grade 0 "forgot"); due next lesson.
    scheduleReview(card.front, 0);
    if (index < deck.length - 1) {
      setIndex(index + 1);
      setFlipped(false);
      setSpoken(null);
    } else {
      setFlipped(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Flashcards"
      onClick={() => {
        stopListening();
        onClose();
      }}
    >
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {/* Explicit close (user spec): every floating surface needs one. */}
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            aria-label="Close flashcards"
            onClick={() => {
              stopListening();
              onClose();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm text-chalk hover:bg-white/15 [touch-action:manipulation]"
          >
            ✕
          </button>
        </div>
        <div
          className="flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-white/15 bg-board-deep p-6 text-center shadow-panel transition-transform"
          onClick={() => setFlipped((f) => !f)}
          role="button"
          aria-label={flipped ? "Show question" : "Reveal answer"}
        >
          {flipped ? (
            <>
              <p className="text-xs uppercase tracking-wide text-chalk-dim">Answer</p>
              <p className="chalk-font chalk-text text-lg">{card.back}</p>
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-chalk-dim">
                Card {index + 1} of {deck.length}
                {card.mastered ? " · ✅ mastered" : ""} — click to flip
              </p>
              <p className="chalk-font chalk-text text-lg">{card.front}</p>
            </>
          )}
        </div>

        {/* Voice answer strip (ADR-0007): speak it, then self-mark. */}
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 ${listening ? "border-red-400 bg-red-500/20 text-red-200 mic-active" : "border-white/15 text-[#f0ead9]"}`}
            onClick={() => (listening ? stopListening() : startListening())}
            title="Say your answer out loud"
          >
            {listening ? "🎙 Listening…" : "🎙 Speak it"}
          </button>
          {spoken && <span className="max-w-52 truncate text-chalk-dim">“{spoken}”</span>}
        </div>
        {voiceNote && (
          <p data-testid="cards-voice-fallback" className="mt-2 text-center text-xs text-chalk-pink">
            {voiceNote}
          </p>
        )}

        {flipped && (
          <div className="mt-3 flex items-center justify-center gap-2 text-sm">
            <button
              type="button"
              className="rounded-full bg-emerald-500/20 px-4 py-1.5 font-semibold text-emerald-200"
              onClick={markKnown}
            >
              ✅ I knew it
            </button>
            <button
              type="button"
              className="rounded-full border border-white/15 px-4 py-1.5 text-[#f0ead9]"
              onClick={markUnsure}
            >
              🔄 Show me again
            </button>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-sm">
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1.5 text-[#f0ead9] disabled:opacity-40"
            disabled={index === 0}
            onClick={() => {
              setIndex((i) => Math.max(i - 1, 0));
              setFlipped(false);
              setSpoken(null);
            }}
          >
            ← Prev
          </button>
          <span className="text-chalk-dim">
            {masteredFronts.size > 0
              ? `✅ ${masteredFronts.size} mastered this round · `
              : ""}Space flips · arrows move
          </span>
          <button
            type="button"
            className="rounded-full border border-white/15 px-3 py-1.5 text-[#f0ead9] disabled:opacity-40"
            disabled={index === deck.length - 1}
            onClick={() => {
              setIndex((i) => Math.min(i + 1, deck.length - 1));
              setFlipped(false);
              setSpoken(null);
            }}
          >
            Next →
          </button>
        </div>
        {index === deck.length - 1 && flipped && (
          <p className="mt-3 text-center text-sm text-amber-300">
            🎉 Deck complete — {masteredFronts.size > 0 ? `${masteredFronts.size} mastered! ` : ""}Nice work! +5 XP
          </p>
        )}
      </div>
    </div>
  );
}
