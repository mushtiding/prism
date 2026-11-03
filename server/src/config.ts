import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

export interface Config {
  host: string;
  port: number;
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  openRouterModels: string[];
  openRouterReasoning: string;
  openRouterTimeoutMs: number;
  alphaVantageApiKey: string | undefined;
  evaluationJudgeEnabled: boolean;
  evaluationJudgeModel: string;
  evaluationReportHour: number;
  evaluationReportMinute: number;
  automaticBriefTimes: [string, string];
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

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(finite)));
}

const DEFAULT_AUTOMATIC_BRIEF_TIMES: [string, string] = ["09:30", "13:30"];

function automaticBriefTimes(value: string | undefined): [string, string] {
  const times = [...new Set((value ?? "").split(",").map((item) => item.trim()))]
    .filter((item) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item))
    .sort();
  return times.length === 2
    ? [times[0], times[1]]
    : DEFAULT_AUTOMATIC_BRIEF_TIMES;
}

const defaultOpenRouterModel =
  process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";

export const config: Config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT) || 8788,
  openRouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
  openRouterModel: defaultOpenRouterModel,
  openRouterModels: unique([
    defaultOpenRouterModel,
    ...splitModels(process.env.OPENROUTER_FALLBACK_MODELS),
  ]),
  openRouterReasoning: process.env.OPENROUTER_REASONING || "none",
  openRouterTimeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS) || 480_000,
  alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY || undefined,
  evaluationJudgeEnabled:
    process.env.NODE_ENV !== "test" &&
    process.env.EVALUATION_JUDGE_ENABLED?.trim().toLowerCase() !== "false",
  evaluationJudgeModel:
    process.env.EVALUATION_JUDGE_MODEL || defaultOpenRouterModel,
  evaluationReportHour: boundedNumber(
    process.env.EVALUATION_REPORT_HOUR,
    0,
    0,
    23,
  ),
  evaluationReportMinute: boundedNumber(
    process.env.EVALUATION_REPORT_MINUTE,
    5,
    0,
    59,
  ),
  automaticBriefTimes: automaticBriefTimes(process.env.AUTO_BRIEF_TIMES),
};

/** Live generation requires BOTH a market feed and an LLM. Otherwise: sample. */
export function isLiveMode(c: Config = config): boolean {
  return Boolean(c.openRouterApiKey && c.alphaVantageApiKey);
}
