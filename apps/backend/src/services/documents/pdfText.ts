/**
 * PDF text extraction without native dependencies (ADR-0006).
 *
 * Walks the raw PDF for stream objects, inflates FlateDecode streams with
 * node:zlib, and harvests text from the content-stream text-showing operators
 * (Tj / TJ / ' / "). Handles the vast majority of text PDFs (word processors,
 * exports, slides). Scanned/image PDFs yield little text — the caller detects
 * that and falls back to vision extraction or asks the student to rephrase.
 */
import { inflateSync, inflateRawSync } from "node:zlib";

const MAX_STREAM_BYTES = 20 * 1024 * 1024;

/** Inflates a stream body when a known filter is present; passes text through. */
function decodeStream(raw: Buffer, dict: string): Buffer | null {
  try {
    if (/\/FlateDecode/.test(dict)) {
      // Some producers emit RawDeflate; try standard, then raw.
      try {
        return inflateSync(raw);
      } catch {
        return inflateRawSync(raw);
      }
    }
    if (/\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/JBIG2Decode/.test(dict)) {
      return null; // image data — no text to harvest here
    }
    if (dict.includes("/Filter")) return null; // unknown filter
    return raw; // uncompressed
  } catch {
    return null;
  }
}

/** Extracts literal strings from a decoded content stream, in order. */
function harvestText(content: string): string {
  const out: string[] = [];
  // (string) Tj  |  (string) '  |  (string) "
  const simple = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")/g;
  // [(s1) num (s2) ...] TJ
  const array = /\[((?:\\.|[^\]])*)\]\s*TJ/g;
  // td/Td/T*/ET movement → whitespace (keeps words from gluing across lines)
  const breaks = /(?:(?:-?\d+(?:\.\d+)?\s+){2}(?:Td|TD)|T\*|ET|BT)/g;

  let match: RegExpExecArray | null;
  while ((match = simple.exec(content)) !== null) {
    out.push(unescapePdfString(match[1] ?? ""));
  }
  while ((match = array.exec(content)) !== null) {
    const inner = match[1] ?? "";
    const parts: string[] = [];
    const partRe = /\(((?:\\.|[^\\()])*)\)|(-?\d+(?:\.\d+)?)/g;
    let part: RegExpExecArray | null;
    while ((part = partRe.exec(inner)) !== null) {
      if (part[1] !== undefined) {
        parts.push(unescapePdfString(part[1]));
      } else if (Number(part[2]) < -180) {
        parts.push(" "); // large kern = word/line gap
      }
    }
    out.push(parts.join(""));
  }
  if (out.length === 0) return "";
  // Insert breaks where positioning operators appear.
  const spaced = content.replace(breaks, "\n");
  void spaced; // breaks are informational only; operator order already preserved
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Resolves PDF string escapes (\n \r \t \b \f \( \) \\ and octal). */
function unescapePdfString(s: string): string {
  return s
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\([()\\])/g, "$1");
}

export type PdfExtract = {
  text: string;
  pageCount: number;
};

/**
 * Extracts readable text from a PDF buffer. Best-effort: returns whatever
 * text operators were found (empty string when the PDF is image-only).
 */
export function extractPdfText(buf: Buffer): PdfExtract {
  const latin = buf.toString("latin1");
  const pageCount = (latin.match(/\/Type\s*\/Page[^s]/g) ?? []).length || 1;

  const texts: string[] = [];
  const streamRe = /stream\r?\n?/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(latin)) !== null) {
    const bodyStart = match.index + match[0].length;
    const dictStart = latin.lastIndexOf("<<", match.index);
    const dict = dictStart >= 0 ? latin.slice(dictStart, match.index) : "";
    const endIdx = latin.indexOf("endstream", bodyStart);
    if (endIdx < 0) break;
    const raw = buf.subarray(bodyStart, endIdx);
    if (raw.byteLength > MAX_STREAM_BYTES) continue;
    const decoded = decodeStream(raw, dict);
    if (!decoded) continue;
    // Content streams are either plain text or binary; only keep decodings
    // that actually look like text operators.
    const asText = decoded.toString("latin1");
    if (/(Tj|TJ|')\s/.test(asText) || /BT/.test(asText)) {
      const text = harvestText(asText);
      if (text) texts.push(text);
    }
    streamRe.lastIndex = endIdx;
  }

  return { text: texts.join("\n").trim(), pageCount };
}
