import "dotenv/config";

export interface Config {
  port: number;
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  openRouterReasoning: string;
  alphaVantageApiKey: string | undefined;
}

export const config: Config = {
  port: Number(process.env.PORT) || 8787,
  openRouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
  openRouterModel:
    process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
  openRouterReasoning: process.env.OPENROUTER_REASONING || "medium",
  alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY || undefined,
};

/** Live generation requires BOTH a market feed and an LLM. Otherwise: sample. */
export function isLiveMode(c: Config = config): boolean {
  return Boolean(c.openRouterApiKey && c.alphaVantageApiKey);
}
