/**
 * Student profile repository (roadmap: multi-student local profiles). Each
 * profile owns its sessions, stats, and settings slice; the app keeps a
 * "current profile" pointer in the same KV store used by settings/stats so
 * the choice survives restarts. No accounts, no auth — local only, like the
 * rest of the app.
 */
import { asc, eq } from "drizzle-orm";
import type {
  CreateProfileInput,
  Profile,
  UpdateProfileInput,
} from "@local-live-tutor/shared";

import type { Db } from "../client.js";
import { appSettings as settingsTable, profiles as profilesTable } from "../schema.js";
import { Errors } from "../../errors.js";

const CURRENT_KEY = "current-profile";

type ProfileRow = typeof profilesTable.$inferSelect;

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    defaultPersona: (row.defaultPersona ?? undefined) as Profile["defaultPersona"],
    defaultVoice: (row.defaultVoice ?? undefined) as Profile["defaultVoice"],
    defaultLanguage: (row.defaultLanguage ?? undefined) as Profile["defaultLanguage"],
    defaultGradeLevel: (row.defaultGradeLevel ?? undefined) as Profile["defaultGradeLevel"],
    createdAt: row.createdAt,
  };
}

export class ProfileRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateProfileInput): Profile {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      defaultPersona: input.defaultPersona ?? null,
      defaultVoice: input.defaultVoice ?? null,
      defaultLanguage: input.defaultLanguage ?? null,
      defaultGradeLevel: input.defaultGradeLevel ?? null,
      createdAt: now,
    };
    this.db.insert(profilesTable).values(row).run();
    return rowToProfile(row);
  }

  getById(id: string): Profile | undefined {
    const row = this.db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, id))
      .get();
    return row ? rowToProfile(row) : undefined;
  }

  list(): Profile[] {
    return this.db
      .select()
      .from(profilesTable)
      .orderBy(asc(profilesTable.createdAt))
      .all()
      .map(rowToProfile);
  }

  update(id: string, patch: UpdateProfileInput): Profile {
    const existing = this.getById(id);
    if (!existing) throw Errors.notFound("Profile");
    const next = {
      ...existing,
      name: patch.name ?? existing.name,
      defaultPersona: patch.defaultPersona ?? existing.defaultPersona ?? null,
      defaultVoice: patch.defaultVoice ?? existing.defaultVoice ?? null,
      defaultLanguage: patch.defaultLanguage ?? existing.defaultLanguage ?? null,
      defaultGradeLevel: patch.defaultGradeLevel ?? existing.defaultGradeLevel ?? null,
    };
    this.db
      .update(profilesTable)
      .set(next)
      .where(eq(profilesTable.id, id))
      .run();
    return this.getById(id)!;
  }

  delete(id: string): boolean {
    const result = this.db
      .delete(profilesTable)
      .where(eq(profilesTable.id, id))
      .run();
    // If the deleted profile was current, fall back to no profile (solo mode).
    if (this.getCurrent() === id) this.setCurrent(undefined);
    return result.changes > 0;
  }

  deleteAll(): number {
    const count = this.db.delete(profilesTable).run().changes;
    this.setCurrent(undefined);
    return count;
  }

  /** The profile whose sessions/stats/settings are shown right now. */
  getCurrent(): string | undefined {
    const row = this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, CURRENT_KEY))
      .get();
    const value = (row?.value as { id?: string } | undefined)?.id;
    return value ?? undefined;
  }

  setCurrent(id: string | undefined): void {
    const value = { id: id ?? null };
    this.db
      .insert(settingsTable)
      .values({ key: CURRENT_KEY, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
      .run();
  }
}
