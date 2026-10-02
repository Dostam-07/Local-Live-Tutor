/**
 * Visual direction: PRD §10 paper palette for chrome, plus the chalkboard
 * lesson theme (ADR-0005) for the session workspace.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FFFEF8",
        "paper-grid": "#E5E7EB",
        ink: "#1F2937",
        "ink-soft": "#4B5563",
        "tutor-blue": "#2563EB",
        "student-red": "#DC2626",
        highlight: "#F59E0B",
        surface: "#FFFFFF",
        // Chalkboard (ADR-0005).
        board: "#243B35",
        "board-deep": "#1B2E29",
        "board-frame": "#8B5E34",
        "chalk": "#F4F7F2",
        "chalk-yellow": "#FBD870",
        "chalk-pink": "#F9A8C2",
        "chalk-blue": "#9CC8F0",
        "chalk-dim": "rgba(244,247,242,0.62)",
      },
      fontFamily: {
        sans: [
          "Atkinson Hyperlegible",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      backgroundImage: {
        "grid-paper":
          "linear-gradient(to right, rgba(229,231,235,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(229,231,235,0.6) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-24": "24px 24px",
      },
      boxShadow: {
        panel: "0 1px 3px rgba(31,41,55,0.08), 0 4px 14px rgba(31,41,55,0.06)",
      },
    },
  },
  plugins: [],
};
