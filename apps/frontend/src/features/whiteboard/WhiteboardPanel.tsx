/**
 * Chalkboard panel (ADR-0005). The board IS the lesson: a dark slate-green
 * chalkboard with the tutor's validated ops chalked on in white/yellow and the
 * student drawing in pink. tldraw's default UI is hidden; a minimal chalk
 * toolbar (draw / erase / undo / clear) is provided instead.
 *
 * Persistence and the op vocabulary are unchanged (PRD §5.4, ADR-0002).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DefaultColorThemePalette, Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";

import { useWhiteboardStore } from "../../stores/whiteboardStore";
import { applyOpToEditor, scheduleChalkRelayout } from "./opsBridge";

/** Chalkboard canvas background (ADR-0005) — dark slate-green, chalk-friendly. */
const BOARD_BACKGROUND = "#243B35";

DefaultColorThemePalette.lightMode.background = BOARD_BACKGROUND;
DefaultColorThemePalette.darkMode.background = BOARD_BACKGROUND;

export function WhiteboardPanel({
  sessionId,
  onEditorReady,
  onDrawingChange,
}: {
  sessionId: string;
  onEditorReady?: (editor: Editor) => void;
  /** True while the student has drawn a stroke recently (quiet-detection). */
  onDrawingChange?: (drawing: boolean) => void;
}) {
  const editorRef = useRef<Editor | null>(null);
  const appliedIdsRef = useRef<Set<string>>(new Set());
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<"select" | "draw" | "eraser">("select");

  const ops = useWhiteboardStore((s) => s.ops);
  const loadSession = useWhiteboardStore((s) => s.loadSession);
  const flush = useWhiteboardStore((s) => s.flush);

  // Load persisted ops for this session.
  useEffect(() => {
    void loadSession(sessionId);
  }, [sessionId, loadSession]);

  // Apply server ops the editor has not yet rendered.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    const pending = ops.filter((op) => !appliedIdsRef.current.has(op.id));
    if (pending.length === 0) return;
    const size = {
      width: editor.getViewportPageBounds().width,
      height: editor.getViewportPageBounds().height,
    };
    // The FIRST batch after mount is the persisted-history restore: lay it
    // out without the rolling erase, then pan the camera to the latest chalk
    // so a long lesson stays fully intact (board is infinite on reload).
    const isRestore = appliedIdsRef.current.size === 0 && pending.length > 1;
    for (const op of pending) {
      try {
        applyOpToEditor(editor, op, canvasSize.width > 0 ? canvasSize : size, {
          rolling: !isRestore,
        });
      } catch {
        // Invalid op dropped safely (PRD §9, §15).
      }
      appliedIdsRef.current.add(op.id);
    }
    // Tutor writes must appear as finished chalk, not a selected shape.
    editor.selectNone();
    // Re-stack the column from REAL post-wrap bounds (tldraw wraps text
    // async + again after the webfont loads — bounds-at-creation collide).
    // Restore batches keep everything and pan to the latest chalk; live
    // batches erase the oldest chalk to stay inside the board.
    scheduleChalkRelayout(editor, canvasSize.width > 0 ? canvasSize : size, {
      rolling: !isRestore,
      // Always keep the newest chalk on screen (restore pans down a long
      // lesson; live turns re-frame after the rolling erase).
      panToLatest: true,
    });
  }, [ops, ready, canvasSize]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setReady(true);
      onEditorReady?.(editor);
      // Dark board (ADR-0005): run tldraw's dark color scheme so chalk-white
      // ink renders white instead of the light-theme near-black swatch.
      void editor.user.updateUserPreferences({ colorScheme: "dark" });
      (window as unknown as { __chalkEditor?: Editor }).__chalkEditor = editor;
      useWhiteboardStore.setState((state) => ({ ops: [...state.ops] }));

      const container = editor.getContainer();
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) setCanvasSize({ width: rect.width, height: rect.height });
      });
      observer.observe(container);
    },
    [onEditorReady],
  );

  // Flush dirty student ops after each change settles.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void flush(sessionId).then(() => {
        const { ops: flushed } = useWhiteboardStore.getState();
        for (const op of flushed) appliedIdsRef.current.add(op.id);
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [ops, ready, sessionId, flush]);

  const setToolAndState = useCallback((next: "select" | "draw" | "eraser") => {
    setTool(next);
    editorRef.current?.setCurrentTool(next);
  }, []);

  /**
   * Active-drawing reporting (smart quiet-detection): while the student is
   * mid-stroke with the chalk or eraser they are NOT idle — the inactivity
   * nudge must pause. Uses tldraw's own drawing signal so a finger/pencil
   * drag that never produces a pointerup gap still counts; a 10s tail keeps
   * the pause through stroke bursts without ever sticking on.
   */
  const lastStrokeAtRef = useRef(0);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    const markActive = () => {
      lastStrokeAtRef.current = Date.now();
      onDrawingChange?.(true);
    };
    const stopIfIdle = () => {
      if (Date.now() - lastStrokeAtRef.current > 10_000) onDrawingChange?.(false);
    };
    // `isChanging` fires on every store tick while a stroke is in flight.
    const unsubscribe = editor.store.listen(markActive, { source: "user", scope: "document" });
    const poll = window.setInterval(stopIfIdle, 2000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
      onDrawingChange?.(false);
    };
  }, [ready, onDrawingChange]);

  const undo = useCallback(() => {
    const editor = editorRef.current;
    if (editor) editor.undo();
  }, []);

  const clearBoard = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.deleteShapes(Array.from(editor.getCurrentPageShapeIds()));
    await fetch(`/api/sessions/${sessionId}/whiteboard`, { method: "DELETE" });
    useWhiteboardStore.getState().reset();
    appliedIdsRef.current.clear();
  }, [sessionId]);

  return (
    <div className="relative h-full min-h-0" data-testid="chalkboard-surface">
      <Tldraw onMount={handleMount} hideUi />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 z-10">
        {/* Chalk toolbar (top-left overlay, tldraw UI hidden). */}
        <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-1 rounded-full border border-white/15 bg-black/35 px-2 py-1 backdrop-blur-sm">
          <ToolbarButton
            label="Select"
            active={tool === "select"}
            onClick={() => setToolAndState("select")}
          >
            ✋
          </ToolbarButton>
          <ToolbarButton
            label="Chalk (draw)"
            active={tool === "draw"}
            onClick={() => setToolAndState("draw")}
          >
            🖊
          </ToolbarButton>
          <ToolbarButton
            label="Eraser"
            active={tool === "eraser"}
            onClick={() => setToolAndState("eraser")}
          >
            🧽
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-white/20" aria-hidden />
          <ToolbarButton label="Undo" onClick={undo}>
            ↶
          </ToolbarButton>
          <ToolbarButton label="Clear board" onClick={() => void clearBoard()}>
            🗑
          </ToolbarButton>
        </div>
      </div>
      {!ready && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-board text-sm text-chalk-dim">
          Loading chalkboard…
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors ${
        active ? "bg-chalk/90 text-board-deep" : "text-chalk/80 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
