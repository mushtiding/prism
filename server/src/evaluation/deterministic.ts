import type { KeyPoint, PersonaDef, PersonaPOV, Stance } from "@prism/shared";
import {
  checkGrounding,
  checkNoAdvice,
  checkReadability,
  countWords,
} from "../domain/guardrails.js";

const FINANCE_JARGON = [
  "alpha",
  "basis point",
  "beta",
  "breakout",
  "carry trade",
  "duration",
  "ebitda",
  "free cash flow",
  "liquidity",
  "multiple expansion",
  "risk-on",
  "risk-off",
  "tail risk",
  "the tape",
  "yield curve",
];

export interface DeterministicEvaluation {
  qaPass: boolean;
  qaCodes: string[];
  wordCount: number;
  sentenceCount: number;
  averageSentenceWords: number;
  longestSentenceWords: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  jargonCount: number;
  stanceCoverage: number;
  labelScoreConflicts: number;
  duplicateOfFirst: boolean;
}

function sentences(text: string): string[] {
  return (
    text
      .trim()
      .match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? []
  );
}

function syllablesInWord(value: string): number {
  const word = value.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  if (word.length <= 3) return 1;
  const withoutSilentEnding = word
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/i, "")
    .replace(/^y/, "");
  return Math.max(1, withoutSilentEnding.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}

function readability(text: string): {
  ease: number;
  grade: number;
  sentenceCount: number;
  averageSentenceWords: number;
  longestSentenceWords: number;
} {
  const sentenceList = sentences(text);
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  const sentenceCount = Math.max(1, sentenceList.length);
  const wordCount = Math.max(1, words.length);
  const syllables = words.reduce((sum, word) => sum + syllablesInWord(word), 0);
  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = syllables / wordCount;
  const lengths = sentenceList.map((sentence) => countWords(sentence));

  return {
    ease: Number((206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord).toFixed(2)),
    grade: Number((0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59).toFixed(2)),
    sentenceCount: sentenceList.length,
    averageSentenceWords: Number(wordsPerSentence.toFixed(2)),
    longestSentenceWords: lengths.length > 0 ? Math.max(...lengths) : 0,
  };
}

function labelScoreConflict(stance: Stance): boolean {
  if (!Number.isInteger(stance.score) || stance.score < -2 || stance.score > 2) return true;
  if (!(["bullish", "neutral", "bearish"] as string[]).includes(stance.label)) return true;
  return (
    (stance.score < 0 && stance.label !== "bearish") ||
    (stance.score === 0 && stance.label !== "neutral") ||
    (stance.score > 0 && stance.label !== "bullish")
  );
}

function comparableText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function evaluateDeterministically(
  pov: PersonaPOV,
  keyPoints: KeyPoint[],
  persona: PersonaDef,
  firstPov?: PersonaPOV,
): DeterministicEvaluation {
  const requiredIds = keyPoints.map((keyPoint) => keyPoint.id);
  const grounding = checkGrounding(
    pov.stances.map((stance) => stance.keyPointId),
    requiredIds,
  );
  const readable = checkReadability(pov.text);
  const advice = checkNoAdvice(
    [pov.text, ...pov.stances.map((stance) => stance.rationale ?? "")].join(" "),
  );
  const conflicts = pov.stances.filter(labelScoreConflict).length;
  const duplicateOfFirst = Boolean(
    firstPov && comparableText(firstPov.text) === comparableText(pov.text),
  );
  const activeBiasMissing = !pov.activeBias.trim();
  const knownPersona = pov.personaId === persona.id;
  const qaCodes = [
    ...readable.violations.map(() => "readability"),
    ...advice.violations.map(() => "advice_violation"),
    ...grounding.violations.map((violation) =>
      violation.startsWith("missing")
        ? "stance_missing"
        : violation.startsWith("duplicate")
          ? "stance_duplicate"
          : "grounding_failure",
    ),
    ...(conflicts > 0 ? ["label_score_conflict"] : []),
    ...(activeBiasMissing ? ["active_bias_missing"] : []),
    ...(!knownPersona ? ["persona_mismatch"] : []),
    ...(duplicateOfFirst ? ["duplicate_second_view"] : []),
  ];
  const uniqueStanceIds = new Set(
    pov.stances
      .map((stance) => stance.keyPointId)
      .filter((id) => requiredIds.includes(id)),
  );
  const reading = readability(pov.text);
  const lower = pov.text.toLowerCase();
  const jargonCount = FINANCE_JARGON.reduce(
    (count, term) => count + (lower.includes(term) ? 1 : 0),
    0,
  );

  return {
    qaPass: qaCodes.length === 0,
    qaCodes: [...new Set(qaCodes)],
    wordCount: countWords(pov.text),
    sentenceCount: reading.sentenceCount,
    averageSentenceWords: reading.averageSentenceWords,
    longestSentenceWords: reading.longestSentenceWords,
    fleschReadingEase: reading.ease,
    fleschKincaidGrade: reading.grade,
    jargonCount,
    stanceCoverage:
      requiredIds.length === 0 ? 1 : uniqueStanceIds.size / requiredIds.length,
    labelScoreConflicts: conflicts,
    duplicateOfFirst,
  };
}
