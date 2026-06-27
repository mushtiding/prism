import { describe, expect, it } from "vitest";
import type { MarketDataProvider, MarketSnapshot } from "./marketData.js";
import { ArticleSummaryMarketDataProvider } from "./articleSummaryMarketData.js";

const snapshot: MarketSnapshot = {
  tradingDay: "2026-06-26",
  indexQuotes: [
    { symbol: "SPY", price: 728.99, changePercent: "-0.58%" },
    { symbol: "QQQ", price: 620, changePercent: "-1.20%" },
  ],
  topGainers: [],
  topLosers: [],
  news: [
    {
      title: "S&P 500 and Nasdaq end week lower as investors rotate out of tech",
      summary: "The Dow ended its third consecutive week higher.",
      source: {
        title: "S&P 500 and Nasdaq end week lower as investors rotate out of tech",
        publisher: "Stocktwits",
        url: "https://stocktwits.com/article",
      },
      tickers: ["SPY", "QQQ"],
      publishedAt: "2026-06-26T22:00:00Z",
    },
    {
      title: "Treasury yields fall as markets assess inflation data",
      summary: "Bond yields declined while stocks traded lower.",
      source: {
        title: "Treasury yields fall as markets assess inflation data",
        publisher: "Reuters",
        url: "https://reuters.com/article",
      },
      tickers: ["SPY"],
      publishedAt: "2026-06-26T21:00:00Z",
    },
    {
      title: "Chip stocks pull the Nasdaq lower during Friday trading",
      summary: "Semiconductor shares declined as technology stocks weakened.",
      source: {
        title: "Chip stocks pull the Nasdaq lower during Friday trading",
        publisher: "CNBC",
        url: "https://cnbc.com/article",
      },
      tickers: ["QQQ"],
      publishedAt: "2026-06-26T20:00:00Z",
    },
  ],
};

describe("ArticleSummaryMarketDataProvider", () => {
  it("hydrates selected news with publisher highlights", async () => {
    const inner: MarketDataProvider = {
      async fetchSnapshot() {
        return snapshot;
      },
    };
    const provider = new ArticleSummaryMarketDataProvider(inner, async (url) => ({
      title: "Article",
      text: "Article text",
      url,
      highlights: url.includes("stocktwits")
        ? [
            "The S&P 500 fell 0.1% and the Nasdaq 100 lost 1.1%.",
            "OpenAI may delay its IPO until next year.",
            "The semiconductor ETF dropped 7.3% this week.",
          ]
        : [],
    }));

    const enriched = await provider.fetchSnapshot();
    expect(enriched.news[0].highlights).toContain(
      "OpenAI may delay its IPO until next year.",
    );
  });
});
