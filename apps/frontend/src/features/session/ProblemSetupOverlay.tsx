/**
 * Problem setup overlay (PRD §5.2, Flow A/B — ADR-0005 presentation).
 * Sits on the chalkboard before the lesson starts: speak the problem, type it,
 * or upload/paste a photo. The extraction result is always confirmed by the
 * student before tutoring begins (PRD §5.2 integrity gate).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtractionResult, Session } from "@local-live-tutor/shared";

import { Banner, Button, StatusPill, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { PushToTalkButton } from "./PushToTalkButton";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export function ProblemSetupOverlay({
  session,
  onConfirmed,
}: {
  session: Session;
  onConfirmed: () => void;
}) {
  const [text, setText] = useState(session.extractedProblem ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [entities, setEntities] = useState<ExtractionResult["entities"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(
    async (file: File) => {
      if (!ACCEPTED.includes(file.type)) {
        setError("Only PNG, JPEG, and WebP images are supported.");
        return;
      }
      setBusy(true);
      setError(null);
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result);
        setImageUrl(dataUrl);
        try {
          const result = await api.uploadImageProblem(session.id, dataUrl);
          setText(result.extraction.text);
          setEntities(result.extraction.entities);
          onConfirmed();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Extraction failed.");
        } finally {
          setBusy(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [session.id, onConfirmed],
  );

  // Clipboard paste (PRD §5.2).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) void processImage(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [processImage]);

  const saveAndStart = async () => {
    setBusy(true);
    try {
      await api.confirmProblem(session.id, text);
      onConfirmed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-board-deep/70 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-board-deep/95 p-5 shadow-panel">
        <h1 className="chalk-font chalk-text text-lg font-bold">
          What shall we work on?
        </h1>
        <p className="mt-1 text-xs text-chalk-dim">
          Say it with the mic, type it, or drop a photo of the problem.
        </p>

        <div
          className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/25 p-4 text-center"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void processImage(file);
          }}
          role="button"
          aria-label="Upload a problem image"
        >
          <p className="text-sm font-semibold text-chalk">
            Drop an image here, paste, or click to upload
          </p>
          <p className="text-xs text-chalk-dim">PNG · JPEG · WebP</p>
        </div>
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Uploaded problem"
            className="mt-3 max-h-32 w-full rounded-lg border border-white/15 object-contain"
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void processImage(file);
          }}
        />

        {entities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {entities.map((entity, index) => (
              <StatusPill key={`${entity.kind}-${index}`} tone="neutral">
                {entity.kind}: {entity.value.slice(0, 40)}
              </StatusPill>
            ))}
          </div>
        )}

        <textarea
          className="mt-4 min-h-24 w-full resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-chalk placeholder:text-chalk-dim outline-none focus:border-chalk-blue"
          placeholder="e.g. 3/4 + 1/2 = ?  — or press the mic and just say it"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {error && (
          <div className="mt-2">
            <Banner tone={imageUrl ? "warn" : "error"}>{error}</Banner>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <PushToTalkButton
            onTranscribed={(spoken) =>
              setText((current) => (current ? `${current} ${spoken}` : spoken))
            }
          />
          <Button
            disabled={busy || text.trim().length === 0}
            onClick={() => void saveAndStart()}
          >
            {busy ? "Working…" : "Start the lesson"}
          </Button>
        </div>
        {busy && (
          <div className="mt-2 flex items-center gap-2 text-xs text-chalk-dim">
            <Spinner label="Working" /> Reading the problem…
          </div>
        )}
      </div>
    </div>
  );
}
