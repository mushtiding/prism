import { describe, it, expect } from "vitest";
import type { PersonaPOV } from "@prism/shared";
import {
  computeDivergence,
  computeDayDivergence,
  withKeyPointDivergence,
} from "./divergence.js";

describe("computeDivergence", () => {
  it("reports full consensus when all scores are identical", () => {
    const d = computeDivergence([
      { personaId: "momentum", score: 2 },
      { personaId: "growth", score: 2 },
      { personaId: "value", score: 2 },
    ]);
    expect(d.score).toBe(0);
    expect(d.spread).toBe(0);
    expect(d.level).toBe("consensus");
    expect(d.mostBullish).toBeNull();
    expect(d.mostBearish).toBeNull();
  });

  it("reports maximal divergence (score 1) at the extreme split", () => {
    const d = computeDivergence([
      { personaId: "momentum", score: 2 },
      { personaId: "macro", score: -2 },
    ]);
    expect(d.score).toBe(1);
    expect(d.level).toBe("contested");
    expect(d.mostBullish).toBe("momentum");
    expect(d.mostBearish).toBe("macro");
  });

  it("classifies a mild spread as mixed", () => {
    // scores 1,1,0,-1 -> stddev ~0.829 -> /2 ~0.415 -> mixed band
    const d = computeDivergence([
      { personaId: "momentum", score: 1 },
      { personaId: "growth", score: 1 },
      { personaId: "value", score: 0 },
      { personaId: "macro", score: -1 },
    ]);
    expect(d.level).toBe("mixed");
    expect(d.score).toBeGreaterThan(0.25);
    expect(d.score).toBeLessThan(0.55);
  });

  it("identifies who splits when scores differ", () => {
    const d = computeDivergence([
      { personaId: "momentum", score: 2 },
      { personaId: "growth", score: 1 },
      { personaId: "value", score: -1 },
      { personaId: "macro", score: -2 },
      { personaId: "contrarian", score: 0 },
    ]);
    expect(d.mostBullish).toBe("momentum");
    expect(d.mostBearish).toBe("macro");
  });

  it("handles an empty stance list without throwing", () => {
    const d = computeDivergence([]);
    expect(d.score).toBe(0);
    expect(d.mostBullish).toBeNull();
  });
});

// Two personas, two key points. kp1 is contested (full split), kp2 is consensus.
const POVS: PersonaPOV[] = [
  {
    personaId: "momentum",
    text: "x",
    activeBias: "herding",
    stances: [
      { keyPointId: "kp1", label: "bullish", score: 2 },
      { keyPointId: "kp2", label: "neutral", score: 0 },
    ],
  },
  {
    personaId: "macro",
    text: "y",
    activeBias: "loss aversion",
    stances: [
      { keyPointId: "kp1", label: "bearish", score: -2 },
      { keyPointId: "kp2", label: "neutral", score: 0 },
    ],
  },
];

describe("withKeyPointDivergence", () => {
  it("computes divergence per key point from the POVs", () => {
    const keyPoints = [
      {
        id: "kp1",
        summary: "a",
        detail: "a",
        sources: [],
        divergence: {
          score: 0,
          level: "consensus" as const,
          spread: 0,
          mostBullish: null,
          mostBearish: null,
        },
      },
      {
        id: "kp2",
        summary: "b",
        detail: "b",
        sources: [],
        divergence: {
          score: 0,
          level: "consensus" as const,
          spread: 0,
          mostBullish: null,
          mostBearish: null,
        },
      },
    ];
    const result = withKeyPointDivergence(keyPoints, POVS);
    expect(result[0].divergence.level).toBe("contested");
    expect(result[0].divergence.score).toBe(1);
    expect(result[1].divergence.level).toBe("consensus");
    expect(result[1].divergence.score).toBe(0);
  });
});

describe("computeDayDivergence", () => {
  it("averages each persona across key points then measures spread", () => {
    // momentum avg = (2+0)/2 = 1, macro avg = (-2+0)/2 = -1
    // stddev of [1,-1] = 1 -> /2 = 0.5 -> mixed
    const d = computeDayDivergence(POVS);
    expect(d.score).toBe(0.5);
    expect(d.level).toBe("mixed");
    expect(d.mostBullish).toBe("momentum");
    expect(d.mostBearish).toBe("macro");
  });
});
