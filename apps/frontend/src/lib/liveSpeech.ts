/**
 * Live speech (user spec: "the product and human talk to each other instead
 * of typing or voice transcription — like pengi.ai").
 *
 * The tutor's reply arrives as a JSON object streamed token by token. This
 * module watches the stream incrementally and pulls the "message" field out
 * WHILE it is still being generated, so complete sentences can be spoken the
 * moment they exist — the tutor starts talking ~1 sentence after it starts
 * thinking instead of after the entire response (which also contains chalk
 * ops and quiz data the student must never hear read aloud).
 *
 * Design constraints:
 * - push() receives raw stream DELTAS and accumulates internally.
 * - Tolerant of partial JSON at every step (every delta may split anywhere).
 * - Only the top-level "message" is spoken; a "message" field nested inside
 *   whiteboard_operations etc. is never read.
 * - Sentences are emitted only when COMPLETE; the final fragment flushes at
 *   stream end. Decimals (3.14), abbreviations (e.g., Dr.), and single
 *   initials never split.
 */

export type ScannedSentence = { text: string; end: number };

/**
 * Scans running text for COMPLETE sentences. Returns each sentence with the
 * offset just past its trailing separator (`end`), so callers can track how
 * much text has been consumed. Punctuation at the very end of `text` is NOT
 * a boundary yet (more text may follow — e.g. "3." of an incoming "3.5").
 */
export function scanSentences(text: string): ScannedSentence[] {
  const out: ScannedSentence[] = [];
  let start = 0;
  const ABBREV = /^(e\.g|i\.e|Dr|Mr|Mrs|Ms|vs|etc|approx|min|max|St|Jr|Sr)$/i;
  // Multilingual terminators (user bug: Hindi and CJK never split — the whole
  // lesson queued as one utterance or never spoke): danda । (Hindi), double
  // danda ॥, ideographic full stop 。 and ！？ (CJK).
  const isTerminator = (c: string) =>
    c === "." || c === "!" || c === "?" || c === "…" || c === "।" || c === "॥" || c === "。" || c === "！" || c === "？";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (!isTerminator(ch)) continue;
    // Decimal inside a number (3.14) — never a boundary.
    const prev = text[i - 1] ?? "";
    const nextCh = text[i + 1] ?? "";
    if (ch === "." && /\d/.test(prev) && /\d/.test(nextCh)) continue;
    // A Latin period at the very end waits for more text before deciding
    // ("3." of an incoming "3.5"). Unambiguous terminators (। ！ ？ 。 !)
    // close the sentence immediately — Hindi/CJK lessons must not lose their
    // final sentence just because the stream ended at the danda.
    if (ch === "." && i === text.length - 1) break;
    // Abbreviation (e.g.) or single initial (J.) — not a boundary.
    const before = text.slice(start, i + 1);
    const word = before.match(/([A-Za-z][A-Za-z.]*)\.$/);
    const token = word?.[1] ?? "";
    if (token && (ABBREV.test(token) || /^[A-Za-z]$/.test(token))) continue;
    // Consume the separator (spaces/newlines after the punctuation).
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j] ?? "")) j++;
    // CJK/Hindi sentences often run together WITHOUT spaces — a terminator
    // itself is enough to close a sentence; never wait for whitespace that
    // will not come (जैसे: "यह पानी है।अब हम आगे बढ़ें।").
    if (j >= text.length) {
      if (ch !== "." && ch !== "…") {
        const sentence = text.slice(start, i + 1).trim();
        if (sentence.length > 1) out.push({ text: sentence, end: i + 1 });
      }
      break; // separator still growing (or text ended at the terminator)
    }
    const sentence = text.slice(start, j).trim();
    if (sentence.length > 1) out.push({ text: sentence, end: j });
    start = j;
  }
  return out;
}

/** Public helper: just the completed sentence strings. */
export function completedSentences(text: string): string[] {
  return scanSentences(text).map((s) => s.text);
}

/**
 * Finds the character index just after the opening quote of the top-level
 * `key` string value. Only matches the key at depth 1 (inside the root
 * object), so a "message" inside an array element cannot hijack the scan.
 * Returns -1 when the key/value has not fully arrived yet.
 */
function findMessageValueStart(raw: string, key: string, from: number): number {
  const needle = `"${key}"`;
  let searchFrom = Math.max(0, from - needle.length - 2);
  while (searchFrom < raw.length) {
    const idx = raw.indexOf(needle, searchFrom);
    if (idx === -1) return -1;
    // Depth check: walk from the start tracking in-string state; only accept
    // the match at depth 1 (a direct member of the root object).
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < idx; i++) {
      const ch = raw[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") depth--;
      }
    }
    if (!inString && depth === 1) {
      // Walk past `key` : "
      let i = idx + needle.length;
      while (i < raw.length && /\s/.test(raw[i] ?? "")) i++;
      if (raw[i] !== ":") {
        searchFrom = idx + needle.length;
        continue;
      }
      i++;
      while (i < raw.length && /\s/.test(raw[i] ?? "")) i++;
      if (raw[i] === '"') return i + 1;
      return -1; // value is not a string; nothing to speak
    }
    searchFrom = idx + needle.length;
  }
  return -1;
}

/**
 * Decodes the body of a JSON string that starts at slice[0] (the opening
 * quote is already consumed). Returns the decoded text and how many chars of
 * the slice were consumed. A trailing partial \\uXX or lone backslash is left
 * unconsumed so the next push finishes it. `closed` = saw the closing quote.
 */
function decodeJsonStringBody(slice: string): {
  text: string;
  consumed: number;
  closed: boolean;
} {
  let out = "";
  let i = 0;
  while (i < slice.length) {
    const ch = slice[i];
    if (ch === '"') return { text: out, consumed: i, closed: true };
    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }
    // Escape sequence — needs 2+ chars (6 for \uXXXX).
    const next = slice[i + 1];
    if (next === undefined) return { text: out, consumed: i, closed: false };
    if (next === "u") {
      const hex = slice.slice(i + 2, i + 6);
      if (hex.length < 4) return { text: out, consumed: i, closed: false };
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const pair = next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
    out += pair;
    i += 2;
  }
  return { text: out, consumed: slice.length, closed: false };
}

/**
 * Feeds raw stream deltas and returns any NEWLY completed spoken sentences.
 */
export class LiveSpeechExtractor {
  private seen = 0;
  private valueStart = -1;
  private done = false;
  private pending = "";
  /** Consumed pending length (chars covered by already-emitted sentences). */
  private emittedChars = 0;
  private emittedCount = 0;
  private buffer = "";

  constructor(private readonly key = "message") {}

  /** Human-audible text extracted so far (everything, spoken or not). */
  get spoken(): string {
    return this.pending.trim();
  }

  /**
   * Feed the next raw stream DELTA (the SSE `delta` text). Internally
   * accumulates, so callers just forward each chunk. Returns sentences
   * completed since the last call, in order.
   */
  push(delta: string): string[] {
    if (this.done) return [];
    this.buffer += delta;
    const raw = this.buffer;
    if (raw.length <= this.seen) return [];

    if (this.valueStart === -1) {
      const idx = findMessageValueStart(raw, this.key, this.valueStartScannedUpTo());
      if (idx === -1) {
        // Keep a tail so a key split across deltas is found once complete.
        this.seen = Math.max(0, raw.length - 64);
        return [];
      }
      this.valueStart = idx;
      this.seen = idx;
    }

    // Decode the raw slice [seen, end) up to the closing quote.
    const slice = raw.slice(this.seen);
    const { text, consumed, closed } = decodeJsonStringBody(slice);
    this.seen = this.seen + consumed;
    if (closed) this.done = true;

    this.pending += text;
    const all = scanSentences(this.pending);
    const fresh = all.slice(this.emittedCount);
    this.emittedCount = all.length;
    const last = all[all.length - 1];
    if (last) {
      this.emittedChars = last.end;
    }
    return fresh.map((s) => s.text);
  }

  /** Where the key scan should resume (never rescan from 0 every delta). */
  private valueStartScannedUpTo(): number {
    return Math.max(0, this.seen);
  }

  /** Whatever remains after the stream ends (final partial sentence). */
  flush(): string | null {
    const rest = this.pending.slice(this.emittedChars).trim();
    this.done = true;
    return rest.length > 0 ? rest : null;
  }
}
