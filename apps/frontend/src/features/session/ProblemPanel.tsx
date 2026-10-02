/**
 * Problem panel (PRD §5.2, Flow A/B): image upload / clipboard paste /
 * drag-and-drop / manual entry; extraction result is always confirmed or
 * edited by the student before tutoring starts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtractionResult, Session } from "@local-live-tutor/shared";

import { Banner, Button, StatusPill } from "../../components/ui";
import { api } from "../../lib/api";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export function ProblemPanel({
  session,
  onSessionUpdated,
  onConfirm,
  confirmed,
}: {
  session: Session;
  onSessionUpdated: (session: Session) => void;
  onConfirm: () => void;
  confirmed: boolean;
}) {
  const [text, setText] = useState(session.extractedProblem ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [entities, setEntities] = useState<ExtractionResult["entities"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unclear, setUnclear] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(session.extractedProblem ?? "");
    setDirty(false);
  }, [session.extractedProblem, session.id]);

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
          setUnclear(false);
          setDirty(true);
          onSessionUpdated(result.session);
        } catch (err) {
          // §14 ocr_unclear / vision_unsupported states.
          setError(err instanceof Error ? err.message : "Extraction failed.");
          setUnclear(true);
        } finally {
          setBusy(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [session.id, onSessionUpdated],
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

  const saveAndConfirm = async () => {
    setBusy(true);
    try {
      await api.confirmProblem(session.id, text);
      setDirty(false);
      setUnclear(false);
      onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      {!imageUrl && session.originalImagePath === undefined && (
        <div
          className="paper-grid-bg flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-paper-grid p-4 text-center"
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
          <p className="text-sm font-semibold text-ink-soft">
            Drop an image here, paste, or click to upload
          </p>
          <p className="text-xs text-ink-soft/70">PNG · JPEG · WebP — or type the problem below</p>
        </div>
      )}
      {imageUrl && (
        <img
          src={imageUrl}
          alt="Uploaded problem"
          className="max-h-44 w-full rounded-lg border border-paper-grid object-contain"
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
        <div className="flex flex-wrap gap-1">
          {entities.map((entity, index) => (
            <StatusPill key={`${entity.kind}-${index}`} tone="neutral">
              {entity.kind}: {entity.value.slice(0, 40)}
            </StatusPill>
          ))}
        </div>
      )}

      <textarea
        className="min-h-24 flex-1 resize-none rounded-lg border border-paper-grid p-2 text-sm outline-none focus:border-tutor-blue"
        placeholder="Type or edit the problem text…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
      />

      {error && (
        <Banner tone={unclear ? "warn" : "error"}>
          {error}{" "}
          <span className="text-xs opacity-80">
            Edit the text above, then press “Use this problem”.
          </span>
        </Banner>
      )}

      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? "Working…" : "Upload image"}
        </Button>
        <Button
          disabled={busy || text.trim().length === 0 || (!dirty && confirmed)}
          onClick={() => void saveAndConfirm()}
        >
          {confirmed && !dirty ? "Problem confirmed ✓" : "Use this problem"}
        </Button>
      </div>
      {confirmed && !dirty && (
        <p className="text-xs text-ink-soft">
          Edit the text any time — the tutor will use the updated problem.
        </p>
      )}
    </div>
  );
}
