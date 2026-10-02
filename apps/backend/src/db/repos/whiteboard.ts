/**
 * Whiteboard operation repository (PRD §7 WhiteboardOperation).
 * Monotonic per-session ordering via MAX(seq)+1 in a transaction.
 */
import { asc, eq } from "drizzle-orm";
import type { WhiteboardOperation } from "@local-live-tutor/shared";

import type { Db } from "../client.js";
import { whiteboardOps as opsTable } from "../schema.js";

type OpRow = typeof opsTable.$inferSelect;

function rowToOp(row: OpRow): WhiteboardOperation {
  return {
    id: row.id,
    sessionId: row.sessionId,
    messageId: row.messageId ?? undefined,
    actor: row.actor as WhiteboardOperation["actor"],
    type: row.type as WhiteboardOperation["type"],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export class WhiteboardRepo {
  constructor(private readonly db: Db) {}

  append(
    input: {
      sessionId: string;
      messageId?: string;
      actor: "student" | "tutor";
      type: WhiteboardOperation["type"];
      payload: Record<string, unknown>;
    },
  ): WhiteboardOperation {
    const maxRow = this.db
      .select({ seq: opsTable.seq })
      .from(opsTable)
      .where(eq(opsTable.sessionId, input.sessionId))
      .orderBy(asc(opsTable.seq))
      .all();
    const nextSeq =
      maxRow.length > 0
        ? Math.max(...maxRow.map((r) => r.seq)) + 1
        : 1;
    const row = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      actor: input.actor,
      type: input.type,
      payload: input.payload,
      seq: nextSeq,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(opsTable).values(row).run();
    return rowToOp(row as unknown as OpRow);
  }

  appendMany(
    ops: Array<Parameters<WhiteboardRepo["append"]>[0]>,
  ): WhiteboardOperation[] {
    return this.db.transaction(() => ops.map((op) => this.append(op)));
  }

  listBySession(sessionId: string, limit = 2000): WhiteboardOperation[] {
    const rows = this.db
      .select()
      .from(opsTable)
      .where(eq(opsTable.sessionId, sessionId))
      .orderBy(asc(opsTable.seq))
      .limit(limit)
      .all();
    return rows.map(rowToOp);
  }

  deleteBySession(sessionId: string): number {
    return this.db
      .delete(opsTable)
      .where(eq(opsTable.sessionId, sessionId))
      .run().changes;
  }
}
