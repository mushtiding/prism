import type {
  Divergence,
  DivergenceLevel,
  KeyPoint,
  PersonaPOV,
  PersonaId,
} from "@prism/shared";

/** One persona's conviction (-2..+2) on something. */
export interface ScoredStance {
  personaId: PersonaId;
  score: number;
}

// Conviction scores live in [-2, +2]. The maximum possible population standard
// deviation of values in that range is 2 (half at -2, half at +2), so we
// normalize spread by 2 to land divergence in [0, 1].
const MAX_STDDEV = 2;

const CONSENSUS_BELOW = 0.25;
const CONTESTED_ABOVE = 0.55;

function classify(score: number): DivergenceLevel {
  if (score < CONSENSUS_BELOW) return "consensus";
  if (score > CONTESTED_ABOVE) return "contested";
  return "mixed";
}

function populationStddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Deterministically measure how much the cast disagrees, from their conviction
 * scores. No LLM involved — this is the transparent headline output (FR-4).
 */
export function computeDivergence(stances: ScoredStance[]): Divergence {
  const spread = populationStddev(stances.map((s) => s.score));
  const score = Math.min(1, spread / MAX_STDDEV);

  let mostBullish: PersonaId | null = null;
  let mostBearish: PersonaId | null = null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const s of stances) {
    if (s.score > hi) {
      hi = s.score;
      mostBullish = s.personaId;
    }
    if (s.score < lo) {
      lo = s.score;
      mostBearish = s.personaId;
    }
  }
  // When everyone agrees there is no meaningful split to attribute.
  if (hi === lo) {
    mostBullish = null;
    mostBearish = null;
  }

  return {
    score: Number(score.toFixed(3)),
    level: classify(score),
    spread: Number(spread.toFixed(3)),
    mostBullish,
    mostBearish,
  };
}

/** Each persona's stance on a specific key point. */
function stancesForKeyPoint(
  povs: PersonaPOV[],
  keyPointId: string,
): ScoredStance[] {
  const out: ScoredStance[] = [];
  for (const pov of povs) {
    const stance = pov.stances.find((s) => s.keyPointId === keyPointId);
    if (stance) out.push({ personaId: pov.personaId, score: stance.score });
  }
  return out;
}

/**
 * Attach per-key-point divergence to each key point (§9.3) and return new
 * KeyPoint objects (does not mutate the inputs).
 */
export function withKeyPointDivergence(
  keyPoints: KeyPoint[],
  povs: PersonaPOV[],
): KeyPoint[] {
  return keyPoints.map((kp) => ({
    ...kp,
    divergence: computeDivergence(stancesForKeyPoint(povs, kp.id)),
  }));
}

/**
 * Day-level divergence: average each persona's conviction across all key points
 * to get its overall daily stance, then measure the spread of those. Captures
 * whether the cast disagrees about the session as a whole.
 */
export function computeDayDivergence(povs: PersonaPOV[]): Divergence {
  const dailyStances: ScoredStance[] = povs.map((pov) => {
    const scores = pov.stances.map((s) => s.score);
    const avg =
      scores.length === 0
        ? 0
        : scores.reduce((a, b) => a + b, 0) / scores.length;
    return { personaId: pov.personaId, score: avg };
  });
  return computeDivergence(dailyStances);
}
