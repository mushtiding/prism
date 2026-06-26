import {
  DISCLAIMER,
  type DayContent,
  type KeyPoint,
  type PersonaPOV,
  type StanceLabel,
} from "@prism/shared";
import type { LlmClient } from "../providers/llm.js";
import type { MarketDataProvider } from "../providers/marketData.js";
import { PERSONA_LIST } from "../domain/personas.js";
import { clearPipeline, logEvent, setPipeline } from "../logger.js";
import {
  computeDayDivergence,
  withKeyPointDivergence,
} from "../domain/divergence.js";
import {
  checkGrounding,
  checkNeutralTone,
  checkNoAdvice,
  checkReadability,
  countWords,
} from "../domain/guardrails.js";
import { extractJson } from "./json.js";
import { generateNeutralBriefing } from "./neutralBriefing.js";
import { buildPovSystem, buildPovUser } from "./prompts.js";

// Minimum personas that must succeed for a day to be publishable. Below this
// the divergence signal is too thin to be meaningful, so we fall back to sample.
const MIN_PERSONAS_FOR_DAY = 3;
const PERSONA_QUORUM_GRACE_MS = 250;

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

const POV_RESPONSE_FORMAT = {
  type: "json_object",
} as const;

function clampScore(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(-2, Math.min(2, Math.round(n)));
}

function rawHint(raw: string): string {
  const start = raw.replace(/\s+/g, " ").trim().slice(0, 140);
  return start
    ? `raw ${raw.length} chars, starts "${start}"`
    : `raw ${raw.length} chars`;
}

function formatReasons(reasons: string[]): string {
  return reasons.length > 0 ? reasons.join("; ") : "unknown reason";
}

type SettledPov =
  | { index: number; status: "fulfilled"; value: PersonaPOV }
  | { index: number; status: "rejected"; reason: unknown };

type QuorumTimeout = { status: "quorum-timeout" };

function settlePov(
  llm: LlmClient,
  personaIndex: number,
  keyPoints: KeyPoint[],
): Promise<SettledPov> {
  return generatePov(llm, personaIndex, keyPoints).then(
    (value) => ({ index: personaIndex, status: "fulfilled", value }),
    (reason) => ({ index: personaIndex, status: "rejected", reason }),
  );
}

function quorumTimeout(): Promise<QuorumTimeout> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ status: "quorum-timeout" }), PERSONA_QUORUM_GRACE_MS);
  });
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
      {
        maxTokens: 1400,
        label: `${persona.name} attempt ${attempt + 1}`,
        responseFormat: POV_RESPONSE_FORMAT,
      },
    );

    let parsed: RawPov;
    try {
      parsed = extractJson<RawPov>(raw);
    } catch (err) {
      lastErr = `invalid JSON: ${err instanceof Error ? err.message : String(err)}. Return one valid JSON object with text, activeBias, and stances; no prose, no comments, no trailing commas.`;
      logEvent(
        `${persona.name} attempt ${attempt + 1} rejected: ${lastErr}; ${rawHint(raw)}`,
      );
      continue;
    }

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
      logEvent(
        `${persona.name} attempt ${attempt + 1} accepted: ${countWords(text)} words, ${stances.length}/${validIds.length} stances`,
      );
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
    lastErr = formatReasons(violations);
    logEvent(
      `${persona.name} attempt ${attempt + 1} rejected: ${lastErr}; ${countWords(text)} words, ${stances.length}/${validIds.length} stances; ${rawHint(raw)}`,
    );
  }
  throw new Error(`${persona.name} POV failed guardrails: ${lastErr}`);
}

async function collectPersonaPovs(
  llm: LlmClient,
  keyPoints: KeyPoint[],
): Promise<PersonaPOV[]> {
  const pending = new Map<number, Promise<SettledPov>>();
  const povs: Array<{ index: number; pov: PersonaPOV }> = [];
  const failures: string[] = [];

  for (let i = 0; i < PERSONA_LIST.length; i++) {
    pending.set(i, settlePov(llm, i, keyPoints));
  }

  while (pending.size > 0) {
    const racers: Array<Promise<SettledPov | QuorumTimeout>> = [
      ...pending.values(),
    ];
    if (povs.length >= MIN_PERSONAS_FOR_DAY) {
      racers.push(quorumTimeout());
    }

    const result = await Promise.race(racers);
    if (result.status === "quorum-timeout") {
      const pendingNames = [...pending.keys()]
        .map((i) => PERSONA_LIST[i].name)
        .join(", ");
      logEvent(
        `persona quorum reached: ${povs.length}/${PERSONA_LIST.length} succeeded; publishing without waiting for ${pendingNames}`,
      );
      break;
    }

    pending.delete(result.index);
    if (result.status === "fulfilled") {
      povs.push({ index: result.index, pov: result.value });
    } else {
      const detail = `${PERSONA_LIST[result.index].name} failed after retries: ${String(result.reason)}`;
      failures.push(detail);
      logEvent(detail);
    }
  }

  logEvent(`persona quorum: ${povs.length}/${PERSONA_LIST.length} succeeded`);
  if (povs.length < MIN_PERSONAS_FOR_DAY) {
    const pendingNames = [...pending.keys()]
      .map((i) => PERSONA_LIST[i].name)
      .join(", ");
    const details = [...failures];
    if (pendingNames) details.push(`still waiting: ${pendingNames}`);
    throw new Error(
      `Only ${povs.length}/${PERSONA_LIST.length} personas succeeded (need ${MIN_PERSONAS_FOR_DAY}): ${details.join(" | ")}`,
    );
  }

  return povs
    .sort((a, b) => a.index - b.index)
    .map(({ pov }) => pov);
}

/**
 * Full daily generation pipeline (FR-1, FR-2, FR-4, FR-9, FR-11):
 *   market data -> deterministic neutral briefing -> 5 persona POVs -> divergence.
 */
export async function generateDay(
  llm: LlmClient,
  market: MarketDataProvider,
  nowIso: string,
): Promise<DayContent> {
  try {
    setPipeline("market data", "market snapshot");
    const snapshot = await market.fetchSnapshot();

    setPipeline("neutral briefing", "deterministic market feed");
    const briefingKeyPoints = generateNeutralBriefing(snapshot);
    logEvent(
      `deterministic briefing accepted: ${briefingKeyPoints.length} key points`,
    );

    setPipeline("persona POVs", "5 parallel OpenRouter calls");
    const povs = await collectPersonaPovs(llm, briefingKeyPoints);

    setPipeline("divergence", "deterministic scoring");
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
  } finally {
    clearPipeline();
  }
}
