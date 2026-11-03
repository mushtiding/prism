import { randomUUID } from "node:crypto";
import {
  DISCLAIMER,
  type DayContent,
  type KeyPoint,
  type PersonaId,
  type PersonaPOV,
  type RoomRead,
  type StanceLabel,
} from "@prism/shared";
import {
  LlmModelUnavailableError,
  LlmRateLimitError,
  type LlmClient,
} from "../providers/llm.js";
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
import {
  buildPovSystem,
  buildPovUser,
  buildRoomReadSystem,
  buildRoomReadUser,
} from "./prompts.js";
import {
  recordPersonaAttempt,
  recordPersonaOutput,
} from "../evaluation/storage.js";
import { queueQualityEvaluation } from "../evaluation/judge.js";
import type { EvaluationRunContext } from "../evaluation/types.js";

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

export class RoomReadQuorumError extends Error {
  constructor(
    public readonly completed: number,
    public readonly required: number,
  ) {
    super(
      `Room Read completed ${completed} strengthened lenses; ${required} required`,
    );
    this.name = "RoomReadQuorumError";
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

function failureClass(message: string): string {
  if (/rate limit|\b429\b/i.test(message)) return "provider_rate_limit";
  if (/no endpoints|\b404\b|model unavailable/i.test(message)) {
    return "provider_unavailable";
  }
  if (/timed out/i.test(message)) return "provider_timeout";
  if (/network|socket|ECONN|fetch failed/i.test(message)) return "network_error";
  if (/json/i.test(message)) return "malformed_json";
  return "unknown";
}

function guardrailCodes(violations: string[]): string[] {
  return [
    ...new Set(
      violations.map((violation) => {
        if (/advice pattern/i.test(violation)) return "advice_violation";
        if (/missing stance/i.test(violation)) return "stance_missing";
        if (/duplicate stance/i.test(violation)) return "stance_duplicate";
        if (/unknown key point/i.test(violation)) return "grounding_failure";
        if (/label.*score|score.*label/i.test(violation)) {
          return "label_score_conflict";
        }
        if (/active bias/i.test(violation)) return "active_bias_missing";
        if (/repeats the first/i.test(violation)) return "duplicate_second_view";
        if (/word|empty|short/i.test(violation)) return "readability";
        return "guardrail_failure";
      }),
    ),
  ];
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
  personaIndex: number,
  request: Promise<PersonaPOV>,
): Promise<SettledPov> {
  return request.then(
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
async function generateStructuredPov(
  llm: LlmClient,
  personaIndex: number,
  keyPoints: KeyPoint[],
  systemPrompt: string,
  userMsg: string,
  labelPrefix: string,
  evaluationRun?: EvaluationRunContext,
  firstPov?: PersonaPOV,
): Promise<PersonaPOV> {
  const persona = PERSONA_LIST[personaIndex];
  const validIds = keyPoints.map((kp) => kp.id);
  let lastErr = "";
  const personaStarted = performance.now();

  for (let attempt = 0; attempt < MAX_POV_ATTEMPTS; attempt++) {
    const promptAttemptId = randomUUID();
    const attemptStartedAt = new Date().toISOString();
    const attemptStarted = performance.now();
    const sys =
      attempt === 0
        ? systemPrompt
        : `${systemPrompt}

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
          label: `${labelPrefix} attempt ${attempt + 1}`,
          responseFormat: POV_RESPONSE_FORMAT,
          telemetry: evaluationRun
            ? {
                runId: evaluationRun.runId,
                promptAttemptId,
                personaId: persona.id,
                stage: evaluationRun.stage,
                promptAttempt: attempt + 1,
                interactiveRetryOrdinal:
                  evaluationRun.interactiveRetryOrdinal,
              }
            : undefined,
        },
      );
    } catch (err) {
      lastErr = `model request failed: ${err instanceof Error ? err.message : String(err)}`;
      if (evaluationRun) {
        recordPersonaAttempt({
          attemptId: promptAttemptId,
          run: evaluationRun,
          personaId: persona.id,
          promptAttempt: attempt + 1,
          startedAt: attemptStartedAt,
          latencyMs: performance.now() - attemptStarted,
          outcome: "failed",
          failureClass: failureClass(lastErr),
        });
      }
      if (
        err instanceof LlmRateLimitError ||
        err instanceof LlmModelUnavailableError
      ) {
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
      if (evaluationRun) {
        recordPersonaAttempt({
          attemptId: promptAttemptId,
          run: evaluationRun,
          personaId: persona.id,
          promptAttempt: attempt + 1,
          startedAt: attemptStartedAt,
          latencyMs: performance.now() - attemptStarted,
          outcome: "rejected",
          failureClass: "malformed_json",
          guardrailCodes: ["malformed_json"],
          responseChars: raw.length,
        });
      }
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
    const advice = checkNoAdvice(
      [text, ...stances.map((stance) => stance.rationale ?? "")].join(" "),
    );
    const grounding = checkGrounding(
      stances.map((s) => s.keyPointId),
      validIds,
    );
    const duplicateViolation =
      firstPov && samePovText(text, firstPov.text)
        ? ["strengthened POV repeats the first impression"]
        : [];
    const labelScoreViolations = stances.flatMap((stance) => {
      const validLabel = ["bullish", "neutral", "bearish"].includes(
        stance.label,
      );
      const consistent =
        (stance.score < 0 && stance.label === "bearish") ||
        (stance.score === 0 && stance.label === "neutral") ||
        (stance.score > 0 && stance.label === "bullish");
      return validLabel && consistent
        ? []
        : [`stance ${stance.keyPointId} label and score are inconsistent`];
    });
    const activeBiasViolations =
      typeof parsed.activeBias === "string" && parsed.activeBias.trim()
        ? []
        : ["active bias is missing"];
    const violations = [
      ...readability.violations,
      ...advice.violations,
      ...grounding.violations,
      ...duplicateViolation,
      ...labelScoreViolations,
      ...activeBiasViolations,
    ];

    if (violations.length === 0) {
      logEvent(
        `${persona.name} attempt ${attempt + 1} accepted: ${countWords(text)} words, ${stances.length}/${validIds.length} stances`,
      );
      const pov: PersonaPOV = {
        personaId: persona.id,
        text: text.trim(),
        activeBias:
          typeof parsed.activeBias === "string"
            ? parsed.activeBias
            : persona.biases[0],
        stances,
      };
      if (evaluationRun) {
        recordPersonaAttempt({
          attemptId: promptAttemptId,
          run: evaluationRun,
          personaId: persona.id,
          promptAttempt: attempt + 1,
          startedAt: attemptStartedAt,
          latencyMs: performance.now() - attemptStarted,
          outcome: "accepted",
          responseChars: raw.length,
        });
        const outputId = recordPersonaOutput({
          run: evaluationRun,
          persona,
          pov,
          keyPoints,
          personaLatencyMs: performance.now() - personaStarted,
          firstPov,
          retainText: evaluationRun.workflow !== "my_lens",
        });
        queueQualityEvaluation({
          runId: evaluationRun.runId,
          outputId,
          persona,
          keyPoints,
          pov,
          stage: evaluationRun.stage,
          firstPov,
        });
      }
      return pov;
    }
    lastErr = formatReasons(violations);
    logEvent(
      `${persona.name} attempt ${attempt + 1} rejected: ${lastErr}; ${countWords(text)} words, ${stances.length}/${validIds.length} stances; ${rawHint(raw)}`,
    );
    if (evaluationRun) {
      recordPersonaAttempt({
        attemptId: promptAttemptId,
        run: evaluationRun,
        personaId: persona.id,
        promptAttempt: attempt + 1,
        startedAt: attemptStartedAt,
        latencyMs: performance.now() - attemptStarted,
        outcome: "rejected",
        failureClass: "guardrail_failure",
        guardrailCodes: guardrailCodes(violations),
        responseChars: raw.length,
      });
    }
  }
  throw new Error(`${persona.name} POV failed guardrails: ${lastErr}`);
}

async function generatePov(
  llm: LlmClient,
  personaIndex: number,
  keyPoints: KeyPoint[],
  briefingLabel?: string,
  evaluationRun?: EvaluationRunContext,
): Promise<PersonaPOV> {
  const persona = PERSONA_LIST[personaIndex];
  return generateStructuredPov(
    llm,
    personaIndex,
    keyPoints,
    buildPovSystem(persona),
    buildPovUser(keyPoints, briefingLabel),
    persona.name,
    evaluationRun,
  );
}

async function generateRoomReadPov(
  llm: LlmClient,
  personaIndex: number,
  keyPoints: KeyPoint[],
  firstPovs: PersonaPOV[],
  evaluationRun?: EvaluationRunContext,
): Promise<PersonaPOV> {
  const persona = PERSONA_LIST[personaIndex];
  const firstPov = firstPovs.find((pov) => pov.personaId === persona.id);
  if (!firstPov) {
    throw new Error(`No first impression found for ${persona.id}`);
  }
  return generateStructuredPov(
    llm,
    personaIndex,
    keyPoints,
    buildRoomReadSystem(persona),
    buildRoomReadUser(persona, keyPoints, firstPovs),
    `${persona.name} room read`,
    evaluationRun,
    firstPov,
  );
}

function comparablePovText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function samePovText(left: string, right: string): boolean {
  return comparablePovText(left) === comparablePovText(right);
}

export function generateRoomReadPersonaPov(
  llm: LlmClient,
  personaId: PersonaId,
  keyPoints: KeyPoint[],
  firstPovs: PersonaPOV[],
  evaluationRun?: EvaluationRunContext,
): Promise<PersonaPOV> {
  const personaIndex = PERSONA_LIST.findIndex((persona) => persona.id === personaId);
  if (personaIndex === -1) {
    return Promise.reject(new Error(`Unknown persona: ${personaId}`));
  }
  return generateRoomReadPov(
    llm,
    personaIndex,
    keyPoints,
    firstPovs,
    evaluationRun,
  );
}

export function generatePersonaPov(
  llm: LlmClient,
  personaId: PersonaId,
  keyPoints: KeyPoint[],
  evaluationRun?: EvaluationRunContext,
): Promise<PersonaPOV> {
  const personaIndex = PERSONA_LIST.findIndex((persona) => persona.id === personaId);
  if (personaIndex === -1) {
    return Promise.reject(new Error(`Unknown persona: ${personaId}`));
  }
  return generatePov(llm, personaIndex, keyPoints, undefined, evaluationRun);
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
    evaluationRun?: EvaluationRunContext;
  } = {},
): Promise<PersonaPOV[]> {
  const quorumGraceMs = options.quorumGraceMs ?? PERSONA_QUORUM_GRACE_MS;
  const pending = new Map<number, Promise<SettledPov>>();
  const povs: Array<{ index: number; pov: PersonaPOV }> = [];
  const failures: string[] = [];
  let quorumDeadline: QuorumDeadline | null = null;

  for (let i = 0; i < PERSONA_LIST.length; i++) {
    pending.set(
      i,
      settlePov(
        i,
        generatePov(
          llm,
          i,
          keyPoints,
          options.briefingLabel,
          options.evaluationRun,
        ),
      ),
    );
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

function roomReadBriefing(
  keyPoints: KeyPoint[],
  firstPovs: PersonaPOV[],
  strengthenedPovs: PersonaPOV[],
): string {
  const firstDivergence = computeDayDivergence(firstPovs);
  const strengthenedDivergence = computeDayDivergence(strengthenedPovs);
  const scoredPoints = keyPoints.map((keyPoint) => {
    const scores = strengthenedPovs.flatMap((pov) => {
      const stance = pov.stances.find((item) => item.keyPointId === keyPoint.id);
      return stance ? [stance.score] : [];
    });
    return {
      keyPoint,
      spread: scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0,
    };
  });
  const strongest = scoredPoints.sort((left, right) => right.spread - left.spread)[0];
  const focus = strongest?.keyPoint ?? keyPoints[0];
  const focusStances = strengthenedPovs.flatMap((pov) => {
    const stance = pov.stances.find((item) => item.keyPointId === focus?.id);
    return stance ? [{ personaId: pov.personaId, score: stance.score }] : [];
  });
  const names = (ids: PersonaId[]) =>
    ids
      .map((id) => PERSONA_LIST.find((persona) => persona.id === id)?.name ?? id)
      .join(", ");
  const bullish = names(
    focusStances.filter((stance) => stance.score > 0).map((stance) => stance.personaId),
  );
  const bearish = names(
    focusStances.filter((stance) => stance.score < 0).map((stance) => stance.personaId),
  );
  const sides = [
    bullish ? `${bullish} carried the bullish case` : "",
    bearish ? `${bearish} kept the bearish case` : "",
  ].filter(Boolean);
  const shift = strengthenedDivergence.score - firstDivergence.score;
  const shiftText =
    shift > 0.04
      ? "became more divided"
      : shift < -0.04
        ? "became less divided"
        : "held near its first-impression level";

  return [
    focus
      ? `After reading the room, the strongest split centered on ${focus.summary}`
      : "After reading the room, each available lens refined its independent case.",
    sides.length > 0
      ? `${sides.join(", while ")}.`
      : "The second views stayed close to neutral.",
    `The overall disagreement score ${shiftText}, moving from ${firstDivergence.score.toFixed(2)} to ${strengthenedDivergence.score.toFixed(2)}.`,
  ].join(" ");
}

function orderedRoomReadPovs(povs: PersonaPOV[]): PersonaPOV[] {
  const byPersona = new Map(povs.map((pov) => [pov.personaId, pov]));
  return PERSONA_LIST.flatMap((persona) => {
    const pov = byPersona.get(persona.id);
    return pov ? [pov] : [];
  });
}

export function sanitizeRoomRead(day: DayContent): DayContent {
  if (!day.roomRead) return day;
  const firstByPersona = new Map(day.povs.map((pov) => [pov.personaId, pov]));
  const strengthenedPovs = orderedRoomReadPovs(
    day.roomRead.strengthenedPovs.filter((pov) => {
      const first = firstByPersona.get(pov.personaId);
      return first && !samePovText(first.text, pov.text);
    }),
  );
  if (strengthenedPovs.length === day.roomRead.strengthenedPovs.length) return day;

  return {
    ...day,
    roomRead: {
      ...day.roomRead,
      strengthenedPovs,
      divergence: computeDayDivergence(strengthenedPovs),
      briefing:
        strengthenedPovs.length > 0
          ? roomReadBriefing(day.keyPoints, day.povs, strengthenedPovs)
          : "No distinct second views returned. Try the unavailable perspectives again.",
    },
  };
}

export function mergeRoomReadPov(
  day: DayContent,
  pov: PersonaPOV,
  generatedAt: string,
): DayContent {
  const sanitized = sanitizeRoomRead(day);
  if (!sanitized.roomRead) throw new Error("Room Read has not been revealed");
  if (!sanitized.povs.some((first) => first.personaId === pov.personaId)) {
    throw new Error(`No first impression found for ${pov.personaId}`);
  }
  const strengthenedPovs = orderedRoomReadPovs([
    ...sanitized.roomRead.strengthenedPovs.filter(
      (existing) => existing.personaId !== pov.personaId,
    ),
    pov,
  ]);

  return {
    ...sanitized,
    roomRead: {
      generatedAt,
      strengthenedPovs,
      divergence: computeDayDivergence(strengthenedPovs),
      briefing: roomReadBriefing(
        sanitized.keyPoints,
        sanitized.povs,
        strengthenedPovs,
      ),
    },
  };
}

/** Generate independent second reads for every persona with a first impression. */
export async function generateRoomRead(
  llm: LlmClient,
  keyPoints: KeyPoint[],
  firstPovs: PersonaPOV[],
  generatedAt: string,
  quorumGraceMs = PERSONA_QUORUM_GRACE_MS,
  evaluationRun?: EvaluationRunContext,
): Promise<RoomRead> {
  const personaIndexes = PERSONA_LIST.flatMap((persona, index) =>
    firstPovs.some((pov) => pov.personaId === persona.id) ? [index] : [],
  );
  if (personaIndexes.length < 2) {
    throw new Error("Room Read needs at least two first impressions");
  }

  const pending = new Map<number, Promise<SettledPov>>();
  const completed: Array<{ index: number; pov: PersonaPOV }> = [];
  const minimum = Math.min(MIN_PERSONAS_FOR_DAY, personaIndexes.length);
  let quorumDeadline: QuorumDeadline | null = null;

  for (const index of personaIndexes) {
    pending.set(
      index,
      settlePov(
        index,
        generateRoomReadPov(
          llm,
          index,
          keyPoints,
          firstPovs,
          evaluationRun,
        ),
      ),
    );
  }

  while (pending.size > 0) {
    const racers: Array<Promise<SettledPov | QuorumTimeout>> = [
      ...pending.values(),
    ];
    if (completed.length >= minimum) {
      if (!quorumDeadline) {
        quorumDeadline = createQuorumDeadline(quorumGraceMs);
        logEvent(
          `room read quorum reached: waiting up to ${quorumGraceMs / 1000}s for ${pending.size} remaining lens${pending.size === 1 ? "" : "es"}`,
        );
      }
      racers.push(quorumDeadline.promise);
    }

    const result = await Promise.race(racers);
    if (result.status === "quorum-timeout") {
      logEvent(
        `room read quorum grace expired: ${completed.length}/${personaIndexes.length} strengthened lenses accepted`,
      );
      break;
    }
    pending.delete(result.index);
    if (result.status === "fulfilled") {
      completed.push({ index: result.index, pov: result.value });
    } else {
      logEvent(
        `${PERSONA_LIST[result.index].name} room read failed after retries: ${String(result.reason)}`,
      );
    }
  }
  quorumDeadline?.cancel();

  const strengthenedPovs = completed
    .sort((left, right) => left.index - right.index)
    .map(({ pov }) => pov);
  if (strengthenedPovs.length < minimum) {
    throw new RoomReadQuorumError(strengthenedPovs.length, minimum);
  }
  const divergence = computeDayDivergence(strengthenedPovs);
  logEvent(
    `room read accepted: ${strengthenedPovs.length}/${personaIndexes.length} strengthened lenses`,
  );

  return {
    generatedAt,
    briefing: roomReadBriefing(keyPoints, firstPovs, strengthenedPovs),
    strengthenedPovs,
    divergence,
  };
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
  evaluationRun?: EvaluationRunContext,
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
      povs = await generatePersonaPovs(llm, briefingKeyPoints, {
        evaluationRun,
      });
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
