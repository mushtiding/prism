import {
  DISCLAIMER,
  type DayContent,
  type KeyPoint,
  type PersonaPOV,
  type Source,
  type StanceLabel,
} from "@prism/shared";
import type { LlmClient } from "../providers/llm.js";
import type { MarketDataProvider } from "../providers/marketData.js";
import { PERSONA_LIST } from "../domain/personas.js";
import {
  computeDayDivergence,
  withKeyPointDivergence,
} from "../domain/divergence.js";
import {
  checkGrounding,
  checkNeutralTone,
  checkNoAdvice,
  checkReadability,
} from "../domain/guardrails.js";
import { extractJson } from "./json.js";
import {
  BRIEFING_SYSTEM,
  buildBriefingUser,
  buildPovSystem,
  buildPovUser,
} from "./prompts.js";

// Minimum personas that must succeed for a day to be publishable. Below this
// the divergence signal is too thin to be meaningful, so we fall back to sample.
const MIN_PERSONAS_FOR_DAY = 3;

// Shape the briefing LLM call is asked to return (pre-divergence key points).
interface RawBriefing {
  date: string;
  keyPoints: Array<{
    id: string;
    summary: string;
    detail: string;
    magnitude?: string;
    sources: Source[];
  }>;
}

interface RawPov {
  text: string;
  activeBias: string;
  stances: Array<{
    keyPointId: string;
    label: StanceLabel;
    score: number;
    rationale?: string;
  }>;
}

function clampScore(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(-2, Math.min(2, Math.round(n)));
}

/** Generate the neutral briefing, retrying once if the tone guardrail trips. */
async function generateBriefing(
  llm: LlmClient,
  marketUser: string,
): Promise<KeyPoint[]> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys =
      attempt === 0
        ? BRIEFING_SYSTEM
        : `${BRIEFING_SYSTEM}\n\nYour previous attempt failed this check: ${lastErr}. Rewrite flatly.`;
    const raw = await llm.generate(
      [
        { role: "system", content: sys },
        { role: "user", content: marketUser },
      ],
      { maxTokens: 1600 },
    );
    const parsed = extractJson<RawBriefing>(raw);
    const kps = parsed.keyPoints ?? [];

    // Coerce text fields to strings before tone checks — a free model can emit
    // a valid-JSON key point whose summary/detail is the wrong type.
    const safe = kps.map((kp, i) => ({
      id: kp.id || `kp${i + 1}`,
      summary: typeof kp.summary === "string" ? kp.summary : "",
      detail: typeof kp.detail === "string" ? kp.detail : "",
      magnitude: typeof kp.magnitude === "string" ? kp.magnitude : undefined,
      sources: Array.isArray(kp.sources) ? kp.sources : [],
    }));

    const toneViolations = safe.flatMap((kp) => [
      ...checkNeutralTone(kp.summary).violations,
      ...checkNeutralTone(kp.detail).violations,
    ]);
    const countOk = safe.length >= 3 && safe.length <= 6;
    // FR-1: every key point must carry at least one citable source.
    const missingSources = safe.filter((kp) => kp.sources.length === 0);

    if (toneViolations.length === 0 && countOk && missingSources.length === 0) {
      return safe.map((kp) => ({
        ...kp,
        // Placeholder; real divergence is attached after POVs exist.
        divergence: {
          score: 0,
          level: "consensus" as const,
          spread: 0,
          mostBullish: null,
          mostBearish: null,
        },
      }));
    }

    // Surface ALL failure reasons so the single retry has complete feedback.
    const reasons: string[] = [];
    if (!countOk) reasons.push(`wrong key point count (${safe.length}, need 3-6)`);
    if (toneViolations.length)
      reasons.push(`non-neutral language (${toneViolations.join("; ")})`);
    if (missingSources.length)
      reasons.push(
        `key points missing sources: ${missingSources.map((k) => k.id).join(", ")}`,
      );
    lastErr = reasons.join("; ");
  }
  throw new Error(`Briefing failed guardrails: ${lastErr}`);
}

/** Generate one persona's POV, retrying once on guardrail failure. */
async function generatePov(
  llm: LlmClient,
  personaIndex: number,
  keyPoints: KeyPoint[],
): Promise<PersonaPOV> {
  const persona = PERSONA_LIST[personaIndex];
  const validIds = keyPoints.map((kp) => kp.id);
  const userMsg = buildPovUser(keyPoints);
  let lastErr = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const sys =
      attempt === 0
        ? buildPovSystem(persona)
        : `${buildPovSystem(persona)}\n\nYour previous attempt failed: ${lastErr}. Fix it and stay under the word limit.`;
    const raw = await llm.generate(
      [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      { maxTokens: 1200 },
    );
    const parsed = extractJson<RawPov>(raw);
    // Coerce defensively — a free model with no structured-output mode can emit
    // valid JSON whose fields are the wrong type. A non-string text becomes ""
    // and trips the "empty" readability check (a recoverable retry), instead of
    // throwing a TypeError that would skip the retry and collapse the day.
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const stances = (Array.isArray(parsed.stances) ? parsed.stances : []).map(
      (s) => ({
        keyPointId: s.keyPointId,
        label: s.label,
        score: clampScore(Number(s.score)),
        rationale: s.rationale,
      }),
    );

    const readability = checkReadability(text);
    const advice = checkNoAdvice(text);
    const grounding = checkGrounding(
      stances.map((s) => s.keyPointId),
      validIds,
    );
    const violations = [
      ...readability.violations,
      ...advice.violations,
      ...grounding.violations,
    ];

    if (violations.length === 0) {
      return {
        personaId: persona.id,
        text: text.trim(),
        activeBias:
          typeof parsed.activeBias === "string"
            ? parsed.activeBias
            : persona.biases[0],
        stances,
      };
    }
    lastErr = violations.join("; ");
  }
  throw new Error(`${persona.name} POV failed guardrails: ${lastErr}`);
}

/**
 * Full daily generation pipeline (FR-1, FR-2, FR-4, FR-9, FR-11):
 *   market data -> neutral briefing -> 5 persona POVs (parallel) -> divergence.
 */
export async function generateDay(
  llm: LlmClient,
  market: MarketDataProvider,
  nowIso: string,
): Promise<DayContent> {
  const snapshot = await market.fetchSnapshot();
  const briefingKeyPoints = await generateBriefing(
    llm,
    buildBriefingUser(snapshot),
  );

  // Five persona calls run in parallel; each reacts to the same base layer.
  // Use allSettled so one flaky persona doesn't discard the others — salvage
  // the run as long as a quorum succeeds, rather than collapsing the whole day.
  const settled = await Promise.allSettled(
    PERSONA_LIST.map((_, i) => generatePov(llm, i, briefingKeyPoints)),
  );
  const povs = settled
    .filter((r): r is PromiseFulfilledResult<PersonaPOV> => r.status === "fulfilled")
    .map((r) => r.value);
  if (povs.length < MIN_PERSONAS_FOR_DAY) {
    const failed = settled
      .filter((r) => r.status === "rejected")
      .map((r) => String((r as PromiseRejectedResult).reason));
    throw new Error(
      `Only ${povs.length}/${PERSONA_LIST.length} personas succeeded (need ${MIN_PERSONAS_FOR_DAY}): ${failed.join(" | ")}`,
    );
  }

  const keyPoints = withKeyPointDivergence(briefingKeyPoints, povs);
  const dayDivergence = computeDayDivergence(povs);

  return {
    date: snapshot.tradingDay || nowIso.slice(0, 10),
    kind: "daily",
    source: "live",
    keyPoints,
    povs,
    dayDivergence,
    generatedAt: nowIso,
    disclaimer: DISCLAIMER,
  };
}
