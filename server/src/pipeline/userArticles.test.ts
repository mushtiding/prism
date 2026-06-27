import { describe, expect, it } from "vitest";
import type { LlmClient, LlmMessage } from "../providers/llm.js";
import {
  analyzeMyLensArticles,
  isFinanceArticle,
  MY_LENS_ARTICLE_CHAR_LIMIT,
  prepareMyLensArticles,
} from "./userArticles.js";

function keyPointIdsFromPrompt(user: string): string[] {
  return [...user.matchAll(/^(article-\d+):/gm)].map((match) => match[1]);
}

function validPov(keyPointIds: string[]): string {
  return JSON.stringify({
    text: "This article supports a cautious but engaged reading of the market.",
    activeBias: "weighing the chosen signals",
    stances: keyPointIds.map((keyPointId) => ({
      keyPointId,
      label: "neutral",
      score: 0,
      rationale: "The article leaves meaningful uncertainty.",
    })),
  });
}

const llm: LlmClient = {
  async generate(messages: LlmMessage[]): Promise<string> {
    return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
  },
};

describe("My Lens article preparation", () => {
  it("recognizes market coverage and rejects unrelated prose", () => {
    expect(
      isFinanceArticle(
        "The S&P 500 stock market rose as investors reviewed earnings and Treasury yields.",
      ),
    ).toBe(true);
    expect(isFinanceArticle("Apple shares rose after the product announcement.")).toBe(
      true,
    );
    expect(
      isFinanceArticle(
        "A recipe for tomato soup uses roasted vegetables, herbs, and vegetable stock.",
      ),
    ).toBe(false);
  });

  it("only validates against the first 1,500 characters", () => {
    const lateFinanceMention = `${"Travel and food writing. ".repeat(90)} S&P 500 stocks earnings`;
    expect(lateFinanceMention.length).toBeGreaterThan(MY_LENS_ARTICLE_CHAR_LIMIT);
    expect(isFinanceArticle(lateFinanceMention)).toBe(false);
  });

  it("extracts a URL article, truncates it, and keeps its source", async () => {
    const prepared = await prepareMyLensArticles(
      [{ id: "one", value: "https://example.com/markets" }],
      async () => ({
        title: "Stocks rally after earnings",
        text: `Investors pushed the stock market higher after earnings. ${"Market detail. ".repeat(200)}`,
        url: "https://example.com/markets",
        highlights: [
          "The Nasdaq rose after a major earnings report.",
          "Treasury yields moved lower during the session.",
        ],
      }),
    );

    expect(prepared.results[0]).toMatchObject({
      id: "one",
      status: "valid",
      inputType: "url",
    });
    expect(prepared.results[0].preview?.length).toBeLessThanOrEqual(
      MY_LENS_ARTICLE_CHAR_LIMIT,
    );
    expect(prepared.keyPoints[0].sources[0]).toMatchObject({
      publisher: "example.com",
      url: "https://example.com/markets",
    });
    expect(prepared.keyPoints[0].highlights).toContain(
      "Treasury yields moved lower during the session.",
    );
  });

  it("labels invalid entries while analyzing valid entries", async () => {
    const phases: string[] = [];
    const response = await analyzeMyLensArticles(
      llm,
      [
        {
          id: "valid",
          value:
            "The Nasdaq stock market fell after semiconductor earnings disappointed investors.",
        },
        { id: "invalid", value: "A guide to pruning roses in a small garden." },
      ],
      "2026-06-27T12:00:00.000Z",
      (progress) => phases.push(progress.phase),
    );

    expect(response.articles.map((article) => article.status)).toEqual([
      "valid",
      "invalid",
    ]);
    expect(response.day?.kind).toBe("myLens");
    expect(response.day?.keyPoints).toHaveLength(1);
    expect(response.day?.povs).toHaveLength(5);
    expect(phases).toEqual(
      expect.arrayContaining(["reading", "validating", "personas", "scoring"]),
    );
  });
});
