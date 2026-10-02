/**
 * Student profiles store (roadmap: multi-student local profiles). Loads the
 * roster + the active profile once per app boot; switching a profile reloads
 * profile-scoped data (history, stats, settings slice) via the pages that
 * already fetch on mount.
 */
import { create } from "zustand";

import { api } from "../lib/api";
import type { Profile } from "@local-live-tutor/shared";

type ProfilesState = {
  profiles: Profile[];
  currentProfileId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  create: (input: {
    name: string;
    defaultPersona?: Profile["defaultPersona"];
    defaultVoice?: Profile["defaultVoice"];
    defaultLanguage?: Profile["defaultLanguage"];
    defaultGradeLevel?: Profile["defaultGradeLevel"];
  }) => Promise<Profile>;
  activate: (id: string) => Promise<void>;
  update: (id: string, patch: Partial<Profile>) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  profiles: [],
  currentProfileId: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const result = await api.listProfiles();
      set({
        profiles: result.profiles,
        currentProfileId: result.currentProfileId,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  create: async (input) => {
    const profile = await api.createProfile(input);
    await get().load();
    return profile;
  },

  activate: async (id) => {
    await api.activateProfile(id);
    await get().load();
  },

  update: async (id, patch) => {
    await api.updateProfile(id, patch);
    await get().load();
  },

  remove: async (id) => {
    await api.deleteProfile(id);
    await get().load();
  },
}));
