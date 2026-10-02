import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWhiteboardStore } from "../src/stores/whiteboardStore";
import type { WhiteboardOperation } from "@local-live-tutor/shared";

vi.mock("../src/lib/api", () => ({
  api: {
    getWhiteboard: vi.fn().mockResolvedValue({ operations: [] }),
    pushStudentOps: vi.fn().mockImplementation((_id: string, operations) =>
      Promise.resolve({
        operations: operations.map((op: { type: string }, i: number) => ({
          id: `srv-${i}`,
          sessionId: "s",
          actor: "student",
          type: op.type,
          payload: {},
          createdAt: new Date().toISOString(),
        })),
      }),
    ),
  },
}));

const op = (over: Partial<WhiteboardOperation> = {}): WhiteboardOperation => ({
  id: crypto.randomUUID(),
  sessionId: "s",
  actor: "tutor",
  type: "write",
  payload: {},
  createdAt: new Date().toISOString(),
  ...over,
});

describe("whiteboardStore", () => {
  beforeEach(() => {
    useWhiteboardStore.getState().reset();
  });

  it("tracks dirty ops and flushes them", async () => {
    const store = useWhiteboardStore.getState();
    store.appendLocal({ sessionId: "s", actor: "student", type: "write", payload: {} });
    store.appendLocal({ sessionId: "s", actor: "student", type: "draw", payload: {} });
    expect(useWhiteboardStore.getState().dirty).toBe(2);

    await useWhiteboardStore.getState().flush("s");
    expect(useWhiteboardStore.getState().dirty).toBe(0);
    expect(useWhiteboardStore.getState().ops[0]?.id).toBe("srv-0");
  });

  it("undoes and redoes", () => {
    const store = useWhiteboardStore.getState();
    const first = op();
    useWhiteboardStore.setState({ ops: [first] });
    const removed = store.undo();
    expect(removed?.id).toBe(first.id);
    expect(useWhiteboardStore.getState().ops).toHaveLength(0);
    const restored = store.redo();
    expect(restored?.id).toBe(first.id);
    expect(useWhiteboardStore.getState().ops).toHaveLength(1);
  });

  it("undo clears redo history on new local input", () => {
    const store = useWhiteboardStore.getState();
    store.appendLocal({ sessionId: "s", actor: "student", type: "write", payload: {} });
    store.undo();
    expect(useWhiteboardStore.getState().undoStack).toHaveLength(1);
    store.appendLocal({ sessionId: "s", actor: "student", type: "arrow", payload: {} });
    expect(useWhiteboardStore.getState().redoStack).toHaveLength(0);
  });
});
