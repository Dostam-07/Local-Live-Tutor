/**
 * Whiteboard store — owns the validated op log (store-owned log per decision
 * B7.2, so undo/persistence stay independent of the rendering engine).
 */
import { create } from "zustand";

import { api } from "../lib/api";
import type { WhiteboardOperation } from "@local-live-tutor/shared";

type WhiteboardState = {
  ops: WhiteboardOperation[];
  dirty: number; // ops not yet persisted (student drawing)
  undoStack: WhiteboardOperation[];
  redoStack: WhiteboardOperation[];
  appendLocal: (op: Omit<WhiteboardOperation, "id" | "createdAt">) => void;
  /** Appends already-persisted server ops without marking them dirty (chalk reveal). */
  appendServerOps: (ops: WhiteboardOperation[]) => void;
  replaceFromServer: (ops: WhiteboardOperation[]) => void;
  loadSession: (sessionId: string) => Promise<void>;
  flush: (sessionId: string) => Promise<void>;
  undo: () => WhiteboardOperation | undefined;
  redo: () => WhiteboardOperation | undefined;
  reset: () => void;
};

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  ops: [],
  dirty: 0,
  undoStack: [],
  redoStack: [],

  appendLocal: (op) => {
    const created: WhiteboardOperation = {
      ...op,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      ops: [...state.ops, created],
      dirty: state.dirty + 1,
      redoStack: [],
    }));
  },

  appendServerOps: (ops) => {
    if (ops.length === 0) return;
    set((state) => ({ ops: [...state.ops, ...ops] }));
  },

  replaceFromServer: (ops) => set({ ops, dirty: 0 }),

  loadSession: async (sessionId) => {
    const { operations } = await api.getWhiteboard(sessionId);
    set({ ops: operations, dirty: 0, undoStack: [], redoStack: [] });
  },

  flush: async (sessionId) => {
    const { ops, dirty } = get();
    if (dirty === 0) return;
    const pending = ops.slice(-dirty);
    const { operations } = await api.pushStudentOps(
      sessionId,
      pending.map((op) => ({ type: op.type, payload: op.payload })),
    );
    set({ ops: operations, dirty: 0 });
  },

  undo: () => {
    const { ops, undoStack } = get();
    const last = ops.at(-1);
    if (!last) return undefined;
    set({
      ops: ops.slice(0, -1),
      undoStack: [...undoStack, last],
      dirty: Math.max(0, get().dirty - 1),
    });
    return last;
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    const op = undoStack.at(-1);
    if (!op) return undefined;
    set({
      ops: [...get().ops, op],
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, op],
      dirty: get().dirty + 1,
    });
    return op;
  },

  reset: () => set({ ops: [], dirty: 0, undoStack: [], redoStack: [] }),
}));
