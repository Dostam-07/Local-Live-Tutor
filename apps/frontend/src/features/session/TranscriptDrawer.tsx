/**
 * Transcript drawer (ADR-0005). The Pengi-style workspace keeps the board
 * clean; the full message history lives in a slide-out drawer that also hosts
 * the type-instead fallback input for browsers without speech recognition or
 * students who prefer typing (PRD §14 degrade states).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@local-live-tutor/shared";

import { Button, Spinner } from "../../components/ui";
import { renderTextWithMath } from "../../lib/katex";
import { streamMessage } from "../../lib/sse";
import { useSettingsStore } from "../../stores/settingsStore";

export type ChatEntry = {
  message: Message;
  streamingText?: string;
};

export function TranscriptDrawer({
  open,
  onClose,
  sessionId,
  entries,
  onTurnComplete,
  onStudentOps,
  pendingVoiceText,
  onVoiceTextConsumed,
  onFinishLesson,
  finishing,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  entries: ChatEntry[];
  onTurnComplete: () => void;
  onStudentOps: (ops: { type: string; payload: Record<string, unknown> }[]) => void;
  pendingVoiceText?: string | null;
  onVoiceTextConsumed: () => void;
  /** Full end-of-lesson ritual (ADR-0009): erase → recap chalk → speak. */
  onFinishLesson?: () => void;
  /** True while the ritual runs — the button shows progress. */
  finishing?: boolean;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSpeak = useSettingsStore((s) => s.settings?.autoSpeak ?? false);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [entries.length, streamingText, open]);

  // Voice → transcription is placed in the editable input (PRD Flow C step 4).
  useEffect(() => {
    if (pendingVoiceText) {
      setInput((current) =>
        current ? `${current} ${pendingVoiceText}`.trim() : pendingVoiceText,
      );
      onVoiceTextConsumed();
    }
  }, [pendingVoiceText, onVoiceTextConsumed]);

  const send = useCallback(
    async (content: string, forceDirectAnswer = false) => {
      const trimmed = content.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setError(null);
      setStreamingText("");
      try {
        await streamMessage(sessionId, { content: trimmed, inputType: "text", forceDirectAnswer }, {
          onDelta: (text) => setStreamingText((prev) => (prev ?? "") + text),
        });
        setStreamingText(null);
        onTurnComplete();
      } catch (err) {
        setStreamingText(null);
        setError(err instanceof Error ? err.message : "Could not send the message.");
      } finally {
        setSending(false);
      }
    },
    [sessionId, sending, onTurnComplete],
  );

  return (
    <aside
      aria-label="Conversation transcript"
      className={`absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-white/10 bg-board-deep/95 text-chalk shadow-panel backdrop-blur-sm transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-sm font-semibold text-chalk">Transcript</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close transcript"
          className="rounded-full px-2 py-0.5 text-chalk-dim hover:bg-white/10 hover:text-chalk"
        >
          ✕
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {entries.map((entry) => {
          const isTutor = entry.message.role === "tutor";
          const body =
            entry.streamingText !== undefined
              ? (entry.streamingText ?? "")
              : entry.message.content;
          return (
            <div
              key={entry.message.id}
              className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${
                isTutor ? "border-chalk-blue/40 bg-white/5" : "ml-8 border-chalk-pink/40 bg-white/5"
              }`}
            >
              <span
                className={`mb-1 block text-xs font-bold ${isTutor ? "text-chalk-blue" : "text-chalk-pink"}`}
              >
                {isTutor ? "Tutor" : "You"}
                {entry.message.hintLevel !== undefined && isTutor
                  ? ` · level ${entry.message.hintLevel}`
                  : ""}
              </span>
              <div
                className="[&_a]:text-chalk-blue"
                dangerouslySetInnerHTML={{ __html: renderTextWithMath(body) }}
              />
              {entry.streamingText !== undefined && (
                <span className="ml-1 inline-block animate-pulse">▍</span>
              )}
            </div>
          );
        })}
        {sending && (
          <div className="flex items-center gap-2 px-1 text-xs text-chalk-dim">
            <Spinner label="Tutor is thinking" /> Tutor is thinking…
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-white/10 px-3 py-2">
          <p role="alert" className="text-xs text-chalk-pink">
            {error}{" "}
            <button className="underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </p>
        </div>
      )}

      <div className="border-t border-white/10 p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {(
            [
              { label: "I understand", request: "I understand this step now.", force: false },
              { label: "Smaller hint", request: "Give me a smaller hint please.", force: false },
              { label: "Next step", request: "Show the next step please.", force: false },
              { label: "Explain directly", request: "Explain it directly please.", force: true },
            ] as const
          ).map((action) => (
            <Button
              key={action.label}
              variant="secondary"
              disabled={sending}
              className="!border-white/15 !bg-white/5 !text-chalk hover:!bg-white/10"
              onClick={() => void send(action.request, action.force)}
            >
              {action.label}
            </Button>
          ))}
          <Button
            variant="secondary"
            disabled={sending || finishing}
            className="!border-white/15 !bg-white/5 !text-chalk hover:!bg-white/10"
            onClick={() => onFinishLesson?.()}
          >
            {finishing ? "Wrapping up…" : "Finish & recap"}
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-11 flex-1 resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-chalk placeholder:text-chalk-dim outline-none focus:border-chalk-blue"
            placeholder="Type instead — the tutor will still speak."
            dir="auto"
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
                setInput("");
              }
            }}
          />
          <Button
            disabled={sending || input.trim().length === 0}
            onClick={() => {
              void send(input);
              setInput("");
            }}
          >
            Send
          </Button>
        </div>
      </div>
    </aside>
  );
}
