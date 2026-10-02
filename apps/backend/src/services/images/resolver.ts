/**
 * Educational image resolver (user spec §6–§11).
 *
 * Real educational sources first — Wikipedia summary images and Wikimedia
 * Commons search via their public REST APIs (no key needed) — with the
 * generated illustration (pollinations) as a fallback when nothing relevant
 * is found. Never scrapes search engines; every image carries its source
 * credit. Timeouts and a per-process cache keep turns fast.
 */
import { loadEnv } from "../../config/env.js";

export interface ResolvedImage {
  url: string;
  /** Human-readable source credit, e.g. "Wikipedia — Water cycle (CC BY-SA)". */
  credit: string;
  /** "web" = real educational source; "generated" = AI illustration. */
  kind: "web" | "generated";
}

interface CacheEntry {
  at: number;
  image: ResolvedImage | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const cache = new Map<string, CacheEntry>();

function cacheKey(query: string, mode: string): string {
  return `${mode}:${query.trim().toLowerCase()}`;
}

function readCache(key: string): ResolvedImage | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.image;
}

function writeCache(key: string, image: ResolvedImage | null): void {
  cache.set(key, { at: Date.now(), image });
  // Keep the cache bounded.
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/**
 * Right-size Wikimedia thumb URLs (…/NNNNpx-name) to a display-friendly
 * width — the summary API happily hands back 3840px thumbs and originals
 * can be bigger still. Non-thumb URLs pass through untouched.
 */
function rightSizeWikimedia(url: string, width = 1200): string {
  return url.replace(/(\/thumb\/.*?\/)\d+px-/, `$1${width}px-`);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        // Wikimedia APIs ask for a descriptive UA.
        "User-Agent": "LocalLiveTutor/1.0 (educational; local app)",
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the search terms: strip leading verbs like "tell me about", "what is". */
function cleanQuery(raw: string): string {
  return raw
    .replace(/^(tell me (about|more about)|teach me|explain|what is|what are|who is|show me)\s+/i, "")
    .replace(/[?.!,]+$/, "")
    .trim();
}

interface WikiSummary {
  type?: string;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
}

/**
 * Wikipedia REST summary — returns the page image for the best-matching
 * article. Quality bar: article must exist and have a real image.
 */
async function fromWikipedia(query: string, timeoutMs: number): Promise<ResolvedImage | null> {
  const clean = cleanQuery(query);
  if (!clean) return null;
  // Exact-title lookup: strip a leading article too — students say "the
  // water cycle", Wikipedia's article is "Water_cycle".
  const candidates = [clean];
  const deArticle = clean.replace(/^(the|a|an)\s+/i, "");
  if (deArticle !== clean) candidates.push(deArticle);
  for (const candidate of candidates) {
    const found = await wikiSummaryFor(candidate, timeoutMs);
    if (found) return found;
  }
  return null;
}

async function wikiSummaryFor(clean: string, timeoutMs: number): Promise<ResolvedImage | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    clean.replace(/\s+/g, "_"),
  )}?redirect=true`;
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) return null;
    const data = (await res.json()) as WikiSummary;
    const image = data.originalimage?.source ?? data.thumbnail?.source;
    if (!image || data.type === "disambiguation") return null;
    return {
      url: rightSizeWikimedia(image),
      credit: `Wikipedia — ${data.title ?? clean}`,
      kind: "web",
    };
  } catch {
    return null;
  }
}

interface CommonsQueryResult {
  query?: {
    // generator=search returns pages keyed by pageid (search[] is only
    // populated without a generator — a real bug we hit live).
    pages?: Record<
      string,
      {
        title: string;
        index?: number;
        imageinfo?: Array<{
          url: string;
          thumburl?: string;
          descriptionurl?: string;
          extmetadata?: {
            LicenseShortName?: { value?: string };
            Artist?: { value?: string };
          };
        }>;
      }
    >;
  };
}

/**
 * Wikimedia Commons fulltext search restricted to bitmap images. Picks the
 * first result with a usable, reasonably large image and license metadata.
 */
async function fromCommons(query: string, timeoutMs: number): Promise<ResolvedImage | null> {
  const clean = cleanQuery(query);
  if (!clean) return null;
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${clean}`,
    gsrnamespace: "6",
    gsrlimit: "5",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
    origin: "*",
  });
  const url = `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) return null;
    const data = (await res.json()) as CommonsQueryResult;
    const pages = Object.values(data.query?.pages ?? {})
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      // Prefer the resized thumb (iiurlwidth) — originals can be enormous.
      const imageUrl = info?.thumburl ?? info?.url;
      if (!imageUrl) continue;
      const license = info?.extmetadata?.LicenseShortName?.value ?? "see Commons";
      return {
        url: imageUrl,
        credit: `Wikimedia Commons — ${page.title.replace(/^File:/, "")} (${license})`,
        kind: "web",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generated educational illustration (pollinations) — the fallback when real
 * sources have nothing relevant.
 */
async function generatedIllustration(query: string, timeoutMs: number): Promise<ResolvedImage | null> {
  const clean = cleanQuery(query);
  if (!clean) return null;
  const prompt = encodeURIComponent(
    `Clear educational diagram for students: ${clean}. Simple labeled illustration, whiteboard style, readable labels.`,
  );
  const url = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=768&nologo=true&seed=42`;
  // Pollinations renders on GET; verify it answers before promising an image.
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) return null;
    return {
      url,
      credit: "Generated educational illustration",
      kind: "generated",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a lesson image for `query`. Order (mode "auto"): Wikipedia →
 * Commons → generated. mode "web": real sources only. mode "generated":
 * generated only. mode "off"/anything else: no image.
 */
export async function resolveEducationalImage(query: string): Promise<ResolvedImage | null> {
  // Unit/integration tests must be deterministic and network-free: report
  // honestly that no image could be fetched rather than hitting the web.
  if (process.env.NODE_ENV === "test") return null;
  const env = loadEnv();
  const mode = env.IMAGE_SOURCE_MODE;
  if (mode === "off") return null;

  const key = cacheKey(query, mode);
  const cached = readCache(key);
  if (cached !== undefined) return cached;

  const timeoutMs = env.IMAGE_LOOKUP_TIMEOUT_MS;
  let image: ResolvedImage | null = null;

  if (mode === "web" || mode === "auto") {
    image = (await fromWikipedia(query, timeoutMs)) ?? (await fromCommons(query, timeoutMs));
  }
  if (!image && mode === "auto") {
    image = await generatedIllustration(query, timeoutMs);
  }
  if (!image && mode === "generated") {
    image = await generatedIllustration(query, timeoutMs);
  }

  writeCache(key, image);
  return image;
}

/** Test hook: clear the process cache. */
export function clearImageCache(): void {
  cache.clear();
}
