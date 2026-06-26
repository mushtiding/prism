import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../providers/marketData.js";
import { buildBriefingUser } from "./prompts.js";

describe("buildBriefingUser", () => {
  it("passes real headline metadata and summary into the briefing prompt", () => {
    const snapshot: MarketSnapshot = {
      tradingDay: "2026-06-23",
      indexQuotes: [{ symbol: "SPY", price: 733.58, changePercent: "-1.76%" }],
      topGainers: [],
      topLosers: [],
      news: [
        {
          title: "S&P 500, Nasdaq, Dow Drop As Broader Tech And AI Selloff Continues",
          summary: "Major indexes finished lower as chip and AI-linked shares declined.",
          source: {
            title: "S&P 500, Nasdaq, Dow Drop As Broader Tech And AI Selloff Continues",
            publisher: "Yahoo Finance",
            url: "https://finance.yahoo.com/example",
          },
          tickers: ["SPY"],
          publishedAt: "2026-06-23T21:47:22.000Z",
        },
      ],
    };

    const prompt = buildBriefingUser(snapshot);

    expect(prompt).toContain(
      "S&P 500, Nasdaq, Dow Drop As Broader Tech And AI Selloff Continues",
    );
    expect(prompt).toContain("Yahoo Finance");
    expect(prompt).toContain("published 2026-06-23T21:47:22.000Z");
    expect(prompt).toContain("https://finance.yahoo.com/example");
    expect(prompt).toContain(
      "Summary: Major indexes finished lower as chip and AI-linked shares declined.",
    );
  });
});
