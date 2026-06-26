import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DayContent } from "@prism/shared";
import { config, isLiveMode } from "../config.js";
import { clearPipeline, logEvent, recordDayOutcome, recordDayStarted, recordFallback, setPipeline } from "../logger.js";
import { OpenRouterClient } from "../providers/llm.js";
import { AlphaVantageProvider } from "../providers/marketData.js";
import { ResilientMarketDataProvider } from "../providers/resilientMarketData.js";
import { generateDay } from "../pipeline/generate.js";
import { loadSampleDay } from "./sampleData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, "../../cache");

// Coalesce concurrent misses for the same day onto one generation promise so
// content is generated exactly once (FR-9), never twice under load.
const inFlight = new Map<string, Promise<DayContent>>();

function cacheFile(date: string): string {
  return path.join(CACHE_DIR, `${date}.json`);
}

async function readCache(date: string): Promise<DayContent | null> {
  try {
    const raw = await fs.readFile(cacheFile(date), "utf8");
    return JSON.parse(raw) as DayContent;
  } catch {
    return null;
  }
}

// Write under an explicit cache key (the requested date) so the file we store
// is always the file the next request looks up — the read key and write key
// must match even when Alpha Vantage reports a different session date.
async function writeCache(key: string, day: DayContent): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile(key), JSON.stringify(day, null, 2), "utf8");
}

/** Most recent US trading weekday on or before `now` (holidays ignored). */
export function latestTradingDay(now: Date): string {
  const d = new Date(now);
  // Market content describes the PREVIOUS session, so step back one day first.
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Get the day's content: serve cache if present; otherwise generate once,
 * cache, and serve. Any failure (missing keys, provider error, guardrails)
 * falls back to the bundled sample day, badged source:"sample" (FR-9).
 */
export async function getDay(date: string, now: Date): Promise<DayContent> {
  const cached = await readCache(date);
  if (cached) {
    recordDayOutcome("cached", date, cached.source);
    return cached;
  }

  const existing = inFlight.get(date);
  if (existing) {
    logEvent(`day generation already in flight · ${date}; joining existing request`);
    return existing;
  }

  recordDayStarted(date);

  const promise = (async (): Promise<DayContent> => {
    try {
      if (!isLiveMode()) {
        setPipeline("sample day", "bundled JSON");
        const day = await loadSampleDay(date);
        recordDayOutcome("sample", date, day.source);
        return day;
      }

      setPipeline("daily generation", date);
      const llm = new OpenRouterClient(config.openRouterApiKey!);
      const market = new ResilientMarketDataProvider(
        new AlphaVantageProvider(config.alphaVantageApiKey!),
      );
      const day = await generateDay(llm, market, now.toISOString());
      setPipeline("cache write", date);
      await writeCache(date, day);
      recordDayOutcome("live", date, day.source);
      return day;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[prism] live generation failed, serving sample:`, err);
      recordFallback(reason);
      const day = await loadSampleDay(date);
      recordDayOutcome("sample", date, day.source);
      return day;
    } finally {
      clearPipeline();
    }
  })();

  inFlight.set(date, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(date);
  }
}
