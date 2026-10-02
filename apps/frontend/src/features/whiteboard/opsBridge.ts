/**
 * Op bridge (PRD §5.4): validated ops → tldraw shapes.
 * Board space is a normalized 0–1000 grid; the renderer scales it to the
 * actual canvas. Tutor ink is blue, student ink red (PRD palette).
 */
import {
  createShapeId,
  toRichText,
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLDefaultColorStyle,
} from "tldraw";
import { isRtlLanguage, type LessonLanguage, type WhiteboardOperation } from "@local-live-tutor/shared";

/**
 * The lesson language for board rendering (roadmap: RTL board layout). The
 * workspace sets it once per session load/change; RTL languages mirror the
 * chalk flow (right-side column, right-aligned text).
 */
let boardLanguage: LessonLanguage | undefined;
export function setBoardLanguage(language: LessonLanguage | undefined): void {
  boardLanguage = language;
}
export function getBoardLanguage(): LessonLanguage | undefined {
  return boardLanguage;
}
function boardIsRtl(): boolean {
  return isRtlLanguage(boardLanguage);
}

export const BOARD_SPACE = 1000;

/** Chalk palette (ADR-0005): tutor white, student pink, accents yellow. */
export const COLORS = {
  tutor: "#F4F7F2",
  student: "#F9A8C2",
  highlight: "#FBD870",
};

/** Content-kind → tldraw color (user spec: color-coded chalk).
 *  question=blue · fact=white · answer=green · explanation=amber. */
const KIND_TL_COLORS: Record<string, TLDefaultColorStyle> = {
  question: "light-blue",
  fact: "white",
  answer: "light-green",
  explanation: "yellow",
};

const TL_COLORS: Record<"tutor" | "student" | "highlight", TLDefaultColorStyle> = {
  tutor: "white",
  student: "light-red",
  highlight: "yellow",
};

function scale(value: number, size: number): number {
  return Math.round((value / BOARD_SPACE) * size);
}

function scalePair(pair: [number, number], size: number): { x: number; y: number } {
  return { x: scale(pair[0], size), y: scale(pair[1], size) };
}

function payloadColor(
  payload: Record<string, unknown>,
  actor: "tutor" | "student",
): TLDefaultColorStyle {
  // Content kind wins for tutor chalk (user spec: color-coded by type);
  // student ink stays pink so the student's own words are always findable.
  const kind = typeof payload.kind === "string" ? payload.kind : undefined;
  if (kind && kind in KIND_TL_COLORS && actor === "tutor") return KIND_TL_COLORS[kind]!;
  const custom = typeof payload.color === "string" ? payload.color : undefined;
  if (custom === COLORS.tutor) return TL_COLORS.tutor;
  if (custom === COLORS.student) return TL_COLORS.student;
  if (custom === COLORS.highlight) return TL_COLORS.highlight;
  return actor === "tutor" ? TL_COLORS.tutor : TL_COLORS.student;
}

/**
 * Slides a freshly created shape horizontally so its rendered bounds sit fully
 * on the board (LLMs emit x≈0 or long lines that overflow either edge).
 */
function fitXInsideBoard(
  editor: Editor,
  id: TLShapeId,
  canvasWidth: number,
  size: number,
): void {
  const b = editor.getShapePageBounds(id);
  if (!b) return;
  const margin = scale(30, size);
  let nx = b.x;
  if (b.x < margin) nx = margin;
  if (b.x + b.w > canvasWidth - margin) nx = Math.max(margin, canvasWidth - margin - b.w);
  if (Math.round(nx) !== Math.round(b.x)) {
    editor.updateShapes([{ id, type: editor.getShape(id)?.type ?? "text", x: nx }]);
  }
}

function newId(): TLShapeId {
  return createShapeId();
}

// ---- Deterministic chalk flow layout (user fix: overlapping, oversized,
// overflowing chalk). Model-emitted coordinates are IGNORED for text: every
// write lands in one left column, top-down, sized to the actual canvas —
// screen-size agnostic. Row advance uses the shape's REAL measured bounds
// right after creation (tldraw measures wrapped text synchronously for
// fixed-width boxes), so lines never collide. THE BOARD IS APPEND-ONLY
// (user spec: "a permanent record of the entire session — the question, every
// step, every attempt stays visible"): nothing is ever auto-erased. When the
// column grows past the viewport the board panel pans/zooms to the latest
// chalk instead of deleting the oldest. Erasing happens ONLY through the
// explicit Clear orb / end-of-lesson ritual.

/** Chalk size (user: it was too big and got cut). */
const CHALK_SCALE = 0.68;
const CHALK_LINE_PX = 26;
const CHALK_CHAR_PX = 11.5; // conservative estimate until real bounds are read

/** The answer bar overlays the lower part of the board — keep chalk above it. */
const BOTTOM_FRACTION = 0.66;

const layoutCursors = new WeakMap<Editor, number>();
void BOTTOM_FRACTION; // kept for the clear_region ritual geometry
/** Created chalk ids (oldest first) per editor, in board order. */
const chalkQueue = new WeakMap<Editor, TLShapeId[]>();

function estimateChalkHeight(text: string, w: number): number {
  let lines = 0;
  for (const seg of text.split("\n")) {
    const per = Math.max(14, Math.floor(w / CHALK_CHAR_PX));
    lines += Math.max(1, Math.ceil(seg.length / per));
  }
  return lines * CHALK_LINE_PX + 10;
}

/**
 * No-op placeholder kept for API compatibility: the board is append-only, so
 * no room ever needs to be made. The camera pans to the latest chalk instead
 * (see scheduleChalkRelayout → panToLatestChalk).
 */
/**
 * Append-only placement: every block lands at the flow cursor, even below
 * the fold — the camera pans to the latest chalk instead of anything being
 * squeezed back on top of existing chalk (which would overlap).
 */
function placeAtCursor(y: number): number {
  return y;
}

/** Next free y in the chalk column; initializes below existing chalk so a
 *  reloaded board keeps writing underneath what is already there. */
function flowY(
  editor: Editor,
  size: number,
  canvasSize: { width: number; height: number },
): number {
  const top = Math.round(canvasSize.height * 0.2);
  const cached = layoutCursors.get(editor);
  if (cached !== undefined) return Math.max(cached, top);
  let y = top;
  for (const id of editor.getCurrentPageShapeIds()) {
    const b = editor.getShapePageBounds(id);
    if (b && b.x < scale(760, size)) y = Math.max(y, b.y + b.h + 12);
  }
  layoutCursors.set(editor, y);
  return y;
}

function advanceCursor(editor: Editor, y: number): void {
  layoutCursors.set(editor, y);
}

/**
 * Spec §8–§9 (mark the part being explained, follow the explanation
 * visually): draws a bright annotation ring over the relative (0–1) focus
 * rectangle the tutor declared for the current image. The ring is part of
 * the chalk queue (animates in with the rest) and carries tutor actor
 * metadata so erase/clear treats it like tutor ink.
 */
function drawFocusRing(
  editor: Editor,
  imageId: TLShapeId,
  focus: unknown,
): void {
  if (!focus || typeof focus !== "object") return;
  const f = focus as { x?: number; y?: number; w?: number; h?: number };
  const bx = Number(f.x);
  const by = Number(f.y);
  const bw = Number(f.w);
  const bh = Number(f.h);
  if (![bx, by, bw, bh].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return;
  if (bw <= 0 || bh <= 0) return;
  const b = editor.getShapePageBounds(imageId);
  if (!b) return;
  const ringId = `shape:${crypto.randomUUID()}` as TLShapeId;
  try {
    editor.createShapes([
      {
        id: ringId,
        type: "ellipse",
        x: b.x + bx * b.w - 6,
        y: b.y + by * b.h - 6,
        props: {
          w: Math.max(bw * b.w + 12, 24),
          h: Math.max(bh * b.h + 12, 24),
          fill: "none" as never,
          color: "orange" as never,
          dash: "dashed" as never,
          size: "m" as never,
        },
      },
    ]);
    const ring = editor.getShape(ringId);
    if (ring) {
      editor.updateShapes([
        { id: ringId, type: "ellipse", meta: { ...ring.meta, actor: "tutor", kind: "explanation" } },
      ]);
      enqueueChalk(editor, ringId);
    }
  } catch {
    // A failed annotation must never take down the board render.
  }
}

function enqueueChalk(editor: Editor, id: TLShapeId): void {
  const queue = chalkQueue.get(editor) ?? [];
  queue.push(id);
  chalkQueue.set(editor, queue);
}

/**
 * The single chalk column: fixed margin (LEFT in LTR lessons, RIGHT in RTL
 * lessons — roadmap: right-to-left chalk flow for Arabic/Hebrew), width
 * capped to the canvas.
 */
function chalkColumn(canvasSize: { width: number }, size: number): { x: number; w: number; rtl: boolean } {
  const marginX = scale(56, size);
  const w = Math.min(canvasSize.width - marginX * 2, Math.round(canvasSize.width * 0.86));
  const rtl = boardIsRtl();
  return { x: rtl ? canvasSize.width - marginX - w : marginX, w, rtl };
}

// ---- Post-render chalk relayout (the real no-overlap guarantee).
// tldraw wraps text asynchronously and re-wraps it AGAIN when the webfont
// finishes loading, so bounds read at creation time are stale — rows collided
// by a line or more. relayoutChalk re-stacks the whole chalk column from the
// REAL post-wrap bounds, in queue order. The column may extend below the
// fold; the panel pans the camera to the latest chalk (append-only board —
// nothing is ever erased to fit).
function relayoutChalk(
  editor: Editor,
  canvasSize: { width: number; height: number },
  _rolling: boolean,
): void {
  const top = Math.round(canvasSize.height * 0.2);
  const gap = 10;
  const queue = (chalkQueue.get(editor) ?? []).filter((id) => Boolean(editor.getShape(id)));
  chalkQueue.set(editor, queue);

  // Real, current heights (post-wrap, post-font-load).
  const oldBounds = new Map<TLShapeId, { x: number; y: number; w: number; h: number }>();
  for (const id of queue) {
    const b = editor.getShapePageBounds(id);
    if (b) oldBounds.set(id, { x: b.x, y: b.y, w: b.w, h: b.h });
  }

  // Target positions: one clean column from the top. It may grow past the
  // fold — that is BY DESIGN (append-only timeline); the camera handles it.
  const targets = new Map<TLShapeId, number>();
  let y = top;
  for (const id of queue) {
    const b = oldBounds.get(id);
    if (!b) continue;
    targets.set(id, y);
    y += b.h + gap;
  }

  const updates: Array<{ id: TLShapeId; type: string; y: number }> = [];
  const movedBy = new Map<TLShapeId, number>();
  for (const [id, targetY] of targets) {
    const b = oldBounds.get(id);
    if (!b) continue;
    const dy = Math.round(targetY - b.y);
    if (Math.abs(dy) >= 1) {
      updates.push({ id, type: editor.getShape(id)?.type ?? "text", y: b.y + dy });
      movedBy.set(id, dy);
    }
  }

  // Decorations (highlight ellipses, underlines) are not in the chalk queue;
  // keep them glued to the text they circle when that text re-stacks.
  const decor: Array<{ id: TLShapeId; type: string; y: number }> = [];
  if (movedBy.size > 0) {
    for (const sid of editor.getCurrentPageShapeIds()) {
      if (targets.has(sid)) continue;
      const b = editor.getShapePageBounds(sid);
      if (!b) continue;
      for (const [tid, t] of oldBounds) {
        const intersects =
          b.x < t.x + t.w && b.x + b.w > t.x && b.y < t.y + t.h && b.y + b.h > t.y;
        if (intersects) {
          const dy = movedBy.get(tid);
          if (dy) decor.push({ id: sid, type: editor.getShape(sid)?.type ?? "geo", y: b.y + dy });
          break;
        }
      }
    }
  }

  if (updates.length + decor.length > 0) {
    editor.updateShapes([...updates, ...decor] as never);
  }
  layoutCursors.set(editor, y);
}

/**
 * Pans the camera so the newest chalk stays on screen (the append-only
 * board's "scrolling": the column grows downward, the viewport follows —
 * the student can always pan/zoom back to earlier steps; nothing is ever
 * deleted to make room).
 */
function panToLatestChalk(editor: Editor): void {
  const queue = chalkQueue.get(editor) ?? [];
  let maxBottom = 0;
  for (const id of queue) {
    const b = editor.getShapePageBounds(id);
    if (b) maxBottom = Math.max(maxBottom, b.y + b.h);
  }
  const vp = editor.getViewportPageBounds();
  const targetBottom = vp.y + vp.height * 0.62;
  if (maxBottom > targetBottom) {
    const cam = editor.getCamera();
    editor.setCamera({ x: cam.x, y: cam.y - (maxBottom - targetBottom), z: cam.z });
  }
}

/**
 * Schedules the post-render chalk relayout: once after paint (wrap settled),
 * once when the webfont finishes loading (tldraw re-wraps every text shape
 * then, which is what made rows collide), and once more as a safety net.
 * Idempotent — safe to call after every applied batch. `rolling` is retained
 * for call-site compatibility but ignored: the board is append-only, so the
 * relayout NEVER deletes shapes; the camera pans to the latest chalk instead.
 */
export function scheduleChalkRelayout(
  editor: Editor,
  canvasSize: { width: number; height: number },
  opts: { rolling?: boolean; panToLatest?: boolean } = {},
): void {
  const run = () => {
    try {
      relayoutChalk(editor, canvasSize, opts.rolling !== false);
      if (opts.panToLatest !== false) panToLatestChalk(editor);
    } catch {
      // Layout is cosmetic — never let it take the board down.
    }
  };
  requestAnimationFrame(run);
  if (typeof document !== "undefined" && document.fonts?.ready) {
    void document.fonts.ready.then(() => run());
  }
  window.setTimeout(run, 400);
  window.setTimeout(run, 1100);
}

/**
 * Slides a target y down until the row is clear of existing shapes whose
 * x-range overlaps. Works in rendered pixels, so tutor chalk stays legible
 * regardless of the coordinates the model emits (LLMs repeat rows often).
 */
function nudgeRow(
  editor: Editor,
  x: number,
  y: number,
  size: number,
): number {
  const row = scale(115, size);
  const tolerance = scale(60, size);
  const bounds = Array.from(editor.getCurrentPageShapeIds()).flatMap((id) => {
    const b = editor.getShapePageBounds(id);
    return b ? [{ x: b.x, y: b.y, w: b.w, h: b.h }] : [];
  });
  let ty = y;
  for (let guard = 0; guard < 12; guard += 1) {
    const blocked = bounds.some(
      (b) =>
        b.x < x + scale(240, size) &&
        b.x + b.w > x &&
        Math.abs(b.y - ty) < Math.max(b.h * 0.75, tolerance),
    );
    if (!blocked) break;
    ty += row;
  }
  return ty;
}

/**
 * Applies one validated op to the editor. Returns the created shapes (if any)
 * so callers can track them for undo. Throws on impossible geometry so the
 * caller can drop the op safely (§15: invalid ops are rejected safely).
 *
 * The board is APPEND-ONLY (user spec: the chalkboard is the permanent record
 * of the whole session). `rolling` is retained for call-site compatibility
 * but ignored — nothing is auto-erased, ever. Content flows downward and the
 * camera pans to the newest chalk; erasing happens only via the explicit
 * Clear orb or the end-of-lesson ritual.
 */
export function applyOpToEditor(
  editor: Editor,
  op: WhiteboardOperation,
  canvasSize: { width: number; height: number },
  opts: { rolling?: boolean } = {},
): TLShape[] {
  void opts;
  const size = Math.min(canvasSize.width, canvasSize.height);
  const props = op.payload;
  const color = payloadColor(props, op.actor);
  const created: TLShape[] = [];

  const push = (shape: TLShape) => created.push(shape);

  switch (op.type) {
    case "write": {
      // Deterministic flow placement: the model's x/y are ignored for text
      // (they caused overlaps); each block flows top-down in one column sized
      // to the real canvas, at readable chalk scale. RTL lessons (roadmap:
      // Arabic/Hebrew) mirror the column to the right edge and right-align
      // the text so lines read right-to-left naturally.
      const { x, w, rtl } = chalkColumn(canvasSize, size);
      const text = String(props.text ?? "");
      const y = flowY(editor, size, canvasSize);
      const placeY = placeAtCursor(y);
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "text",
          x,
          y: placeY,
          props: {
            richText: toRichText(text),
            color,
            autoSize: false,
            w,
            scale: CHALK_SCALE,
            ...(rtl ? { horizontalAlign: "end" as const } : {}),
          },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        // Advance by the REAL wrapped height (not the estimate) — this is what
        // actually guarantees no overlap between rows.
        const b = editor.getShapePageBounds(id);
        if (b) advanceCursor(editor, b.y + b.h + 10);
        enqueueChalk(editor, id);
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    case "draw_equation": {
      const { x, w, rtl } = chalkColumn(canvasSize, size);
      const latex = String(props.latex ?? "");
      // KaTeX-style LaTeX in a text shape; math stays human-readable.
      const display = latex
        .replace(/\\frac{([^}]+)}{([^}]+)}/g, "($1)/($2)")
        .replace(/\\times/g, "×")
        .replace(/\\div/g, "÷")
        .replace(/[{}\\]/g, "");
      const y = flowY(editor, size, canvasSize);
      const placeY = placeAtCursor(y);
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "text",
          x,
          y: placeY,
          props: {
            richText: toRichText(display),
            color,
            autoSize: false,
            w,
            scale: CHALK_SCALE,
            ...(rtl ? { horizontalAlign: "end" as const } : {}),
          },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        const b = editor.getShapePageBounds(id);
        if (b) advanceCursor(editor, b.y + b.h + 10);
        enqueueChalk(editor, id);
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    case "highlight": {
      // Semantic highlight: circle the text shape that best matches the target.
      const target = String(props.target ?? "").toLowerCase();
      const candidates = Array.from(editor.getCurrentPageShapeIds())
        .map((id) => editor.getShape(id))
        .filter((shape): shape is TLShape => Boolean(shape));
      const match = candidates
        .filter((s) => s.type === "text")
        .map((s) => {
          const richText = (s.props as { richText?: { type: string } }).richText;
          const content = JSON.stringify(richText ?? {}).toLowerCase();
          return { s, index: content.indexOf(target) };
        })
        .filter((entry) => entry.index >= 0)
        .sort((a, b) => a.index - b.index)[0];
      const bounds =
        match?.s
          ? editor.getShapePageBounds(match.s.id)
          : editor.getCurrentPageBounds();
      if (!bounds) break;
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "geo",
          x: bounds.x - 4,
          y: bounds.y - 4,
          props: {
            geo: "ellipse",
            w: bounds.w + 8,
            h: bounds.h + 8,
            fill: "none",
            dash: "draw",
            color: TL_COLORS.highlight,
            size: "m",
          },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        fitXInsideBoard(editor, id, canvasSize.width, size);
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    case "circle": {
      const cx = scale(Number(props.cx ?? 500), size);
      const cy = scale(Number(props.cy ?? 500), size);
      const rx = Math.max(8, scale(Number(props.rx ?? 60), size));
      const ry = Math.max(8, scale(Number(props.ry ?? 60), size));
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "geo",
          x: cx - rx,
          y: cy - ry,
          props: {
            geo: "ellipse",
            w: rx * 2,
            h: ry * 2,
            fill: "none",
            dash: "draw",
            color,
            size: "m",
            labelColor: "black",
          },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        fitXInsideBoard(editor, id, canvasSize.width, size);
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    case "underline":
    case "line": {
      const from = scalePair((props.from as [number, number]) ?? [0, 0], size);
      const to = scalePair((props.to as [number, number]) ?? [100, 100], size);
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "line",
          x: Math.min(from.x, to.x),
          y: Math.min(from.y, to.y),
          props: {
            points: {
              a: {
                id: "a" as TLShapeId,
                index: "a0" as never,
                x: from.x - Math.min(from.x, to.x),
                y: from.y - Math.min(from.y, to.y),
              },
              b: {
                id: "b" as TLShapeId,
                index: "a1" as never,
                x: to.x - Math.min(from.x, to.x),
                y: to.y - Math.min(from.y, to.y),
              },
            },
            color,
            size: "m",
          },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        fitXInsideBoard(editor, id, canvasSize.width, size);
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    case "arrow": {
      const from = scalePair((props.from as [number, number]) ?? [0, 0], size);
      const to = scalePair((props.to as [number, number]) ?? [100, 100], size);
      // Slide the whole arrow down to a free row (never over existing chalk).
      const freeY = nudgeRow(editor, Math.min(from.x, to.x), Math.min(from.y, to.y), size);
      const dy = freeY - Math.min(from.y, to.y);
      from.y += dy;
      to.y += dy;
      const label = typeof props.label === "string" ? props.label : undefined;
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "arrow",
          x: Math.min(from.x, to.x),
          y: Math.min(from.y, to.y),
          props: {
            start: { x: from.x - Math.min(from.x, to.x), y: from.y - Math.min(from.y, to.y) },
            end: { x: to.x - Math.min(from.x, to.x), y: to.y - Math.min(from.y, to.y) },
            color,
            size: "m",
            // tldraw v3 arrow labels take plain text (not richText) at creation.
            ...(label ? { text: label } : {}),
          },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        fitXInsideBoard(editor, id, canvasSize.width, size);
        // Arrow labels center on the line and overflow its bounds — clamp the
        // arrow so the *label* also stays on the board (estimated width).
        if (label) {
          const b = editor.getShapePageBounds(id);
          if (b) {
            const margin = scale(30, size);
            const labelW = label.length * 8.5 + 24;
            const mid = b.x + b.w / 2;
            const lo = margin + labelW / 2;
            const hi = canvasSize.width - margin - labelW / 2;
            const target = Math.min(Math.max(mid, lo), Math.max(lo, hi));
            if (Math.round(target - mid) !== 0) {
              editor.updateShapes([{ id, type: "arrow", x: shape.x + (target - mid) }]);
            }
          }
        }
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    case "rectangle": {
      const x = scale(Number(props.x ?? 0), size);
      const y = scale(Number(props.y ?? 0), size);
      const w = Math.max(8, scale(Number(props.w ?? 100), size));
      const h = Math.max(8, scale(Number(props.h ?? 80), size));
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "geo",
          x,
          y,
          props: { geo: "rectangle", w, h, fill: "none", dash: "draw", color, size: "m" },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        fitXInsideBoard(editor, id, canvasSize.width, size);
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    case "clear_region": {
      const region = String(props.region ?? "all");
      const all = Array.from(editor.getCurrentPageShapeIds());
      const toDelete = all.filter((id) => {
        if (region === "all") return true;
        const shape = editor.getShape(id);
        const meta = (shape?.meta as { actor?: string } | undefined) ?? {};
        return region === "tutor" ? meta.actor === "tutor" : meta.actor === "student";
      });
      if (toDelete.length > 0) editor.deleteShapes(toDelete);
      // Reset the flow layout so the next chalk starts at the top (the ritual
      // erase → recap choreography depends on this).
      if (region !== "student") {
        layoutCursors.delete(editor);
        chalkQueue.set(editor, []);
      }
      break;
    }
    case "image": {
      // Tutor-fetched illustration (user spec: as many as help understanding).
      // tldraw v3 requires image shapes to reference a created ASSET — an
      // inline `src` prop throws (board-killing error screen), so create the
      // asset first, then the shape. Sits in the chalk flow like text so it
      // never overlaps other chalk; caption chalked under the picture.
      const url = String(props.url ?? "");
      if (!/^https:\/\//.test(url)) break;
      const { x, w: colW } = chalkColumn(canvasSize, size);
      // Spec §7: the visual is a meaningful part of the lesson — show it
      // LARGE (most of the chalk column, never a tiny stamp) while staying
      // inside the usable board (0.2 top margin → 0.66 answer-bar zone).
      const imgW = Math.min(
        Math.max(scale(Number(props.w ?? 320), size), 200),
        Math.round(colW * 0.85),
      );
      const usableH = canvasSize.height * (BOTTOM_FRACTION - 0.2);
      const maxImgH = Math.round(usableH * 0.85);
      const imgH = Math.min(Math.round(imgW * 0.75), maxImgH); // placeholder until the real aspect ratio loads
      const y = flowY(editor, size, canvasSize);
      const placeY = placeAtCursor(y);
      // tldraw v3.15 has no createAssetId export — ids are the plain
      // `asset:<uuid>` string form (cast; the store accepts it).
      const assetId = `asset:${crypto.randomUUID()}` as never;
      editor.createAssets([
        {
          id: assetId,
          type: "image",
          typeName: "asset",
          props: {
            src: url,
            name: "tutor illustration",
            w: imgW,
            h: imgH,
            mimeType: "image/png",
            isAnimated: false,
          },
          meta: {},
        } as never,
      ]);
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "image",
          x,
          y: placeY,
          props: { w: imgW, h: imgH, assetId },
        },
      ]);
      // Self-healing + aspect-ratio correction in one load: measure the real
      // image once it loads (spec §7 — no squashed diagrams), resize the
      // shape to match, and lower the cursor by the true height. If it can
      // never load (offline, blocked, source hiccup), remove the shape +
      // asset so one broken URL can never take down the board render.
      const probe = new Image();
      probe.onerror = () => {
        try {
          editor.deleteShapes([id]);
          editor.deleteAssets([assetId as never]);
          const queue = chalkQueue.get(editor) ?? [];
          chalkQueue.set(editor, queue.filter((q) => q !== id));
        } catch {
          // Never let cleanup crash the caller.
        }
      };
      probe.onload = () => {
        try {
          const natural = probe.naturalWidth || 1;
          const naturalH = probe.naturalHeight || 1;
          const realH = Math.min(Math.round((imgW * naturalH) / natural), maxImgH);
          const realW = Math.round((realH * natural) / naturalH);
          editor.updateShapes([{ id, type: "image", props: { w: realW, h: realH } }]);
          const b = editor.getShapePageBounds(id);
          if (b) {
            advanceCursor(editor, b.y + b.h + 30);
            if (captionId) {
              editor.updateShapes([{ id: captionId, type: "text", y: b.y + b.h + 10 }]);
            }
          }
          drawFocusRing(editor, id, props.focus);
        } catch {
          // Never let resize/cleanup crash the caller.
        }
      };
      probe.src = url;
      let captionId: TLShapeId | null = null;
      advanceCursor(editor, placeY + imgH + 30);
      enqueueChalk(editor, id);
      const shape = editor.getShape(id);
      if (shape) push(editor.getShape(id) ?? shape);
      const label = typeof props.label === "string" ? props.label : "";
      if (label) {
        captionId = newId();
        const capY = (layoutCursors.get(editor) ?? placeY) ;
        editor.createShapes([
          {
            id: captionId,
            type: "text",
            x,
            y: capY,
            props: {
              richText: toRichText(label.slice(0, 120)),
              color,
              autoSize: false,
              w: colW,
              scale: CHALK_SCALE,
              ...(boardIsRtl() ? { horizontalAlign: "end" as const } : {}),
            },
          },
        ]);
        const caption = editor.getShape(captionId);
        if (caption) {
          const cb = editor.getShapePageBounds(captionId);
          if (cb) advanceCursor(editor, cb.y + cb.h + 10);
          enqueueChalk(editor, captionId);
          created.push(caption);
        }
      }
      // Spec §11: source credit where required — chalked small under the
      // caption so students see where the visual came from.
      const credit = typeof props.credit === "string" ? props.credit : "";
      if (credit) {
        const creditId = newId();
        const credY = layoutCursors.get(editor) ?? placeY;
        editor.createShapes([
          {
            id: creditId,
            type: "text",
            x,
            y: credY,
            props: {
              richText: toRichText(`— ${credit.slice(0, 140)}`),
              color: "light-blue" as never,
              autoSize: false,
              w: colW,
              scale: CHALK_SCALE * 0.8,
              ...(boardIsRtl() ? { horizontalAlign: "end" as const } : {}),
            },
          },
        ]);
        const creditShape = editor.getShape(creditId);
        if (creditShape) {
          const cb = editor.getShapePageBounds(creditId);
          if (cb) advanceCursor(editor, cb.y + cb.h + 8);
          enqueueChalk(editor, creditId);
          created.push(creditShape);
        }
      }
      break;
    }
    case "draw": {
      // Student freehand ink (never model-generated).
      const points = Array.isArray(props.points)
        ? (props.points as Array<{ x: number; y: number }>)
        : [];
      if (points.length < 2) break;
      const scaled = points.map((p) => ({
        x: scale(p.x, size),
        y: scale(p.y, size),
      }));
      const minX = Math.min(...scaled.map((p) => p.x));
      const minY = Math.min(...scaled.map((p) => p.y));
      const id = newId();
      editor.createShapes([
        {
          id,
          type: "draw",
          x: minX,
          y: minY,
          props: {
            segments: [
              {
                points: scaled.map((p, i) => ({
                  index: String(i).padStart(4, "0") as never,
                  x: p.x - minX,
                  y: p.y - minY,
                  z: 0.5,
                })),
              },
            ],
            color,
            size: "m",
            fill: false,
          },
        },
      ]);
      const shape = editor.getShape(id);
      if (shape) {
        fitXInsideBoard(editor, id, canvasSize.width, size);
        push(editor.getShape(id) ?? shape);
      }
      break;
    }
    default:
      // Unknown op types are dropped, never crash (PRD §9, §15).
      break;
  }

  // Tag actor metadata so clear_region can distinguish tutor/student ink,
  // and the chalk kind so the rolling erase protects questions (user bug:
  // the question disappeared while explanations kept coming — questions are
  // erased LAST, only when nothing else can make room).
  const kind = typeof props.kind === "string" ? props.kind : undefined;
  for (const shape of created) {
    editor.updateShapes([
      {
        id: shape.id,
        type: shape.type,
        meta: { ...shape.meta, actor: op.actor, ...(kind ? { kind } : {}) },
      },
    ]);
  }
  return created;
}
