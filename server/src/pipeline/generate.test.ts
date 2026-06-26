import { describe, it, expect } from "vitest";
import { generateDay } from "./generate.js";
import { generateNeutralBriefing } from "./neutralBriefing.js";
import type { LlmClient, LlmMessage } from "../providers/llm.js";
import type { MarketDataProvider, MarketSnapshot } from "../providers/marketData.js";

const SNAPSHOT: MarketSnapshot = {
  tradingDay: "2026-06-09",
  indexQuotes: [
    { symbol: "SPY", price: 500, changePercent: "+0.4%" },
    { symbol: "QQQ", price: 450, changePercent: "-1.2%" },
    { symbol: "DIA", price: 390, changePercent: "+0.1%" },
    { symbol: "IWM", price: 210, changePercent: "-0.6%" },
  ],
  topGainers: [],
  topLosers: [],
  news: [
    {
      title: "Index rose",
      summary: "markets up",
      source: { title: "Index rose", publisher: "Reuters", url: "https://r.com" },
      tickers: ["SPY"],
    },
  ],
};

const market: MarketDataProvider = {
  fetchSnapshot: async () => SNAPSHOT,
};

function keyPointIdsFromPrompt(user: string): string[] {
  return [...user.matchAll(/^(kp\d+):/gm)].map((m) => m[1]);
}

function validPov(keyPointIds = ["kp1", "kp2", "kp3", "kp4"]): string {
  return JSON.stringify({
    text: "I read this as a steady tape and would stay engaged with what is working.",
    activeBias: "trend following",
    stances: keyPointIds.map((keyPointId, i) => ({
      keyPointId,
      label: i === 0 ? "bullish" : "neutral",
      score: i === 0 ? 1 : 0,
      rationale: i === 0 ? "trend up" : "noise",
    })),
  });
}

/** Mock LLM: persona calls are routed by persona name, which the
 *  POV system prompt embeds verbatim. Keying on name (not call order) keeps the
 *  test deterministic even though the 5 personas run concurrently. */
function makeLlm(
  personaResponder: (personaName: string) => string | Promise<string>,
): LlmClient {
  return {
    async generate(messages: LlmMessage[]): Promise<string> {
      const sys = messages[0]?.content ?? "";
      const match = sys.match(/You are "([^"]+)"/);
      return personaResponder(match?.[1] ?? "");
    },
  };
}

describe("generateDay", () => {
  it("does not attach weak single-stock news to index key points", () => {
    const keyPoints = generateNeutralBriefing({
      ...SNAPSHOT,
      news: [
        {
          title: "Price to book forward of Analog Devices, Inc. - NASDAQ:ADI",
          summary: "A single-stock valuation page for Analog Devices.",
          source: {
            title: "Price to book forward of Analog Devices, Inc. - NASDAQ:ADI",
            publisher: "TradingView",
            url: "https://example.com/adi",
          },
          tickers: ["ADI"],
        },
      ],
    });

    const qqq = keyPoints.find((kp) => kp.summary.includes("QQQ"));

    expect(qqq?.sources).toHaveLength(1);
    expect(qqq?.sources[0].url).toContain("finance.yahoo.com/quote/QQQ");
    expect(qqq?.detail).toContain("quote source provides the market price");
  });

  it("produces a full day when all personas succeed", async () => {
    const llm: LlmClient = {
      async generate(messages: LlmMessage[]): Promise<string> {
        return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
      },
    };
    const day = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");
    expect(day.source).toBe("live");
    expect(day.date).toBe("2026-06-09");
    expect(day.keyPoints).toHaveLength(4);
    expect(day.povs).toHaveLength(5);
    expect(day.dayDivergence.score).toBeGreaterThanOrEqual(0);
  });

  it("builds deterministic neutral key points without calling the LLM for the briefing", async () => {
    const seenSystems: string[] = [];
    const llm: LlmClient = {
      async generate(messages: LlmMessage[]): Promise<string> {
        seenSystems.push(messages[0]?.content ?? "");
        return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
      },
    };

    const day = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");

    expect(day.source).toBe("live");
    expect(day.keyPoints[0].summary).toContain("Nasdaq 100 proxy QQQ");
    expect(day.keyPoints[0].magnitude).toBe("-1.2%");
    expect(day.keyPoints[0].sources.some((s) => s.url.includes("finance.yahoo.com/quote/QQQ"))).toBe(
      true,
    );
    expect(seenSystems.every((s) => !s.includes("neutral market briefing"))).toBe(true);
  });

  it("retries when a persona model returns malformed JSON", async () => {
    const calls = new Map<string, number>();
    const llm: LlmClient = {
      async generate(messages: LlmMessage[]): Promise<string> {
        const sys = messages[0]?.content ?? "";
        const name = sys.match(/You are "([^"]+)"/)?.[1] ?? "";
        const count = (calls.get(name) ?? 0) + 1;
        calls.set(name, count);
        if (name === "Momentum trader" && count === 1) return '{"text":';
        return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
      },
    };

    const day = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");

    expect(calls.get("Momentum trader")).toBe(2);
    expect(day.povs).toHaveLength(5);
    expect(day.source).toBe("live");
  });

  it("salvages the day when one persona repeatedly fails (quorum met)", async () => {
    // Make ONLY the Momentum trader fail both attempts (empty text -> readability
    // violation); every other persona returns a valid POV.
    const llm = makeLlm((name) =>
      name === "Momentum trader"
        ? JSON.stringify({ text: "", stances: [] })
        : validPov(),
    );
    const day = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");
    // 5 personas, one drops out -> 4 survive, above the quorum of 3.
    expect(day.povs.length).toBe(4);
    expect(day.povs.some((p) => p.personaId === "momentum")).toBe(false);
    expect(day.source).toBe("live");
  });

  it("publishes after persona quorum when remaining model calls hang", async () => {
    const hanging = new Set(["Macro / risk manager", "Contrarian"]);
    const llm = makeLlm((name) =>
      hanging.has(name) ? new Promise<string>(() => undefined) : validPov(),
    );

    const day = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");

    expect(day.povs.length).toBe(3);
    expect(day.povs.map((p) => p.personaId)).toEqual([
      "momentum",
      "growth",
      "value",
    ]);
    expect(day.source).toBe("live");
  });

  it("throws when too few personas succeed (below quorum)", async () => {
    // Every persona returns an empty POV -> all fail both attempts -> 0 succeed.
    const llm = makeLlm(() => JSON.stringify({ text: "", stances: [] }));
    await expect(
      generateDay(llm, market, "2026-06-09T12:00:00.000Z"),
    ).rejects.toThrow(/personas succeeded/);
  });
});
