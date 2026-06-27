import {
  DISCLAIMER,
  type DayContent,
  type KeyPoint,
  type PersonaId,
  type PersonaPOV,
  type StanceLabel,
} from "@prism/shared";
import { LlmRateLimitError, type LlmClient } from "../providers/llm.js";
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
export const PERSONA_QUORUM_GRACE_MS = 60_000;
export const POV_RETRY_BASE_DELAY_MS = 2_000;
const MAX_POV_ATTEMPTS = 3;

export class PersonaQuorumError extends Error {
  constructor(
    message: string,
    public readonly povs: PersonaPOV[],
  ) {
    super(message);
    this.name = "PersonaQuorumError";
  }
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SettledPov =
  | { index: number; status: "fulfilled"; value: PersonaPOV }
  | { index: number; status: "rejected"; reason: unknown };

type QuorumTimeout = { status: "quorum-timeout" };

interface QuorumDeadline {
  cancel: () => void;
  promise: Promise<QuorumTimeout>;
}

function settlePov(
  llm: LlmClient,
  personaIndex: number,
  keyPoints: KeyPoint[],
  briefingLabel?: string,
): Promise<SettledPov> {
  return generatePov(llm, personaIndex, keyPoints, briefingLabel).then(
    (value) => ({ index: personaIndex, status: "fulfilled", value }),
    (reason) => ({ index: personaIndex, status: "rejected", reason }),
  );
}

function createQuorumDeadline(delayMs: number): QuorumDeadline {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<QuorumTimeout>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "quorum-timeout" }),
      delayMs,
    );
  });
  return {
    promise,
    cancel: () => clearTimeout(timer),
  };
}

/** Generate one persona's POV, retrying compactly on guardrail failure. */
async function generatePov(
  llm: LlmClient,
  personaIndex: number,
  keyPoints: KeyPoint[],
  briefingLabel?: string,
): Promise<PersonaPOV> {
  const persona = PERSONA_LIST[personaIndex];
  const validIds = keyPoints.map((kp) => kp.id);
  const userMsg = buildPovUser(keyPoints, briefingLabel);
  let lastErr = "";

  for (let attempt = 0; attempt < MAX_POV_ATTEMPTS; attempt++) {
    const sys =
      attempt === 0
        ? buildPovSystem(persona)
        : `${buildPovSystem(persona)}

Your previous attempt failed: ${lastErr}
Return the complete corrected JSON object now. Keep text under 120 words and each rationale under 30 words. Include exactly one stance for each of these ids: ${validIds.join(", ")}. Use double quotes for every JSON key and string delimiter. No prose before or after the JSON.`;
    let raw: string;
    try {
      raw = await llm.generate(
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
    } catch (err) {
      lastErr = `model request failed: ${err instanceof Error ? err.message : String(err)}`;
      if (err instanceof LlmRateLimitError) {
        logEvent(`${persona.name} attempt ${attempt + 1} stopped: ${lastErr}`);
        throw err;
      }
      const hasRetry = attempt + 1 < MAX_POV_ATTEMPTS;
      const retryDelayMs = POV_RETRY_BASE_DELAY_MS * (attempt + 1);
      logEvent(
        `${persona.name} attempt ${attempt + 1} failed: ${lastErr}${hasRetry ? `; retrying in ${retryDelayMs}ms` : ""}`,
      );
      if (hasRetry) await wait(retryDelayMs);
      continue;
    }

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

export function generatePersonaPov(
  llm: LlmClient,
  personaId: PersonaId,
  keyPoints: KeyPoint[],
): Promise<PersonaPOV> {
  const personaIndex = PERSONA_LIST.findIndex((persona) => persona.id === personaId);
  if (personaIndex === -1) {
    return Promise.reject(new Error(`Unknown persona: ${personaId}`));
  }
  return generatePov(llm, personaIndex, keyPoints);
}

export function mergePersonaPov(
  day: DayContent,
  pov: PersonaPOV,
): DayContent {
  const byPersona = new Map(day.povs.map((existing) => [existing.personaId, existing]));
  byPersona.set(pov.personaId, pov);
  const povs = PERSONA_LIST.flatMap((persona) => {
    const current = byPersona.get(persona.id);
    return current ? [current] : [];
  });

  return {
    ...day,
    povs,
    keyPoints: withKeyPointDivergence(day.keyPoints, povs),
    dayDivergence: computeDayDivergence(povs),
  };
}

export async function generatePersonaPovs(
  llm: LlmClient,
  keyPoints: KeyPoint[],
  options: {
    briefingLabel?: string;
    quorumGraceMs?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<PersonaPOV[]> {
  const quorumGraceMs = options.quorumGraceMs ?? PERSONA_QUORUM_GRACE_MS;
  const pending = new Map<number, Promise<SettledPov>>();
  const povs: Array<{ index: number; pov: PersonaPOV }> = [];
  const failures: string[] = [];
  let quorumDeadline: QuorumDeadline | null = null;

  for (let i = 0; i < PERSONA_LIST.length; i++) {
    pending.set(i, settlePov(llm, i, keyPoints, options.briefingLabel));
  }
  options.onProgress?.(0, PERSONA_LIST.length);

  while (pending.size > 0) {
    const racers: Array<Promise<SettledPov | QuorumTimeout>> = [
      ...pending.values(),
    ];
    if (povs.length >= MIN_PERSONAS_FOR_DAY) {
      if (!quorumDeadline) {
        quorumDeadline = createQuorumDeadline(quorumGraceMs);
        logEvent(
          `persona quorum reached: waiting up to ${quorumGraceMs / 1000}s for ${pending.size} remaining lens${pending.size === 1 ? "" : "es"}`,
        );
      }
      racers.push(quorumDeadline.promise);
    }

    const result = await Promise.race(racers);
    if (result.status === "quorum-timeout") {
      const pendingNames = [...pending.keys()]
        .map((i) => PERSONA_LIST[i].name)
        .join(", ");
      logEvent(
        `persona quorum grace expired: ${povs.length}/${PERSONA_LIST.length} succeeded; publishing without ${pendingNames}`,
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
    options.onProgress?.(PERSONA_LIST.length - pending.size, PERSONA_LIST.length);
  }

  quorumDeadline?.cancel();

  const orderedPovs = povs
    .sort((a, b) => a.index - b.index)
    .map(({ pov }) => pov);

  logEvent(`persona quorum: ${orderedPovs.length}/${PERSONA_LIST.length} succeeded`);
  if (orderedPovs.length < MIN_PERSONAS_FOR_DAY) {
    const pendingNames = [...pending.keys()]
      .map((i) => PERSONA_LIST[i].name)
      .join(", ");
    const details = [...failures];
    if (pendingNames) details.push(`still waiting: ${pendingNames}`);
    throw new PersonaQuorumError(
      `Only ${orderedPovs.length}/${PERSONA_LIST.length} personas succeeded (need ${MIN_PERSONAS_FOR_DAY}): ${details.join(" | ")}`,
      orderedPovs,
    );
  }

  return orderedPovs;
}

/**
 * Full daily generation pipeline (FR-1, FR-2, FR-4, FR-9, FR-11):
 *   market data -> deterministic neutral briefing -> 5 persona POVs -> divergence.
 */
export async function generateDay(
  llm: LlmClient,
  market: MarketDataProvider,
  nowIso: string,
  displayDate?: string,
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
    let povs: PersonaPOV[];
    try {
      povs = await generatePersonaPovs(llm, briefingKeyPoints);
    } catch (err) {
      if (!(err instanceof PersonaQuorumError)) throw err;
      povs = err.povs;
      logEvent(
        `persona quorum unavailable: preserving live briefing with ${povs.length}/5 lenses`,
      );
    }

    setPipeline("divergence", "deterministic scoring");
    const keyPoints = withKeyPointDivergence(briefingKeyPoints, povs);
    const dayDivergence = computeDayDivergence(povs);

    return {
      date: displayDate ?? snapshot.tradingDay ?? nowIso.slice(0, 10),
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
