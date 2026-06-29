import { beforeEach, describe, expect, it } from "vitest";
import type { LlmClient, LlmMessage } from "../providers/llm.js";
import {
  analyzeMyLensArticles,
  clearArticleAnalysisCacheForTests,
  isFinanceArticle,
  MAX_MY_LENS_ARTICLES,
  MY_LENS_ARTICLE_CHAR_LIMIT,
  prepareMyLensArticles,
} from "./userArticles.js";

function keyPointIdsFromPrompt(user: string): string[] {
  return [...user.matchAll(/^(article-[a-z0-9-]+):/gm)].map(
    (match) => match[1],
  );
}

function synthesisIdsFromPrompt(user: string): string[] {
  return [...user.matchAll(/^ID: (article-[a-z0-9-]+)$/gm)].map(
    (match) => match[1],
  );
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
    if (messages[0]?.content.includes("neutral finance editor")) {
      return JSON.stringify({
        articles: synthesisIdsFromPrompt(messages[1]?.content ?? "").map(
          (id) => ({
            id,
            headline:
              "Company update shifts investor expectations across financial markets",
            summary:
              "The article reports a market-moving company update and identifies the financial figures that shaped the session. It also explains how investors responded and which risks remain relevant.",
            keyFacts: [
              "The company reported a material financial development.",
              "Investors weighed the update during the market session.",
            ],
          }),
        ),
      });
    }
    return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
  },
};

describe("Your Moves article preparation", () => {
  beforeEach(() => clearArticleAnalysisCacheForTests());

  it("accepts a queue of up to five articles", () => {
    expect(MAX_MY_LENS_ARTICLES).toBe(5);
  });

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

  it("rewrites the publisher title and summarizes complete article facts", async () => {
    const publisherTitle =
      "Is Example Corp One of the Best Stocks to Buy After Earnings?";
    const response = await analyzeMyLensArticles(
      llm,
      [
        {
          id: "rewrite",
          value: `${publisherTitle} Example Corp shares rose after revenue and earnings exceeded analyst forecasts. Investors also reviewed the company's higher full-year guidance.`,
        },
      ],
      "2026-06-27T12:00:00.000Z",
    );

    expect(response.day?.keyPoints[0].summary).not.toBe(publisherTitle);
    expect(response.day?.keyPoints[0].summary).toBe(
      "Company update shifts investor expectations across financial markets",
    );
    expect(response.day?.keyPoints[0].detail).toContain(
      "The article reports a market-moving company update",
    );
    expect(response.day?.keyPoints[0].detail.length).toBeLessThan(500);
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
      expect.arrayContaining([
        "reading",
        "validating",
        "summarizing",
        "personas",
        "scoring",
      ]),
    );
  });

  it("reuses the same analysis when an added article is invalid", async () => {
    let calls = 0;
    const countingLlm: LlmClient = {
      async generate(messages) {
        calls += 1;
        return llm.generate(messages);
      },
    };
    const valid = {
      id: "stable",
      value:
        "The Nasdaq stock market fell after semiconductor earnings disappointed investors and Treasury yields rose.",
    };
    const first = await analyzeMyLensArticles(
      countingLlm,
      [valid],
      "2026-06-27T12:00:00.000Z",
    );
    const callsAfterFirstRun = calls;
    const second = await analyzeMyLensArticles(
      countingLlm,
      [valid, { id: "blocked", value: "A guide to pruning roses." }],
      "2026-06-27T12:05:00.000Z",
    );

    expect(second.articles.map((article) => article.status)).toEqual([
      "valid",
      "invalid",
    ]);
    expect(second.day?.dayDivergence).toEqual(first.day?.dayDivergence);
    expect(second.day?.povs).toEqual(first.day?.povs);
    expect(calls).toBe(callsAfterFirstRun);
  });
});
