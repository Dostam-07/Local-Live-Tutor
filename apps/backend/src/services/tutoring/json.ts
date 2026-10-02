/**
 * Tolerant JSON extraction from model output (PRD §9 invalid-JSON handling).
 */

/** Removes markdown fences and trims whitespace. */
export function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  return candidate.trim();
}

/** Extracts the first balanced JSON object from text, if any. */
export function extractJsonObject(text: string): string | undefined {
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return undefined;
}

export function tryParseJsonObject(text: string): Record<string, unknown> | undefined {
  const candidate = extractJsonObject(text);
  if (!candidate) return undefined;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
