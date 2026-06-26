import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

export interface Config {
  port: number;
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  openRouterModels: string[];
  openRouterReasoning: string;
  openRouterTimeoutMs: number;
  alphaVantageApiKey: string | undefined;
}

function splitModels(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const defaultOpenRouterModel =
  process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free";

export const config: Config = {
  port: Number(process.env.PORT) || 8787,
  openRouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
  openRouterModel: defaultOpenRouterModel,
  openRouterModels: unique([
    defaultOpenRouterModel,
    ...splitModels(process.env.OPENROUTER_FALLBACK_MODELS),
  ]),
  openRouterReasoning: process.env.OPENROUTER_REASONING || "none",
  openRouterTimeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS) || 480_000,
  alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY || undefined,
};

/** Live generation requires BOTH a market feed and an LLM. Otherwise: sample. */
export function isLiveMode(c: Config = config): boolean {
  return Boolean(c.openRouterApiKey && c.alphaVantageApiKey);
}
