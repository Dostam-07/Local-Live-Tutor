import { useEffect } from "react";

import { StatusPill } from "../../components/ui";
import { useSettingsStore } from "../../stores/settingsStore";

/** Provider/model status (PRD §10 header, §12 capability display). */
export function ProviderStatusPill() {
  const health = useSettingsStore((s) => s.health);
  const refreshHealth = useSettingsStore((s) => s.refreshHealth);

  useEffect(() => {
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 15_000);
    return () => window.clearInterval(interval);
  }, [refreshHealth]);

  if (!health) return null;
  return (
    <StatusPill
      tone={health.available ? "ok" : "error"}
      title={health.detail ?? `Provider: ${health.provider} · Model: ${health.model}`}
    >
      <span
        aria-hidden
        className={`inline-block h-2 w-2 rounded-full ${health.available ? "bg-green-600" : "bg-red-600"}`}
      />
      {health.provider} · {health.model}
    </StatusPill>
  );
}
