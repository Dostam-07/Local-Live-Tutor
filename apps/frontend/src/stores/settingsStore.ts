import { create } from "zustand";

import { api } from "../lib/api";
import type { AppSettings } from "@local-live-tutor/shared";

export type ProviderHealthState = {
  available: boolean;
  provider: string;
  model: string;
  detail?: string;
  vision: boolean;
};

type SettingsState = {
  settings: AppSettings | null;
  health: ProviderHealthState | null;
  loading: boolean;
  load: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  health: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const settings = await api.getSettings();
      set({ settings, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  refreshHealth: async () => {
    try {
      const result = await api.providerHealth();
      set({
        health: {
          available: result.primary.available,
          provider: result.effective.provider,
          model: result.effective.model,
          detail: result.primary.detail,
          vision: result.capabilities.vision,
        },
      });
    } catch {
      set({
        health: {
          available: false,
          provider: "unknown",
          model: "unknown",
          detail: "Backend unreachable. Is the server running?",
          vision: false,
        },
      });
    }
  },

  update: async (patch) => {
    const settings = await api.updateSettings(patch);
    set({ settings });
    await get().refreshHealth();
  },
}));
