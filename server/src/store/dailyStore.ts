import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DayContent, PersonaId, PersonaPOV } from "@prism/shared";
import { config, isLiveMode } from "../config.js";
import { clearPipeline, logEvent, recordDayOutcome, recordDayStarted, recordFallback, setPipeline } from "../logger.js";
import { OpenRouterClient } from "../providers/llm.js";
import { AlphaVantageProvider } from "../providers/marketData.js";
import { ResilientMarketDataProvider } from "../providers/resilientMarketData.js";
import {
  generateDay,
  generatePersonaPov,
  mergePersonaPov,
} from "../pipeline/generate.js";
import { loadSampleDay } from "./sampleData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, "../../cache");

// Coalesce concurrent misses for the same day onto one generation promise so
// content is generated exactly once (FR-9), never twice under load.
const inFlight = new Map<string, Promise<DayContent>>();
const personaRetries = new Map<string, Promise<DayContent>>();
const cacheUpdates = new Map<string, Promise<void>>();

export const PERSONA_RETRY_TIMEOUT_MS = 60_000;

export class PersonaRetryTimeoutError extends Error {
  constructor(personaId: PersonaId, timeoutMs = PERSONA_RETRY_TIMEOUT_MS) {
    super(`${personaId} retry timed out after ${timeoutMs}ms`);
    this.name = "PersonaRetryTimeoutError";
  }
}

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

export async function withPersonaRetryTimeout<T>(
  personaId: PersonaId,
  request: Promise<T>,
  timeoutMs = PERSONA_RETRY_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new PersonaRetryTimeoutError(personaId, timeoutMs)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mergePovIntoCache(
  cacheKey: string,
  pov: PersonaPOV,
): Promise<DayContent> {
  const previous = cacheUpdates.get(cacheKey) ?? Promise.resolve();
  let updated: DayContent | null = null;
  const update = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await readCache(cacheKey);
      if (!current) throw new Error(`No cached day found for ${cacheKey}`);
      updated = mergePersonaPov(current, pov);
      await writeCache(cacheKey, updated);
    });

  cacheUpdates.set(cacheKey, update);
  try {
    await update;
    if (!updated) throw new Error(`Failed to update cached day ${cacheKey}`);
    return updated;
  } finally {
    if (cacheUpdates.get(cacheKey) === update) cacheUpdates.delete(cacheKey);
  }
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

export async function retryMissingPersona(
  cacheKey: string,
  personaId: PersonaId,
): Promise<DayContent> {
  const cached = await readCache(cacheKey);
  if (!cached) throw new Error(`No cached day found for ${cacheKey}`);

  if (cached.povs.some((pov) => pov.personaId === personaId)) return cached;
  if (!isLiveMode()) throw new Error("Persona retries require live mode");

  const retryKey = `${cacheKey}:${personaId}`;
  const existing = personaRetries.get(retryKey);
  if (existing) {
    logEvent(`persona retry already in flight · ${personaId}; joining request`);
    return existing;
  }

  const request = (async () => {
    try {
      setPipeline("persona retry", `${personaId} · ${PERSONA_RETRY_TIMEOUT_MS / 1000}s limit`);
      logEvent(`persona retry started · ${personaId} · cached day ${cacheKey}`);
      const llm = new OpenRouterClient(config.openRouterApiKey!);
      const pov = await withPersonaRetryTimeout(
        personaId,
        generatePersonaPov(llm, personaId, cached.keyPoints),
      );
      const updated = await mergePovIntoCache(cacheKey, pov);
      logEvent(`persona retry accepted · ${personaId} · ${updated.povs.length}/5 lenses`);
      return updated;
    } finally {
      clearPipeline();
    }
  })();

  personaRetries.set(retryKey, request);
  try {
    return await request;
  } finally {
    personaRetries.delete(retryKey);
  }
}
