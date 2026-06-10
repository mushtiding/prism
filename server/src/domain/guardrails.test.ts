import { describe, it, expect } from "vitest";
import {
  countWords,
  checkNeutralTone,
  checkReadability,
  checkNoAdvice,
  checkGrounding,
} from "./guardrails.js";

describe("countWords", () => {
  it("counts words ignoring extra whitespace", () => {
    expect(countWords("  one   two\nthree ")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});

describe("checkNeutralTone", () => {
  it("passes flat, factual language", () => {
    const r = checkNeutralTone(
      "The index rose 1.2% and a chipmaker reported record revenue.",
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("flags loaded verbs", () => {
    const r = checkNeutralTone("Shares soared as investors panic over rate fears.");
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag substrings of larger words", () => {
    // "soar" must not match inside an unrelated word
    const r = checkNeutralTone("The reservoir level held steady.");
    expect(r.ok).toBe(true);
  });
});

describe("checkReadability", () => {
  it("passes a POV at the limit", () => {
    const text = Array(200).fill("word").join(" ");
    expect(checkReadability(text).ok).toBe(true);
  });

  it("fails a POV over the limit", () => {
    const text = Array(201).fill("word").join(" ");
    const r = checkReadability(text);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("201");
  });

  it("fails an empty POV", () => {
    expect(checkReadability("   ").ok).toBe(false);
  });
});

describe("checkNoAdvice", () => {
  it("passes in-character opinion without instructions", () => {
    expect(
      checkNoAdvice("I'd rather be on it than explain why it shouldn't have.").ok,
    ).toBe(true);
  });

  it("does not flag the words holding or selling in context", () => {
    expect(checkNoAdvice("There's real selling pressure and holding patterns.").ok).toBe(
      true,
    );
  });

  it("flags explicit buy/sell/hold instructions", () => {
    expect(checkNoAdvice("You should buy this now.").ok).toBe(false);
    expect(checkNoAdvice("My recommendation is to exit.").ok).toBe(false);
    expect(checkNoAdvice("My price target is $200.").ok).toBe(false);
  });
});

describe("checkGrounding", () => {
  it("passes exactly one stance per valid key point", () => {
    const r = checkGrounding(["kp1", "kp2"], ["kp1", "kp2"]);
    expect(r.ok).toBe(true);
  });

  it("flags a stance referencing an unknown key point", () => {
    const r = checkGrounding(["kp1", "kp9"], ["kp1", "kp2"]);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("kp9"))).toBe(true);
  });

  it("flags a missing stance", () => {
    const r = checkGrounding(["kp1"], ["kp1", "kp2"]);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("missing"))).toBe(true);
  });

  it("flags a duplicate stance", () => {
    const r = checkGrounding(["kp1", "kp1"], ["kp1"]);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("duplicate"))).toBe(true);
  });
});
