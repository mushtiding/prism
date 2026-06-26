import {
  DISCLAIMER,
  type DayContent,
  type Divergence,
  type KeyPoint,
  type PersonaPOV,
  type Source,
  type StanceLabel,
} from "@prism/shared";
import type { LlmClient } from "../providers/llm.js";
import type { LlmResponseFormat } from "../providers/llm.js";
import type {
  MarketDataProvider,
  MarketSnapshot,
  NewsItem,
  Quote,
} from "../providers/marketData.js";
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

const BRIEFING_RESPONSE_FORMAT: LlmResponseFormat = {
  type: "json_object",
};

const POV_RESPONSE_FORMAT: LlmResponseFormat = {
  type: "json_object",
};

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

function blankDivergence(): Divergence {
  return {
    score: 0,
    level: "consensus",
    spread: 0,
    mostBullish: null,
    mostBearish: null,
  };
}

function keyPointWithBlankDivergence(
  keyPoint: Omit<KeyPoint, "divergence">,
): KeyPoint {
  return { ...keyPoint, divergence: blankDivergence() };
}

function quoteSource(symbol: string): Source {
  return {
    title: `${symbol} market quote`,
    publisher: "Market data feed",
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
  };
}

function quoteSummary(q: Quote): string {
  return `${q.symbol} closed at ${q.price} (${q.changePercent}).`;
}

function fallbackKeyPointFromNews(item: NewsItem, i: number): KeyPoint {
  return keyPointWithBlankDivergence({
    id: `kp${i + 1}`,
    summary: `${item.source.publisher} reported: ${item.title}`,
    detail:
      item.summary && item.summary !== item.title
        ? item.summary
        : `The cited source published this market-related item for the session.`,
    sources: [item.source],
  });
}

function fallbackKeyPointFromQuote(q: Quote, i: number): KeyPoint {
  return keyPointWithBlankDivergence({
    id: `kp${i + 1}`,
    summary: quoteSummary(q),
    detail: `${q.symbol} finished the session at ${q.price}, ${q.changePercent} versus the prior close.`,
    magnitude: q.changePercent,
    sources: [quoteSource(q.symbol)],
  });
}

function buildFeedBackedBriefing(snapshot: MarketSnapshot): KeyPoint[] {
  const points: KeyPoint[] = [];

  for (const item of snapshot.news) {
    if (!item.title || !item.source?.url) continue;
    points.push(fallbackKeyPointFromNews(item, points.length));
    if (points.length >= 4) break;
  }

  for (const q of snapshot.indexQuotes) {
    if (points.length >= 3) break;
    points.push(fallbackKeyPointFromQuote(q, points.length));
  }

  if (points.length < 3) {
    for (const q of [...snapshot.topGainers, ...snapshot.topLosers]) {
      if (points.length >= 3) break;
      points.push(fallbackKeyPointFromQuote(q, points.length));
    }
  }

  if (points.length < 3) {
    throw new Error(
      `Briefing failed and market feed only had ${points.length} fallback key points`,
    );
  }

  return points.slice(0, 6).map((kp, i) => ({ ...kp, id: `kp${i + 1}` }));
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
      {
        maxTokens: 2200,
        label: `briefing attempt ${attempt + 1}`,
        responseFormat: BRIEFING_RESPONSE_FORMAT,
      },
    );

    let parsed: RawBriefing;
    try {
      parsed = extractJson<RawBriefing>(raw);
    } catch (err) {
      lastErr = `invalid JSON: ${err instanceof Error ? err.message : String(err)}. Return one valid JSON object with a keyPoints array; no prose, no comments, no trailing commas.`;
      logEvent(
        `briefing attempt ${attempt + 1} rejected: ${lastErr}; ${rawHint(raw)}`,
      );
      continue;
    }

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
      logEvent(
        `briefing attempt ${attempt + 1} accepted: ${safe.length} key points`,
      );
      return safe.map((kp) => keyPointWithBlankDivergence(kp));
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
    lastErr = formatReasons(reasons);
    logEvent(
      `briefing attempt ${attempt + 1} rejected: ${lastErr}; parsed ${safe.length} key points; ${rawHint(raw)}`,
    );
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

/**
 * Full daily generation pipeline (FR-1, FR-2, FR-4, FR-9, FR-11):
 *   market data -> neutral briefing -> 5 persona POVs (parallel) -> divergence.
 */
export async function generateDay(
  llm: LlmClient,
  market: MarketDataProvider,
  nowIso: string,
): Promise<DayContent> {
  try {
    setPipeline("market data", "market snapshot");
    const snapshot = await market.fetchSnapshot();

    setPipeline("neutral briefing", "OpenRouter LLM");
    let briefingKeyPoints: KeyPoint[];
    try {
      briefingKeyPoints = await generateBriefing(llm, buildBriefingUser(snapshot));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logEvent(
        `briefing generation failed — using feed-backed live briefing (${reason})`,
      );
      briefingKeyPoints = buildFeedBackedBriefing(snapshot);
    }

    setPipeline("persona POVs", "5 parallel OpenRouter calls");
    const settled = await Promise.allSettled(
      PERSONA_LIST.map((_, i) => generatePov(llm, i, briefingKeyPoints)),
    );
    settled.forEach((result, i) => {
      if (result.status === "rejected") {
        logEvent(
          `${PERSONA_LIST[i].name} failed after retries: ${String(result.reason)}`,
        );
      }
    });
    const povs = settled
      .filter((r): r is PromiseFulfilledResult<PersonaPOV> => r.status === "fulfilled")
      .map((r) => r.value);
    logEvent(`persona quorum: ${povs.length}/${PERSONA_LIST.length} succeeded`);
    if (povs.length < MIN_PERSONAS_FOR_DAY) {
      const failed = settled
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason));
      throw new Error(
        `Only ${povs.length}/${PERSONA_LIST.length} personas succeeded (need ${MIN_PERSONAS_FOR_DAY}): ${failed.join(" | ")}`,
      );
    }

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
