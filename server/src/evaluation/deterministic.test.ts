import { describe, expect, it } from "vitest";
import type { KeyPoint, PersonaPOV } from "@prism/shared";
import { PERSONAS } from "../domain/personas.js";
import { evaluateDeterministically } from "./deterministic.js";

const keyPoints: KeyPoint[] = [
  {
    id: "kp1",
    summary: "Treasury yields declined after the inflation report.",
    detail: "The ten-year Treasury yield moved lower during the session.",
    sources: [],
    divergence: {
      score: 0,
      level: "consensus",
      spread: 0,
      mostBullish: null,
      mostBearish: null,
    },
  },
];

const validPov: PersonaPOV = {
  personaId: "momentum",
  text: "Lower yields supported the current trend, so I am watching whether that strength continues across the broader market.",
  activeBias: "following the current price trend",
  stances: [
    {
      keyPointId: "kp1",
      label: "bullish",
      score: 1,
      rationale: "Lower yields supported the trend.",
    },
  ],
};

describe("deterministic persona evaluation", () => {
  it("records readability and complete stance coverage for a valid POV", () => {
    const result = evaluateDeterministically(
      validPov,
      keyPoints,
      PERSONAS.momentum,
    );

    expect(result.qaPass).toBe(true);
    expect(result.stanceCoverage).toBe(1);
    expect(result.wordCount).toBeGreaterThan(8);
    expect(Number.isFinite(result.fleschKincaidGrade)).toBe(true);
  });

  it("flags label-score conflicts and duplicate second views", () => {
    const result = evaluateDeterministically(
      {
        ...validPov,
        stances: [{ ...validPov.stances[0], label: "bearish" }],
      },
      keyPoints,
      PERSONAS.momentum,
      validPov,
    );

    expect(result.qaPass).toBe(false);
    expect(result.qaCodes).toContain("label_score_conflict");
    expect(result.qaCodes).toContain("duplicate_second_view");
  });
});
