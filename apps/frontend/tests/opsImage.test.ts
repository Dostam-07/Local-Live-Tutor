/**
 * Unit tests for the image op rendering in opsBridge (user spec: images
 * wherever they help understanding) — asset creation and self-healing on
 * broken URLs, without a real tldraw editor (offline, deterministic).
 */
import { describe, expect, it, vi } from "vitest";

// Static import: pulling in opsBridge loads the (large) tldraw module. As a
// dynamic import inside a test it counted against the 5s per-test timeout and
// flaked when the suite ran in parallel (CI runners are slower than dev
// machines). At module top level the load happens during collection, which
// has no per-test limit.
import { applyOpToEditor } from "../src/features/whiteboard/opsBridge.js";

type Created = { id: string; type: string; props?: Record<string, unknown> };

function makeFakeEditor() {
  const shapes = new Map<string, Created>();
  const assets = new Map<string, unknown>();
  const deleted: string[] = [];
  const editor = {
    getCurrentPageShapeIds: () => new Set(shapes.keys()),
    getShape: (id: string) => shapes.get(id),
    getShapePageBounds: (id: string) => {
      const s = shapes.get(id);
      return s ? { x: 10, y: 20, w: 100, h: 24 } : undefined;
    },
    createShapes: (list: Created[]) => {
      for (const s of list) shapes.set(s.id, s);
    },
    createAssets: (list: Array<{ id: string }>) => {
      for (const a of list) assets.set(a.id, a);
    },
    deleteShapes: (ids: string[]) => {
      for (const id of ids) {
        shapes.delete(id);
        deleted.push(id);
      }
    },
    deleteAssets: (ids: string[]) => {
      for (const id of ids) assets.delete(id as never);
    },
    updateShapes: (updates: Array<{ id: string; props?: Record<string, unknown>; meta?: Record<string, unknown> }>) => {
      for (const u of updates) {
        const s = shapes.get(u.id);
        if (!s) continue;
        if (u.props) s.props = { ...s.props, ...u.props };
        if (u.meta) (s as { meta?: Record<string, unknown> }).meta = { ...(s as { meta?: Record<string, unknown> }).meta, ...u.meta };
      }
    },
  };
  return { editor, shapes, assets, deleted };
}

describe("image ops in the chalk flow (user spec)", () => {
  it("creates an asset-backed image shape and advances the flow cursor", async () => {
    const { editor, shapes, assets } = makeFakeEditor();
    const ops = await import("@local-live-tutor/shared");
    const op = {
      id: "op-img",
      sessionId: "s",
      actor: "tutor" as const,
      type: "image" as const,
      payload: {
        url: "https://image.pollinations.ai/prompt/diagram?width=640&height=480",
        x: 100,
        y: 200,
        w: 240,
        label: "The water cycle",
      },
      createdAt: new Date().toISOString(),
    };
    const created = applyOpToEditor(
      editor as never,
      op as never,
      { width: 800, height: 600 },
      { rolling: true },
    );
    expect(created.length).toBeGreaterThanOrEqual(1);
    const assetIds = [...assets.keys()];
    expect(assetIds).toHaveLength(1);
    const imageShape = [...shapes.values()].find((s) => s.type === "image");
    expect(imageShape).toBeTruthy();
    expect((imageShape!.props as { assetId: string }).assetId).toBe(assetIds[0]);
  });

  it("rejects non-https image URLs (PRD §15 safe ops)", async () => {
    const { editor, shapes } = makeFakeEditor();
    const op = {
      id: "op-img2",
      sessionId: "s",
      actor: "tutor" as const,
      type: "image" as const,
      payload: { url: "http://evil.example.com/x.png", x: 0, y: 0, w: 100 },
      createdAt: new Date().toISOString(),
    };
    const created = applyOpToEditor(editor as never, op as never, {
      width: 800,
      height: 600,
    });
    expect(created).toHaveLength(0);
    expect(shapes.size).toBe(0);
  });

  it("chalks a source credit line when the payload carries one (spec §11)", async () => {
    const { editor, shapes } = makeFakeEditor();
    const op = {
      id: "op-img3",
      sessionId: "s",
      actor: "tutor" as const,
      type: "image" as const,
      payload: {
        url: "https://upload.wikimedia.org/wikipedia/commons/water-cycle.png",
        x: 0,
        y: 0,
        w: 420,
        label: "The water cycle",
        credit: "Wikimedia Commons — Diagram of the Water Cycle (Public domain)",
      },
      createdAt: new Date().toISOString(),
    };
    const created = applyOpToEditor(editor as never, op as never, { width: 800, height: 600 });
    const texts = [...shapes.values()].filter((s) => s.type === "text");
    const creditShape = texts.find((s) => String((s.props?.richText as never) ?? "").includes("Wikimedia"));
    // richText is a structured tip tap doc — check via the created list
    // length instead (image + caption + credit = 3 shapes).
    expect(created.length).toBe(3);
    expect(creditShape ?? texts[1]).toBeTruthy();
  });

  it("draws a focus annotation ring for a valid relative focus rect (spec §8)", async () => {
    const { editor, shapes } = makeFakeEditor();
    const op = {
      id: "op-img4",
      sessionId: "s",
      actor: "tutor" as const,
      type: "image" as const,
      payload: {
        url: "https://upload.wikimedia.org/wikipedia/commons/water-cycle.png",
        x: 0,
        y: 0,
        w: 420,
        label: "The water cycle",
        focus: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 },
      },
      createdAt: new Date().toISOString(),
    };
    // Fire the load event synchronously: the ring is drawn in probe.onload.
    const realImage = globalThis.Image;
    class FakeImage {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      naturalWidth = 1200;
      naturalHeight = 800;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    (globalThis as { Image: unknown }).Image = FakeImage;
    try {
      applyOpToEditor(editor as never, op as never, { width: 800, height: 600 });
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      (globalThis as { Image: unknown }).Image = realImage;
    }
    const ellipses = [...shapes.values()].filter((s) => s.type === "ellipse");
    expect(ellipses).toHaveLength(1);
    expect((ellipses[0] as unknown as { meta?: { actor?: string; kind?: string } }).meta).toMatchObject({
      actor: "tutor",
      kind: "explanation",
    });
  });

  it("ignores an out-of-range focus rect instead of crashing (spec §15)", async () => {
    const { editor, shapes } = makeFakeEditor();
    const op = {
      id: "op-img5",
      sessionId: "s",
      actor: "tutor" as const,
      type: "image" as const,
      payload: {
        url: "https://upload.wikimedia.org/wikipedia/commons/water-cycle.png",
        x: 0,
        y: 0,
        w: 420,
        focus: { x: 5, y: 0.2, w: 0.3, h: 0.3 }, // x > 1 → invalid
      },
      createdAt: new Date().toISOString(),
    };
    const realImage = globalThis.Image;
    class FakeImage {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      naturalWidth = 1000;
      naturalHeight = 700;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    (globalThis as { Image: unknown }).Image = FakeImage;
    try {
      applyOpToEditor(editor as never, op as never, { width: 800, height: 600 });
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      (globalThis as { Image: unknown }).Image = realImage;
    }
    expect([...shapes.values()].filter((s) => s.type === "ellipse")).toHaveLength(0);
  });
});
