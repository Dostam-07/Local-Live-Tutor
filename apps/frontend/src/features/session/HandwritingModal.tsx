/**
 * Handwriting practice modal (roadmap: the student chalks the answer
 * themselves and the tutor grades the handwriting).
 *
 * Flow: the student gets a prompt (their quiz question or a custom one),
 * writes the answer on the chalkboard with the pen tool, then taps
 * "Check my writing". The board is captured as a PNG via the tldraw editor
 * (`__chalkEditor`, set by WhiteboardPanel) and graded by the tutor —
 * vision models read the actual handwriting; text-only models grade the
 * student's typed transcription. Feedback shows what the tutor read (the
 * student confirms the reading), a verdict, legibility, and next steps.
 */
import { useRef, useState } from "react";

import type { HandwritingFeedback } from "@local-live-tutor/shared";

import { api } from "../../lib/api";

declare global {
  interface Window {
    __chalkEditor?: {
      toImage: (
        shapes: string[],
        opts?: { format?: string; background?: string; scale?: number },
      ) => Promise<{ blob: Blob }>;
      getCurrentPageShapeIds: () => Set<string>;
    };
  }
}

const VERDICT_STYLE: Record<HandwritingFeedback["verdict"], { icon: string; cls: string }> = {
  correct: { icon: "✅", cls: "text-emerald-300" },
  partially_correct: { icon: "🟡", cls: "text-amber-300" },
  incorrect: { icon: "✗", cls: "text-red-300" },
  unreadable: { icon: "🧐", cls: "text-chalk-pink" },
};

export function HandwritingModal({
  sessionId,
  initialPrompt,
  onClose,
}: {
  sessionId: string;
  initialPrompt: string;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [transcription, setTranscription] = useState("");
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<HandwritingFeedback | null>(null);
  const promptRef = useRef<HTMLInputElement>(null);

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the board capture."));
      reader.readAsDataURL(blob);
    });

  const grade = async () => {
    if (!prompt.trim() || !transcription.trim()) {
      setError("Tell me what to write, and what you wrote.");
      return;
    }
    setGrading(true);
    setError(null);
    try {
      // Capture the real board when the tldraw editor is live and has shapes
      // (the student wrote with the pen). A failed capture degrades to the
      // transcription path — grading still happens.
      let imageDataUrl: string | undefined;
      try {
        const editor = window.__chalkEditor;
        const shapeIds = editor ? [...editor.getCurrentPageShapeIds()] : [];
        if (editor && shapeIds.length > 0) {
          const { blob } = await editor.toImage(shapeIds, {
            format: "png",
            background: "#2b2924",
            scale: 1,
          });
          imageDataUrl = await blobToDataUrl(blob);
        }
      } catch {
        imageDataUrl = undefined;
      }
      const result = await api.gradeHandwriting(sessionId, {
        prompt: prompt.trim(),
        written: transcription.trim(),
        imageDataUrl,
      });
      setFeedback(result.feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grading failed. Try again.");
    } finally {
      setGrading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Handwriting practice"
      onClick={onClose}
    >
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            aria-label="Close handwriting practice"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm text-chalk hover:bg-white/15 [touch-action:manipulation]"
          >
            ✕
          </button>
        </div>

        <div className="rounded-2xl border border-white/15 bg-board-deep p-5 shadow-panel">
          <p className="text-xs uppercase tracking-wide text-chalk-dim">
            Handwriting practice — write it on the board
          </p>

          {!feedback ? (
            <>
              <label className="mt-3 flex flex-col gap-1 text-sm text-[#f0ead9]">
                What should you write?
                <input
                  ref={promptRef}
                  value={prompt}
                  maxLength={200}
                  placeholder="e.g. The formula for the area of a circle"
                  onChange={(e) => setPrompt(e.target.value)}
                  className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-[#f0ead9] outline-none focus:border-amber-300/60"
                />
              </label>
              <p className="mt-2 text-xs leading-snug text-[#cfc6b8]/80">
                1️⃣ Pick the 🖊 pen and write your answer on the chalkboard.
                <br />
                2️⃣ Type what you wrote below, then check it.
              </p>
              <label className="mt-2 flex flex-col gap-1 text-sm text-[#f0ead9]">
                What did you write?
                <textarea
                  value={transcription}
                  rows={2}
                  maxLength={500}
                  placeholder="Type the words you wrote on the board…"
                  onChange={(e) => setTranscription(e.target.value)}
                  className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-[#f0ead9] outline-none focus:border-amber-300/60"
                />
              </label>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={grading}
                  onClick={() => void grade()}
                  className="rounded-full bg-[#f6c453] px-4 py-1.5 text-sm font-semibold text-[#33302a] disabled:opacity-50"
                >
                  {grading ? "Reading your writing…" : "✍️ Check my writing"}
                </button>
              </div>
            </>
          ) : (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-xl">
                  {VERDICT_STYLE[feedback.verdict].icon}
                </span>
                <span className={`text-lg font-bold ${VERDICT_STYLE[feedback.verdict].cls}`}>
                  {feedback.verdict.replace("_", " ")}
                </span>
                <span className="ml-auto text-xs text-chalk-dim">
                  Legibility {feedback.legibility}/100
                </span>
              </div>
              <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-chalk-dim">
                  I read your writing as
                </p>
                <p className="chalk-font chalk-text text-sm">{feedback.readAs}</p>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[#f0ead9]">{feedback.feedback}</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null);
                    setTranscription("");
                  }}
                  className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-[#f0ead9]"
                >
                  Try another
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full bg-emerald-500/20 px-4 py-1.5 text-sm font-semibold text-emerald-200"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-chalk-pink" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
