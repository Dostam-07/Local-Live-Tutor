/**
 * Optional session-feedback prompt (self-improving personalization, spec §1,
 * §6). Non-intrusive: it appears only where the student is already leaving
 * the lesson (end-of-session card / New Session exit), is always skippable,
 * and after saving shows exactly what the tutor will do differently.
 */
import { useState } from "react";
import type { FeedbackInterpretation } from "@local-live-tutor/shared";

import { api } from "../../lib/api";

export function FeedbackPrompt({
  sessionId,
  onDone,
  onDismiss,
}: {
  sessionId: string;
  onDone?: (result: FeedbackInterpretation & { saved: number }) => void;
  onDismiss?: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<(FeedbackInterpretation & { saved: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (text.trim().length < 3) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.sendFeedback(text.trim(), sessionId);
      setResult(res);
      onDone?.(res);
    } catch {
      setError("Could not save feedback — it stays private on your machine anyway.");
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div
        data-testid="feedback-done"
        className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100"
        role="status"
      >
        <p className="font-semibold">
          {result.saved > 0 ? "Updated your tutoring style:" : "Got it."}
        </p>
        <p className="mt-1 text-emerald-200/90">{result.confirmation}</p>
        {result.preferences.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-emerald-200/80">
            {result.preferences.map((p, i) => (
              <li key={i}>✓ {p.text}</li>
            ))}
          </ul>
        )}
        {result.saved > 0 && (
          <p className="mt-2 text-xs text-emerald-200/60">
            Saved to your tutor preferences — every future session starts this way. Manage them any
            time in Settings → My tutor preferences.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="feedback-prompt"
      className="rounded-xl border border-white/10 bg-white/5 p-4"
    >
      <p className="text-sm font-semibold text-[#f0ead9]">How was your tutoring session?</p>
      <p className="mt-0.5 text-xs text-[#cfc6b8]">
        Anything you'd like me to do differently next time? (Optional — skip is fine.)
      </p>
      <textarea
        data-testid="feedback-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. You explain things too quickly — give me time to think before telling me the answer."
        rows={3}
        className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-[#f0ead9] placeholder:text-[#cfc6b8]/50 focus:border-amber-300/50 focus:outline-none"
      />
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-[#cfc6b8] hover:text-[#f0ead9]"
        >
          Skip
        </button>
        <button
          type="button"
          disabled={saving || text.trim().length < 3}
          onClick={() => void save()}
          data-testid="feedback-save"
          className="rounded-full border border-amber-300/50 bg-amber-400/15 px-3.5 py-1.5 text-xs font-bold text-amber-200 transition-colors hover:bg-amber-400/30 disabled:opacity-40 [touch-action:manipulation]"
        >
          {saving ? "Saving…" : "Save feedback"}
        </button>
      </div>
    </div>
  );
}
