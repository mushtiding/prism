import { describe, it, expect } from "vitest";
import { generateDay } from "./generate.js";
import type { LlmClient, LlmMessage } from "../providers/llm.js";
import type { MarketDataProvider, MarketSnapshot } from "../providers/marketData.js";

const SNAPSHOT: MarketSnapshot = {
  tradingDay: "2026-06-09",
  indexQuotes: [{ symbol: "SPY", price: 500, changePercent: "+0.4%" }],
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

// A valid briefing the mock LLM returns for the briefing call.
const BRIEFING_JSON = JSON.stringify({
  date: "2026-06-09",
  keyPoints: [
    {
      id: "kp1",
      summary: "The index rose 0.4%.",
      detail: "Broad gains across large caps.",
      magnitude: "+0.4%",
      sources: [{ title: "Index rose", publisher: "Reuters", url: "https://r.com" }],
    },
    {
      id: "kp2",
      summary: "The 10-year yield rose 5 basis points.",
      detail: "Yields moved up after data.",
      magnitude: "+5bps",
      sources: [{ title: "Yields up", publisher: "Bloomberg", url: "https://b.com" }],
    },
    {
      id: "kp3",
      summary: "Crude oil fell 1%.",
      detail: "Inventory build weighed on prices.",
      magnitude: "-1%",
      sources: [{ title: "Oil down", publisher: "Reuters", url: "https://r2.com" }],
    },
  ],
});

function validPov(): string {
  return JSON.stringify({
    text: "I read this as a steady tape and would stay engaged with what is working.",
    activeBias: "trend following",
    stances: [
      { keyPointId: "kp1", label: "bullish", score: 1, rationale: "trend up" },
      { keyPointId: "kp2", label: "neutral", score: 0, rationale: "noise" },
      { keyPointId: "kp3", label: "neutral", score: 0, rationale: "minor" },
    ],
  });
}

/** Mock LLM: the briefing call (system mentions "neutral market-data editor")
 *  returns the briefing; persona calls are routed by persona name, which the
 *  POV system prompt embeds verbatim. Keying on name (not call order) keeps the
 *  test deterministic even though the 5 personas run concurrently. */
function makeLlm(personaResponder: (personaName: string) => string): LlmClient {
  return {
    async generate(messages: LlmMessage[]): Promise<string> {
      const sys = messages[0]?.content ?? "";
      if (sys.includes("neutral market-data editor")) return BRIEFING_JSON;
      const match = sys.match(/You are "([^"]+)"/);
      return personaResponder(match?.[1] ?? "");
    },
  };
}

describe("generateDay", () => {
  it("produces a full day when all personas succeed", async () => {
    const llm = makeLlm(() => validPov());
    const day = await generateDay(llm, market, "2026-06-09T12:00:00.000Z");
    expect(day.source).toBe("live");
    expect(day.date).toBe("2026-06-09");
    expect(day.keyPoints).toHaveLength(3);
    expect(day.povs).toHaveLength(5);
    expect(day.dayDivergence.score).toBeGreaterThanOrEqual(0);
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

  it("throws when too few personas succeed (below quorum)", async () => {
    // Every persona returns an empty POV -> all fail both attempts -> 0 succeed.
    const llm = makeLlm(() => JSON.stringify({ text: "", stances: [] }));
    await expect(
      generateDay(llm, market, "2026-06-09T12:00:00.000Z"),
    ).rejects.toThrow(/personas succeeded/);
  });
});
