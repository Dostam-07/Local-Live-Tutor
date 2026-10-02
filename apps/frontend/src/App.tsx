import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";

import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { ProviderStatusPill } from "./features/session/ProviderStatusPill";

export default function App() {
  const location = useLocation();
  const inWorkspace = /^\/sessions\/[^/]+$/.test(location.pathname);

  // Warm the provider status cache on load (PRD §12).
  useEffect(() => {
    void fetch("/api/providers/health").catch(() => undefined);
  }, []);

  return (
    <div className="flex h-full min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to lesson content
      </a>
      {/* Global chrome is hidden inside the workspace — the lesson is
          full-bleed with its own mockup header (ADR-0005). */}
      {!inWorkspace && (
        <header className="flex items-center justify-between gap-3 border-b border-paper-grid bg-surface px-4 py-3">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                location.pathname === "/"
                  ? "bg-tutor-blue text-white"
                  : "text-ink-soft hover:bg-paper hover:text-ink"
              }`}
            >
              New Session
            </Link>
            <Link
              to="/history"
              aria-current={location.pathname === "/history" ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                location.pathname === "/history"
                  ? "bg-tutor-blue text-white"
                  : "text-ink-soft hover:bg-paper hover:text-ink"
              }`}
            >
              My learning
            </Link>
            <Link
              to="/parent"
              aria-current={location.pathname === "/parent" ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                location.pathname === "/parent"
                  ? "bg-tutor-blue text-white"
                  : "text-ink-soft hover:bg-paper hover:text-ink"
              }`}
            >
              Parent view
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <ProfileSwitcher />
            <ProviderStatusPill />
            <Link
              to="/settings"
              className="rounded-lg border border-paper-grid px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-paper"
            >
              Settings
            </Link>
          </div>
        </header>
      )}
      <main
        id="main-content"
        className={`min-h-0 flex-1 ${inWorkspace ? "overflow-hidden" : "overflow-auto"}`}
      >
        <Outlet />
      </main>
    </div>
  );
}
