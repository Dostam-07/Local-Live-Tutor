import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import "./index.css";

import App from "./App";
import WelcomeBoardPage from "./features/session/WelcomeBoardPage";
import WorkspacePage from "./features/session/WorkspacePage";
import SettingsPage from "./features/settings/SettingsPage";
import HistoryPage from "./features/history/HistoryPage";
import ParentPage from "./features/parent/ParentPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      // Welcome board: greet without creating anything; the session is born
      // only when the student's first words or upload arrive.
      { index: true, element: <WelcomeBoardPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "parent", element: <ParentPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "sessions/:sessionId", element: <WorkspacePage /> },
    ],
  },
]);

// Always land on the welcome board. The student's first message or upload
// is what creates a session (ADR-0006) — no idle visits create empty sessions,
// and closing/reopening the tab always returns to the greeting, never to
// history or a stale session page.
if (window.location.pathname !== "/" && !window.location.pathname.startsWith("/sessions/")) {
  window.history.replaceState(null, "", "/");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
