import { describe, expect, it } from "vitest";

import { renderMath, renderTextWithMath } from "../src/lib/katex";

describe("renderMath", () => {
  it("renders simple LaTeX to HTML", () => {
    const html = renderMath("\\frac{3}{4}");
    expect(html).toContain("katex");
    expect(html).toContain("3");
  });

  it("falls back to escaped text on failure", () => {
    const html = renderMath("\\notacommand{");
    expect(html).not.toContain("<script");
  });
});

describe("renderTextWithMath", () => {
  it("renders $inline$ math inside text", () => {
    const html = renderTextWithMath("Add $\\frac{3}{4}$ and 1/2.");
    expect(html).toContain("katex");
    expect(html).toContain(" and 1/2.");
  });

  it("renders $$display$$ math", () => {
    const html = renderTextWithMath("$$x^2$$");
    expect(html).toContain("katex-display");
  });

  it("escapes HTML before math substitution", () => {
    const html = renderTextWithMath("<script>alert(1)</script> $1+1$");
    expect(html).not.toContain("<script>");
    expect(html).toContain("alert(1)");
  });
});
