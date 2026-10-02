/**
 * Study-link import (roadmap: Google Classroom / Moodle / any URL). Fetches a
 * study page server-side, reduces it to readable text, and — when a
 * vision-capable provider is available — lets the model shape it into the
 * same study-material JSON as photo uploads so the existing confirm gate
 * applies unchanged.
 *
 * SSRF guard: only http(s), hostname must resolve to a public address
 * (loopback, private ranges, and link-local are rejected), redirects are
 * followed manually with re-validation, body capped at 2 MB, timeout 15s.
 * This is a local app, but the fetcher is written as if hostile input could
 * reach it — the same care applies to pasted URLs from a classroom email.
 */
import { Errors } from "../../errors.js";
import type { ProviderRegistry } from "../llm/registry.js";
import { LINK_IMPORT_PROMPT } from "@local-live-tutor/shared";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type ImportedMaterial = {
  title: string;
  text: string;
  url: string;
};

/** Hostnames that must never be fetched (SSRF protection). */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return true;
  // Dotted-quad IPv4 literals: block loopback/private/link-local ranges.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast / reserved
  }
  // IPv6 loopback / unique-local / link-local literals.
  if (host.startsWith("[") || host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "");
    if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8")) return true;
  }
  return false;
}

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Errors.validation("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw Errors.validation("Only http(s) links can be imported.");
  }
  if (isBlockedHost(url.hostname)) {
    throw Errors.validation("This link points at a private address and can't be imported.");
  }
  return url;
}

/** Strips scripts/styles/nav to a readable plain-text body. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = m?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return raw ? raw.slice(0, 120) : undefined;
}

async function fetchPage(url: URL, depth = 0): Promise<{ body: string; finalUrl: string }> {
  if (depth > 2) throw Errors.validation("Too many redirects.");
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "LocalLiveTutor/1.0 (study link import)" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw Errors.validation("That page took too long to respond.");
    }
    throw Errors.validation("That page could not be reached.");
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw Errors.validation("The page redirected without a destination.");
    const next = new URL(location, url);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw Errors.validation("The page redirected to an unsupported address.");
    }
    if (isBlockedHost(next.hostname)) {
      throw Errors.validation("The page redirected to a private address and can't be imported.");
    }
    return fetchPage(next, depth + 1);
  }
  if (!response.ok) {
    throw Errors.validation(`The page responded with HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
    throw Errors.validation("That link is not a readable page (HTML or text).");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw Errors.validation("That page is too large to import (2 MB limit).");
  }
  return { body: new TextDecoder("utf-8").decode(buffer), finalUrl: url.toString() };
}

/**
 * Fetches and extracts the study material. With a vision-capable provider the
 * model shapes the text into {text,title}; otherwise the readable text is
 * returned as-is (the student still confirms it on the welcome board).
 */
export async function fetchStudyMaterial(
  rawUrl: string,
  registry: ProviderRegistry,
): Promise<ImportedMaterial> {
  const url = validateUrl(rawUrl);
  const { body, finalUrl } = await fetchPage(url);
  const title = extractTitle(body) ?? finalUrl;
  const text = htmlToText(body).slice(0, 20_000);
  if (text.length < 40) {
    throw Errors.validation(
      "Not enough readable text on that page — it may need a login. Try a public link, or upload a screenshot instead.",
    );
  }

  try {
    const { provider } = await registry.resolve();
    if (typeof provider.vision === "function") {
      // The shape-shaping call is text-only in nature; reuse chat with JSON.
      const response = await provider.chat({
        forceJson: true,
        temperature: 0.2,
        messages: [
          { role: "system", content: LINK_IMPORT_PROMPT },
          {
            role: "user",
            content: `Page title: ${title}\n\nPage text:\n${text.slice(0, 12_000)}`,
          },
        ],
      });
      const parsed = JSON.parse(response.content) as { text?: string; title?: string };
      if (parsed.text?.trim()) {
        return {
          text: parsed.text.trim().slice(0, 20_000),
          title: (parsed.title?.trim() || title).slice(0, 120),
          url: finalUrl,
        };
      }
    }
  } catch {
    // Shape-shaping is best-effort; fall through to the raw readable text.
  }
  return { title: title.slice(0, 120), text, url: finalUrl };
}
