import { MAX_POV_WORDS } from "@prism/shared";

export interface GuardrailResult {
  ok: boolean;
  /** Human-readable reasons for failure (empty when ok). */
  violations: string[];
}

// Loaded, evaluative verbs/nouns the neutral base layer must avoid (FR-1, FR-11).
// The base layer states what happened and the magnitude, flatly.
const LOADED_TERMS = [
  "soared",
  "soar",
  "plunged",
  "plunge",
  "plummeted",
  "plummet",
  "skyrocketed",
  "crashed",
  "cratered",
  "tanked",
  "exploded",
  "collapsed",
  "fears",
  "panic",
  "euphoria",
  "stunning",
  "shocking",
  "spectacular",
  "disastrous",
  "devastating",
  "booming",
  "roaring",
];

// Concrete buy/sell/hold instructions a persona POV must never contain (FR-10).
// Matched as whole words to avoid false hits like "holding" or "selling pressure".
const ADVICE_PATTERNS: RegExp[] = [
  /\byou should (buy|sell|hold)\b/i,
  /\bi (recommend|advise) (buying|selling|holding)\b/i,
  /\b(buy|sell) (this|it|the stock|now)\b/i,
  /\bmy recommendation is\b/i,
  /\bprice target\b/i,
];

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

/** The neutral base layer must read flatly — no loaded, evaluative language. */
export function checkNeutralTone(text: string): GuardrailResult {
  const lower = text.toLowerCase();
  const hits = LOADED_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`).test(lower),
  );
  return {
    ok: hits.length === 0,
    violations: hits.map((t) => `loaded term: "${t}"`),
  };
}

/** Every POV must be plain English and within the hard word cap (FR-2). */
export function checkReadability(text: string): GuardrailResult {
  const words = countWords(text);
  const violations: string[] = [];
  if (words > MAX_POV_WORDS) {
    violations.push(`POV is ${words} words (limit ${MAX_POV_WORDS})`);
  }
  if (words === 0) {
    violations.push("POV is empty");
  } else if (words < 8 || !/[a-z]{3}/i.test(text)) {
    violations.push("POV is too short to be useful");
  }
  return { ok: violations.length === 0, violations };
}

/** No persona output may contain a concrete buy/sell/hold instruction (FR-10). */
export function checkNoAdvice(text: string): GuardrailResult {
  const hits = ADVICE_PATTERNS.filter((re) => re.test(text)).map(
    (re) => `advice pattern: ${re.source}`,
  );
  return { ok: hits.length === 0, violations: hits };
}

/**
 * Grounding: every stance must reference a key point that exists in the day's
 * briefing, and there must be exactly one stance per key point — no invented
 * events, no missing reads (FR-11).
 */
export function checkGrounding(
  stanceKeyPointIds: string[],
  validKeyPointIds: string[],
): GuardrailResult {
  const valid = new Set(validKeyPointIds);
  const seen = new Set<string>();
  const violations: string[] = [];

  for (const id of stanceKeyPointIds) {
    if (!valid.has(id)) violations.push(`stance references unknown key point: "${id}"`);
    if (seen.has(id)) violations.push(`duplicate stance for key point: "${id}"`);
    seen.add(id);
  }
  for (const id of validKeyPointIds) {
    if (!seen.has(id)) violations.push(`missing stance for key point: "${id}"`);
  }
  return { ok: violations.length === 0, violations };
}
