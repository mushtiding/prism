import type { KeyPoint, PersonaDef, PersonaPOV } from "@prism/shared";
import { config } from "../config.js";
import { logEvent } from "../logger.js";
import { OpenRouterClient } from "../providers/llm.js";
import { extractJson } from "../pipeline/json.js";
import {
  isPersonaOutputPublished,
  recordAutomatedEvaluation,
  RUBRIC_VERSION,
} from "./storage.js";
import type { EvaluationStage, QualityScores } from "./types.js";

const EVALUATOR_VERSION = "llm-judge-2026-07-07-v1";

const JUDGE_SYSTEM = `You are a strict quality evaluator for a market-perspective product.

Score the supplied persona response independently on five dimensions from 0 to 4:
- alignment: fidelity to the persona worldview, horizon, risk posture, weighting, bias, and voice
- thesis: clarity of the central claim and quality of evidence-to-conclusion reasoning
- relevance: focus on and factual fidelity to the supplied brief, with no unsupported material claims
- plainLanguage: clarity for a financially curious non-expert without rewarding verbosity
- internalCoherence: consistency among the prose, stance labels, scores, and rationales

Do not reward bullishness, bearishness, confidence, jargon, or agreement with consensus. Treat the supplied brief as the complete factual universe. Do not use outside or future market knowledge.

Return exactly one JSON object with this shape:
{"alignment":0,"thesis":0,"relevance":0,"plainLanguage":0,"internalCoherence":0,"unsupportedClaim":false,"clearThesis":false,"confidence":0.0,"rationale":"short explanation"}

All five scores must be integers from 0 to 4. confidence must be from 0 to 1. Return JSON only.`;

let evaluationQueue = Promise.resolve();
const pendingByRun = new Map<
  string,
  Array<{
    outputId: string;
    persona: PersonaDef;
    keyPoints: KeyPoint[];
    pov: PersonaPOV;
    stage: EvaluationStage;
    firstPov?: PersonaPOV;
  }>
>();
const finalizedRuns = new Map<string, boolean>();

function clampScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("judge returned a non-numeric score");
  return Math.max(0, Math.min(4, Math.round(parsed)));
}

function parseScores(raw: string): QualityScores {
  const parsed = extractJson<Record<string, unknown>>(raw);
  const confidence = Number(parsed.confidence);
  return {
    alignment: clampScore(parsed.alignment),
    thesis: clampScore(parsed.thesis),
    relevance: clampScore(parsed.relevance),
    plainLanguage: clampScore(parsed.plainLanguage),
    internalCoherence: clampScore(parsed.internalCoherence),
    unsupportedClaim: parsed.unsupportedClaim === true,
    clearThesis: parsed.clearThesis === true,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
    rationale:
      typeof parsed.rationale === "string"
        ? parsed.rationale.trim().slice(0, 600)
        : "",
  };
}

function judgeUserMessage(input: {
  persona: PersonaDef;
  keyPoints: KeyPoint[];
  pov: PersonaPOV;
  stage: EvaluationStage;
  firstPov?: PersonaPOV;
}): string {
  return JSON.stringify(
    {
      rubricVersion: RUBRIC_VERSION,
      stage: input.stage,
      persona: input.persona,
      sourceBrief: input.keyPoints.map((keyPoint) => ({
        id: keyPoint.id,
        summary: keyPoint.summary,
        detail: keyPoint.detail,
        highlights: keyPoint.highlights ?? [],
        magnitude: keyPoint.magnitude ?? "",
      })),
      firstImpression: input.firstPov ?? null,
      response: input.pov,
    },
    null,
    2,
  );
}

async function evaluate(input: {
  outputId: string;
  persona: PersonaDef;
  keyPoints: KeyPoint[];
  pov: PersonaPOV;
  stage: EvaluationStage;
  firstPov?: PersonaPOV;
}): Promise<void> {
  if (!config.evaluationJudgeEnabled || !config.openRouterApiKey) {
    recordAutomatedEvaluation({
      outputId: input.outputId,
      model: config.evaluationJudgeModel,
      evaluatorVersion: EVALUATOR_VERSION,
      status: "skipped",
      errorClass: "judge_disabled",
    });
    return;
  }

  try {
    const judge = new OpenRouterClient(config.openRouterApiKey, {
      models: [config.evaluationJudgeModel],
    });
    const raw = await judge.generate(
      [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: judgeUserMessage(input) },
      ],
      {
        label: `quality judge ${input.persona.name} ${input.stage}`,
        maxTokens: 700,
        temperature: 0,
        responseFormat: { type: "json_object" },
      },
    );
    recordAutomatedEvaluation({
      outputId: input.outputId,
      model: config.evaluationJudgeModel,
      evaluatorVersion: EVALUATOR_VERSION,
      status: "complete",
      scores: parseScores(raw),
    });
  } catch (err) {
    logEvent(`quality judge failed for ${input.persona.id}: ${String(err)}`);
    recordAutomatedEvaluation({
      outputId: input.outputId,
      model: config.evaluationJudgeModel,
      evaluatorVersion: EVALUATOR_VERSION,
      status: "failed",
      errorClass: "judge_failure",
    });
  }
}

export function queueQualityEvaluation(input: {
  runId: string;
  outputId: string;
  persona: PersonaDef;
  keyPoints: KeyPoint[];
  pov: PersonaPOV;
  stage: EvaluationStage;
  firstPov?: PersonaPOV;
}): void {
  const finalized = finalizedRuns.get(input.runId);
  if (finalized !== undefined) {
    scheduleEvaluation(input, finalized && isPersonaOutputPublished(input.outputId));
    return;
  }
  const pending = pendingByRun.get(input.runId) ?? [];
  pending.push(input);
  pendingByRun.set(input.runId, pending);
}

function scheduleEvaluation(
  item: {
    outputId: string;
    persona: PersonaDef;
    keyPoints: KeyPoint[];
    pov: PersonaPOV;
    stage: EvaluationStage;
    firstPov?: PersonaPOV;
  },
  shouldEvaluate: boolean,
): void {
  if (!shouldEvaluate) {
    recordAutomatedEvaluation({
      outputId: item.outputId,
      model: config.evaluationJudgeModel,
      evaluatorVersion: EVALUATOR_VERSION,
      status: "skipped",
      errorClass: "output_not_published",
    });
    return;
  }
  evaluationQueue = evaluationQueue
    .catch(() => undefined)
    .then(() => evaluate(item));
}

export function releaseQualityEvaluations(
  runId: string,
  shouldEvaluate: boolean,
): void {
  finalizedRuns.set(runId, shouldEvaluate);
  const pending = pendingByRun.get(runId) ?? [];
  pendingByRun.delete(runId);
  for (const item of pending) {
    scheduleEvaluation(
      item,
      shouldEvaluate && isPersonaOutputPublished(item.outputId),
    );
  }
  const cleanup = setTimeout(() => finalizedRuns.delete(runId), 15 * 60_000);
  cleanup.unref();
}

export async function flushQualityEvaluations(): Promise<void> {
  await evaluationQueue;
}
