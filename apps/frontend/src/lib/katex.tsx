import katex from "katex";

/** Renders LaTeX to HTML; returns escaped text on failure (never throws). */
export function renderMath(latex: string, displayMode = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return latex.replace(/[<>&]/g, (c) =>
      c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
    );
  }
}

/**
 * Renders chat text containing $...$ (inline) and $$...$$ (display) math.
 */
export function renderTextWithMath(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_match, display, inline) =>
    renderMath(display ?? inline, Boolean(display)),
  );
}
