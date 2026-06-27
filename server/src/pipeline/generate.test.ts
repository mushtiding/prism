import { describe, it, expect, vi } from "vitest";
import {
  generateDay,
  mergePersonaPov,
  PERSONA_QUORUM_GRACE_MS,
  POV_RETRY_BASE_DELAY_MS,
} from "./generate.js";
import { generateNeutralBriefing } from "./neutralBriefing.js";
import {
  LlmRateLimitError,
  type LlmClient,
  type LlmMessage,
} from "../providers/llm.js";
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
      title: "Stocks rise as softer inflation lifts rate-cut expectations",
      summary:
        "Wall Street indexes rose after inflation data came in cooler than expected and Treasury yields moved lower.",
      source: {
        title: "Stocks rise as softer inflation lifts rate-cut expectations",
        publisher: "Reuters",
        url: "https://reuters.com/markets/us/stocks-rise-inflation",
      },
      tickers: ["SPY", "QQQ"],
      publishedAt: "2026-06-09T20:30:00Z",
    },
    {
      title: "Treasury yields fall after jobs data points to slower hiring",
      summary:
        "Government bond yields declined as investors weighed softer employment data and the path for Federal Reserve rates.",
      source: {
        title: "Treasury yields fall after jobs data points to slower hiring",
        publisher: "Bloomberg",
        url: "https://bloomberg.com/markets/treasury-yields-jobs",
      },
      tickers: [],
      publishedAt: "2026-06-09T19:00:00Z",
    },
    {
      title: "Chip stocks lift Nasdaq as AI spending remains in focus",
      summary:
        "Semiconductor shares helped the Nasdaq outperform as investors focused on demand tied to artificial intelligence infrastructure.",
      source: {
        title: "Chip stocks lift Nasdaq as AI spending remains in focus",
        publisher: "CNBC",
        url: "https://cnbc.com/markets/chips-nasdaq-ai",
      },
      tickers: ["QQQ", "NVDA"],
      publishedAt: "2026-06-09T18:00:00Z",
    },
    {
      title: "Oil prices slip while traders assess global demand",
      summary:
        "Crude prices moved lower as traders assessed demand signals and the broader commodity backdrop.",
      source: {
        title: "Oil prices slip while traders assess global demand",
        publisher: "AP News",
        url: "https://apnews.com/markets/oil-demand",
      },
      tickers: [],
      publishedAt: "2026-06-09T17:00:00Z",
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
  it("filters weak single-stock pages out of curated article key points", () => {
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

    const sourceTitles = keyPoints.flatMap((kp) => kp.sources.map((s) => s.title));

    expect(sourceTitles).not.toContain(
      "Price to book forward of Analog Devices, Inc. - NASDAQ:ADI",
    );
    expect(keyPoints[0].sources[0].url).toContain("finance.yahoo.com/quote/QQQ");
    expect(keyPoints[0].detail).toContain("fallback key point");
  });

  it("curates article-backed key points from different publishers", () => {
    const keyPoints = generateNeutralBriefing(SNAPSHOT);
    const primaryPublishers = keyPoints.map((kp) => kp.sources[0].publisher);

    expect(keyPoints).toHaveLength(4);
    expect(new Set(primaryPublishers).size).toBe(4);
    expect(primaryPublishers).toEqual(
      expect.arrayContaining(["Reuters", "Bloomberg", "CNBC", "AP News"]),
    );
    expect(keyPoints.every((kp) => !kp.sources[0].url.includes("finance.yahoo.com/quote/"))).toBe(
      true,
    );
    expect(keyPoints.some((kp) => kp.sources.some((s) => s.title === "QQQ market quote"))).toBe(
      true,
    );
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

  it("uses an explicit display date instead of the provider session date", async () => {
    const llm = makeLlm(() => validPov());
    const day = await generateDay(
      llm,
      market,
      "2026-06-27T12:00:00.000Z",
      "2026-06-27",
    );

    expect(day.date).toBe("2026-06-27");
  });

  it("merges a recovered persona in canonical order and recomputes divergence", async () => {
    const llm = makeLlm(() => validPov());
    const full = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");
    const recoveredBase = full.povs.find((pov) => pov.personaId === "growth");
    expect(recoveredBase).toBeDefined();
    const recovered = {
      ...recoveredBase!,
      stances: recoveredBase!.stances.map((stance) => ({
        ...stance,
        label: "bearish" as const,
        score: -2,
      })),
    };

    const partialPovs = full.povs.filter((pov) => pov.personaId !== "growth");
    const partial = {
      ...full,
      povs: partialPovs,
      keyPoints: full.keyPoints.map((keyPoint) => ({
        ...keyPoint,
        divergence: { ...keyPoint.divergence, score: 0 },
      })),
    };
    const merged = mergePersonaPov(partial, recovered);

    expect(merged.povs.map((pov) => pov.personaId)).toEqual([
      "momentum",
      "growth",
      "value",
      "macro",
      "contrarian",
    ]);
    expect(merged.keyPoints.some((keyPoint) => keyPoint.divergence.score > 0)).toBe(
      true,
    );
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
    expect(day.keyPoints[0].summary).toContain("Stocks rise");
    expect(day.keyPoints[0].sources[0].publisher).toBe("Reuters");
    expect(day.keyPoints.some((kp) => kp.sources.some((s) => s.url.includes("finance.yahoo.com/quote/QQQ")))).toBe(
      true,
    );
    expect(seenSystems.every((s) => !s.includes("neutral market briefing"))).toBe(true);
  });

  it("lists the exact stance ids in the first persona prompt", async () => {
    const userPrompts: string[] = [];
    const llm: LlmClient = {
      async generate(messages: LlmMessage[]): Promise<string> {
        userPrompts.push(messages[1]?.content ?? "");
        return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
      },
    };

    await generateDay(llm, market, "2026-06-09T12:00:00.000Z");

    expect(userPrompts[0]).toContain(
      'Required keyPointId values, in this exact order: ["kp1", "kp2", "kp3", "kp4"]',
    );
    expect(userPrompts[0]).toContain("Do not shorten, rename, or invent ids.");
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

  it("uses a third compact attempt before dropping a persona", async () => {
    const calls = new Map<string, number>();
    const llm: LlmClient = {
      async generate(messages: LlmMessage[]): Promise<string> {
        const sys = messages[0]?.content ?? "";
        const name = sys.match(/You are "([^"]+)"/)?.[1] ?? "";
        const count = (calls.get(name) ?? 0) + 1;
        calls.set(name, count);
        if (name === "Growth bull" && count < 3) return '{"text":';
        return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
      },
    };

    const day = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");

    expect(calls.get("Growth bull")).toBe(3);
    expect(day.povs).toHaveLength(5);
  });

  it("retries transient provider failures instead of dropping the persona", async () => {
    vi.useFakeTimers();
    try {
      const calls = new Map<string, number>();
      const llm: LlmClient = {
        async generate(messages: LlmMessage[]): Promise<string> {
          const sys = messages[0]?.content ?? "";
          const name = sys.match(/You are "([^"]+)"/)?.[1] ?? "";
          const count = (calls.get(name) ?? 0) + 1;
          calls.set(name, count);
          if (name === "Contrarian" && count < 3) {
            throw new Error("temporary upstream capacity error");
          }
          return validPov(keyPointIdsFromPrompt(messages[1]?.content ?? ""));
        },
      };

      const generating = generateDay(
        llm,
        market,
        "2026-06-09T12:00:00.000Z",
      );
      await vi.advanceTimersByTimeAsync(POV_RETRY_BASE_DELAY_MS * 3);
      const day = await generating;

      expect(calls.get("Contrarian")).toBe(3);
      expect(day.povs).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry persona calls after a provider rate limit", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async generate(): Promise<string> {
        calls += 1;
        throw new LlmRateLimitError("429 Rate limit exceeded");
      },
    };

    await expect(
      generateDay(llm, market, "2026-06-09T12:00:00.000Z"),
    ).rejects.toThrow(/personas succeeded/);
    expect(calls).toBe(5);
  });

  it("salvages the day when one persona repeatedly fails (quorum met)", async () => {
    // Make ONLY the Momentum trader fail every attempt (empty text -> readability
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
    vi.useFakeTimers();
    try {
      const hanging = new Set(["Macro / risk manager", "Contrarian"]);
      const llm = makeLlm((name) =>
        hanging.has(name) ? new Promise<string>(() => undefined) : validPov(),
      );

      const generating = generateDay(
        llm,
        market,
        "2026-06-09T12:00:00.000Z",
      );
      await vi.advanceTimersByTimeAsync(PERSONA_QUORUM_GRACE_MS);
      const day = await generating;

      expect(day.povs.length).toBe(3);
      expect(day.povs.map((p) => p.personaId)).toEqual([
        "momentum",
        "growth",
        "value",
      ]);
      expect(day.source).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when too few personas succeed (below quorum)", async () => {
    // Every persona returns an empty POV -> all fail both attempts -> 0 succeed.
    const llm = makeLlm(() => JSON.stringify({ text: "", stances: [] }));
    await expect(
      generateDay(llm, market, "2026-06-09T12:00:00.000Z"),
    ).rejects.toThrow(/personas succeeded/);
  });
});
