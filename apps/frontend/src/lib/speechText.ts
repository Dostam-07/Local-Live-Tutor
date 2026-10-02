/**
 * Speech representation layer (user spec §5–§7): the blackboard keeps EXACT
 * notation; the voice gets a SEPARATE, speech-optimized rendering. Raw board
 * text is never sent to TTS.
 *
 *   `√25 = 5`        → "the square root of 25 equals 5"
 *   `x² + 3`         → "x squared plus 3"
 *   `**Step 1:**`    → (dropped — structure becomes pacing, not words)
 *   `Problem: 2x+4=10` → "the problem: 2 x plus 4 equals 10"
 *   `✗ Not quite —`  → "not quite —"
 *   `(Marked: …)`    → (dropped — internal metadata)
 *   Hindi pinned:    `2x + 4 = 10` → "2 x जमा 4 बराबर 10"
 *   (math connector words follow the pinned lesson language; "auto" → English)
 *
 * The output is plain natural sentences with real pauses — the TTS engine
 * then reads it like a person, not like a screen reader.
 */

/**
 * Symbols spoken as words — per lesson language (user bug: a Hindi lesson was
 * interrupted by English math words like "equals"/"plus"; now only the
 * symbols with no native pronunciation are wordified, and the connector words
 * follow the lesson language). `undefined`/"auto" → English.
 */
const MATH_WORDS_BY_LANG: Record<string, { equals: string; plus: string; minus: string; times: string; dividedBy: string; sqrtOf: string; squared: string; cubed: string }> = {
  en: { equals: " equals ", plus: " plus ", minus: " minus ", times: " times ", dividedBy: " divided by ", sqrtOf: " the square root of ", squared: " squared", cubed: " cubed" },
  es: { equals: " es igual a ", plus: " más ", minus: " menos ", times: " por ", dividedBy: " dividido por ", sqrtOf: " la raíz cuadrada de ", squared: " al cuadrado", cubed: " al cubo" },
  fr: { equals: " égale ", plus: " plus ", minus: " moins ", times: " fois ", dividedBy: " divisé par ", sqrtOf: " la racine carrée de ", squared: " au carré", cubed: " au cube" },
  de: { equals: " ist gleich ", plus: " plus ", minus: " minus ", times: " mal ", dividedBy: " geteilt durch ", sqrtOf: " die Quadratwurzel aus ", squared: " zum Quadrat", cubed: " zum Kubik" },
  hi: { equals: " बराबर ", plus: " जमा ", minus: " घटा ", times: " गुणा ", dividedBy: " भाग ", sqrtOf: " का वर्गमूल ", squared: " का वर्ग", cubed: " का घन" },
  pt: { equals: " é igual a ", plus: " mais ", minus: " menos ", times: " vezes ", dividedBy: " dividido por ", sqrtOf: " a raiz quadrada de ", squared: " ao quadrado", cubed: " ao cubo" },
  it: { equals: " uguale a ", plus: " più ", minus: " meno ", times: " per ", dividedBy: " diviso ", sqrtOf: " la radice quadrata di ", squared: " al quadrado", cubed: " al cubo" },
  ar: { equals: " يساوي ", plus: " زائد ", minus: " ناقص ", times: " مضروب في ", dividedBy: " مقسوم على ", sqrtOf: " الجذر التربيعي لـ ", squared: " تربيع", cubed: " مكعب" },
  he: { equals: " שווה ל ", plus: " ועוד ", minus: " פחות ", times: " כפול ", dividedBy: " חלקי ", sqrtOf: " השורש הריבועי של ", squared: " בריבוע", cubed: " בקובייה" },
  ru: { equals: " равно ", plus: " плюс ", minus: " минус ", times: " умножить на ", dividedBy: " разделить на ", sqrtOf: " квадратный корень из ", squared: " в квадрате", cubed: " в кубе" },
  // Character-based languages keep the math in symbols: TTS engines voice
  // ＋－＝×÷ natively in zh/ja/ko, so no word injection is needed.
  zh: { equals: "＝", plus: "＋", minus: "－", times: "×", dividedBy: "÷", sqrtOf: "√", squared: "²", cubed: "³" },
  ja: { equals: "＝", plus: "＋", minus: "－", times: "×", dividedBy: "÷", sqrtOf: "√", squared: "²", cubed: "³" },
  ko: { equals: "＝", plus: "＋", minus: "－", times: "×", dividedBy: "÷", sqrtOf: "√", squared: "²", cubed: "³" },
};

function mathWords(language: string | undefined) {
  return MATH_WORDS_BY_LANG[language ?? "en"] ?? MATH_WORDS_BY_LANG.en!;
}

/**
 * Fraction bars inside math ("3/4") become "three quarters"-style speech.
 * Only TRUE fractions qualify (numerator < denominator, small whole numbers):
 * "10 / 2" is a division and stays for the divided-by pass. Returns null when
 * the expression should keep its slash.
 */
function speakFraction(num: string, den: string): string | null {
  const NUM_WORDS: Record<string, string> = {
    "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine",
  };
  const DEN_WORDS: Record<string, string> = {
    "2": "half", "3": "third", "4": "quarter", "5": "fifth",
    "6": "sixth", "8": "eighth", "10": "tenth", "16": "sixteenth", "100": "hundredth",
  };
  const n = Number(num);
  const d = Number(den);
  if (!NUM_WORDS[num] || !DEN_WORDS[den] || n >= d) return null;
  const denWord = DEN_WORDS[den]!;
  if (n === 1) return ` one ${denWord} `;
  const plural = denWord === "half" ? "halves" : `${denWord}s`;
  return ` ${NUM_WORDS[num]} ${plural} `;
}

/** Reads an equation/inequality with natural math words in the lesson language. */
function speakMathExpression(expr: string, words: ReturnType<typeof mathWords>, isCjk: boolean): string {
  let out = expr;
  // LaTeX remnants the chalk renderer already flattens — speak them too.
  out = out.replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, ` $1 ${isCjk ? "÷" : words.dividedBy} $2 `);
  out = out.replace(/\\sqrt\s*\{([^}]+)\}/g, `${isCjk ? "√" : words.sqrtOf}$1 `);
  out = out.replace(/\\times/g, isCjk ? "×" : words.times);
  out = out.replace(/\\div/g, isCjk ? "÷" : words.dividedBy);
  out = out.replace(/\\cdot/g, isCjk ? "×" : words.times);
  out = out.replace(/[{}\\$]/g, " ");
  // Symbol → words (per language): √ ² ³ and native operators. CJK keeps
  // the symbols (engines voice ＋＝×÷ natively).
  if (!isCjk) {
    out = out.replace(/√/g, words.sqrtOf).replace(/²/g, words.squared).replace(/³/g, words.cubed);
    out = out.replace(/÷/g, words.dividedBy).replace(/×/g, words.times).replace(/[−–]/g, words.minus);
  }
  // Fractions with small numbers → words ("3/4" → "three quarters").
  // Latin-script languages only — Devanagari/Arabic/CJK digits stay as-is.
  if (!isCjk && languageUsesLatinFractions(expr)) {
    out = out.replace(/\b(\d{1,2})\s*\/\s*(\d{1,3})\b/g, (m, n: string, d: string) =>
      speakFraction(n, d) ?? m,
    );
    // A slash between digits (or digit/letter tokens) is division: "180/2" →
    // "180 divided by 2". Prose slashes (and/or) are left alone.
    out = out.replace(/(?<=[0-9a-zA-Z])\s*\/\s*(?=[0-9a-zA-Z])/g, words.dividedBy);
  }
  // Operators → per-language connector words. CJK: native full-width math
  // symbols the engine voices natively.
  if (isCjk) {
    out = out.replace(/\s*=\s*/g, words.equals).replace(/\s*\+\s*/g, words.plus).replace(/(?<=[0-9）)])\s*-\s*(?=[0-9（])/g, words.minus).replace(/\s*\*\s*/g, words.times);
  } else {
    out = out.replace(/\s*=\s*/g, words.equals);
    out = out.replace(/\s*\+\s*/g, words.plus);
    out = out.replace(/\s*-\s*/g, words.minus);
    out = out.replace(/\s*\*\s*/g, words.times);
  }
  // "2x" → "2 x" so TTS says "two ex", not "tox" (Latin letters only).
  out = out.replace(/\b(\d+)([a-zA-Z])\b/g, "$1 $2");
  return out.replace(/\s+/g, " ").trim();
}

/** Fractions-to-words only makes sense for Latin-script lessons. */
function languageUsesLatinFractions(expr: string): boolean {
  return /[0-9]/.test(expr) && !/[\u0900-\u097F\u0600-\u06FF\u0400-\u04FF]/.test(expr);
}

/**
 * True when the segment looks like math (dominated by digits/operators) and
 * benefits from symbol-by-symbol reading rather than prose handling.
 */
function looksLikeMath(segment: string): boolean {
  const mathChars = (segment.match(/[0-9=+\-*/×÷√²³π^]/g) ?? []).length;
  const letters = (segment.match(/[a-zA-Z]{3,}/g) ?? []).length;
  return mathChars >= 2 && letters <= 2 && /\d|\b[a-z]\s*=|\bx\b/.test(segment);
}

// looksLikeMath is retained for callers/tests that classify segments; the
// line-level pipeline in toSpeechText uses the simpler "line contains math
// chars" test because speakMathExpression is word-preserving.
void looksLikeMath;

/**
 * Converts UI labels, verdict glyphs, and markdown into natural speech.
 * `language` is the pinned lesson language (undefined/"auto" = English math
 * words). Returns the text to speak.
 */
export function toSpeechText(raw: string, language?: string): string {
  let text = raw ?? "";
  const words = mathWords(language);
  const isCjk = language === "zh" || language === "ja" || language === "ko";

  // ---- 1. Drop things that must never be spoken ----
  // Internal/meta annotations.
  text = text.replace(/\(Marked:[^)]*\)/gi, " ");
  text = text.replace(/\[Quiz question[^\]]*\]/gi, " ");
  // Markdown headings/bold/italics/bullets — structure, not words.
  text = text.replace(/^#{1,6}\s*/gm, " ");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/^\s*[-•*]\s+/gm, " ");
  // URLs (the tutor never reads web addresses aloud).
  text = text.replace(/https?:\/\/\S+/g, " this picture ");
  // Code blocks read as "…".
  text = text.replace(/```[\s\S]*?```/g, " ");
  // UI prefix labels on echoed chalk.
  text = text.replace(/^\s*(You|Problem|Quiz)\s*:\s*/gim, (m, label: string) => {
    const lower = String(label).toLowerCase();
    if (lower === "problem") return "the problem: ";
    if (lower === "quiz") return "quiz time: ";
    return ""; // "You: " — the student knows they said it
  });

  // ---- 2. Verdict glyphs → natural words ----
  if (isCjk) {
    // CJK engines read ✓/✗ poorly too — convert to the language's words.
    text = text.replace(/[✓✔]/g, language === "ja" ? "正解。" : language === "ko" ? "정답. " : "正确。 ");
    text = text.replace(/[✗✘]/g, language === "ja" ? "惜しい。" : language === "ko" ? "아쉽네요. " : "不对。 ");
  } else {
    text = text.replace(/[✓✔]/g, " correct. ");
    text = text.replace(/[✗✘]/g, " not quite. ");
  }
  text = text.replace(/─+/g, " "); // section dividers

  // ---- 3. Math → words ----
  // Line-by-line: a line that CONTAINS math gets the full math treatment
  // (speakMathExpression only rewrites symbols/operators — prose words pass
  // through untouched); pure-prose lines keep their natural rhythm and only
  // get the inline symbol conversions (√, ², ×, …).
  text = text
    .split("\n")
    .map((line) => {
      if (/[0-9=+\-*/×÷√²³π]/.test(line)) return speakMathExpression(line, words, isCjk);
      let l = line;
      // Symbol-only substitutions that are safe in every language (√ ² ³ °
      // ÷ × − ≤ ≥ ≠ ≈ ½ …); connector words stay per-language via the math
      // pass above. In CJK the symbols are kept native.
      if (!isCjk) {
        l = l.replace(/√/g, words.sqrtOf).replace(/²/g, words.squared).replace(/³/g, words.cubed);
        l = l.replace(/÷/g, words.dividedBy).replace(/×/g, words.times).replace(/[−–]/g, words.minus);
      }
      return l;
    })
    .join("\n");

  // ---- 4. Sentence spacing: real pauses between steps ----
  // "Step 1: … Step 2: …" → two sentences with a pause, never one run-on.
  text = text.replace(/\b(Step\s+\d+|First|Second|Third|Next|Finally|Now)\s*:\s*/gi, "$1. ");
  // Numbered lists → sentences.
  text = text.replace(/^\s*(\d+)[.)]\s+/gm, " ");
  // Collapse whitespace; keep paragraph breaks as long pauses.
  text = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(".  .  .  "); // ellipsis-ish long pause between paragraphs

  // ---- 5. Punctuation the engine should NOT pronounce ----
  // Question/exclamation marks stay (engines voice them as intonation), but
  // stray symbols and repeated punctuation become pauses.
  text = text.replace(/([.!?]){2,}/g, "$1");
  text = text.replace(/[:;]\s*/g, ". ");
  text = text.replace(/,\s*(?=[a-z]*\d)/g, ", "); // keep numeric commas
  text = text.replace(/\s{2,}/g, " ").trim();

  return text;
}

/**
 * Speech chunks: splits spoken text into short, natural breath-groups. Each
 * chunk becomes one utterance with a small pause after it (the SpeechQueue
 * inserts the pause) — this is what makes the tutor sound like it is
 * explaining, not racing through a paragraph. `language` flows into the math
 * conversion (Hindi lesson → "बराबर", not "equals"). The sentence regex
 * includes the Hindi danda and CJK terminators.
 */
export function toSpeechChunks(text: string, maxLen = 180, language?: string): string[] {
  const clean = toSpeechText(text, language);
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…।॥。！？]+[.!?…।॥。！？]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}
