/**
 * Language support (roadmap: multilingual lessons). Maps the shared
 * LessonLanguage codes to BCP-47 tags for the Web Speech APIs:
 * SpeechRecognition.lang (STT) and SpeechSynthesisUtterance.lang + voice
 * filtering (TTS). "auto" resolves to the browser UI language, which is the
 * best guess for the language the student is actually speaking.
 */

import type { LessonLanguage } from "@local-live-tutor/shared";
import { pickTutorVoice } from "./tutorVoice";

export const STT_LANG_TAGS: Record<Exclude<LessonLanguage, "auto">, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hi: "hi-IN",
  pt: "pt-BR",
  it: "it-IT",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  ar: "ar-SA",
  he: "he-IL",
  ru: "ru-RU",
};

/** The STT language tag for a lesson-language preference. */
export function sttLangTag(language: LessonLanguage | undefined): string {
  if (!language || language === "auto") {
    // The browser UI language — the student's most likely spoken language.
    return typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
  }
  return STT_LANG_TAGS[language];
}

/** Primary subtag ("es" from "es-ES") for voice matching. */
function primaryTag(bcp47: string): string {
  return bcp47.split("-")[0]?.toLowerCase() ?? bcp47.toLowerCase();
}

/**
 * Picks the best TTS voice for the lesson language AND gender preference.
 * Language-first (user bug: a pinned Hindi lesson was spoken by an English
 * voice — unintelligible): exact language+gender → language only → NULL.
 * Never returns a voice that cannot pronounce the lesson language; the
 * caller then sets `utterance.lang` so the OS picks a native voice. For the
 * implicit "auto" language, falls back to the English tutor-voice picker.
 */
export function pickTutorVoiceForLanguage(
  language: LessonLanguage | undefined,
  gender: "female" | "male" | "auto",
): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (!language || language === "auto") return null; // auto → resolveTutorVoice below
  const tag = sttLangTag(language);
  const primary = primaryTag(tag);
  const voices = window.speechSynthesis.getVoices();
  const sameLang = voices.filter((v) => primaryTag(v.lang) === primary);
  if (sameLang.length === 0) return null; // never a wrong-language voice

  if (gender !== "auto") {
    const female = /female|zira|hazel|samantha|victoria|karen|moira|tessa|fiona|serena|allison|ava|joanna|kendra|kimberly|salli|nicole|amy|emma|aria|jenny|michelle|elsa|sonia|libby|maisie|clara|natasha|kalpana|hemant|madhur|swara/i;
    const male = /male|david|mark|james|george|ryan|guy|eric|brian|arthur|daniel|alex|fred|tom|richard|christopher|roger|william|rishi|liam|noah|oliver|thomas|hemant|madhur/i;
    const marker = gender === "female" ? female : male;
    const matched = sameLang.find((v) => marker.test(v.name) && !(gender === "male" && /female/i.test(v.name)));
    if (matched) return matched;
  }
  return sameLang.find((v) => /natural|online|neural/i.test(v.name)) ?? sameLang.find((v) => v.default) ?? sameLang[0] ?? null;
}

/**
 * Single voice-resolution entry point for every TTS path: pinned language →
 * a native voice for THAT language (or null → the caller sets the lang tag);
 * auto → the language picker's neutral answer, then the English-gender
 * picker (the historical default for auto/matching-the-student lessons).
 */
export function resolveTutorVoice(
  language: LessonLanguage | undefined,
  gender: "female" | "male" | "auto",
): SpeechSynthesisVoice | null {
  const pinned = pickTutorVoiceForLanguage(language, gender);
  if (pinned) return pinned;
  if (!language || language === "auto") {
    return pickTutorVoiceForLanguage(undefined, gender) ?? pickTutorVoice(gender);
  }
  return null;
}
