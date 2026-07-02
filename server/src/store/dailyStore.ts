import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DayContent,
  HistoryDaySummary,
  PersonaId,
  PersonaPOV,
} from "@prism/shared";
import { config, isLiveMode } from "../config.js";
import { clearPipeline, logEvent, recordDayOutcome, recordDayStarted, recordFallback, setPipeline } from "../logger.js";
import { OpenRouterClient } from "../providers/llm.js";
import { AlphaVantageProvider } from "../providers/marketData.js";
import { ResilientMarketDataProvider } from "../providers/resilientMarketData.js";
import { ArticleSummaryMarketDataProvider } from "../providers/articleSummaryMarketData.js";
import {
  generateDay,
  generatePersonaPov,
  generateRoomRead,
  generateRoomReadPersonaPov,
  mergePersonaPov,
  mergeRoomReadPov,
  RoomReadQuorumError,
  sanitizeRoomRead,
} from "../pipeline/generate.js";
import { loadSampleDay } from "./sampleData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, "../../cache");

// Coalesce concurrent misses for the same day onto one generation promise so
// content is generated exactly once (FR-9), never twice under load.
const inFlight = new Map<string, Promise<DayContent>>();
const personaRetries = new Map<string, Promise<DayContent>>();
const roomReadRequests = new Map<string, Promise<DayContent>>();
const roomReadPersonaRetries = new Map<string, Promise<DayContent>>();
const cacheUpdates = new Map<string, Promise<void>>();

export const PERSONA_RETRY_TIMEOUT_MS = 60_000;

export class PersonaRetryTimeoutError extends Error {
  constructor(personaId: PersonaId, timeoutMs = PERSONA_RETRY_TIMEOUT_MS) {
    super(`${personaId} retry timed out after ${timeoutMs}ms`);
    this.name = "PersonaRetryTimeoutError";
  }
}

export class RoomReadUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomReadUnavailableError";
  }
}

function cacheFile(date: string, cacheDir = CACHE_DIR): string {
  return path.join(cacheDir, `${date}.json`);
}

function versionDirectory(date: string, cacheDir = CACHE_DIR): string {
  return path.join(cacheDir, "versions", date);
}

function versionFile(
  date: string,
  generatedAt: string,
  cacheDir = CACHE_DIR,
): string {
  const parsed = Date.parse(generatedAt);
  const version = Number.isFinite(parsed)
    ? String(parsed)
    : generatedAt.replace(/[^a-z0-9]+/gi, "-");
  return path.join(versionDirectory(date, cacheDir), `${version}.json`);
}

async function readCache(
  date: string,
  cacheDir = CACHE_DIR,
): Promise<DayContent | null> {
  try {
    const raw = await fs.readFile(cacheFile(date, cacheDir), "utf8");
    return sanitizeRoomRead(JSON.parse(raw) as DayContent);
  } catch {
    return null;
  }
}

function normalizeHistoricalDay(date: string, day: DayContent): DayContent {
  return day.date === date ? day : { ...day, date };
}

async function readVersionedDays(
  date: string,
  cacheDir = CACHE_DIR,
): Promise<DayContent[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(versionDirectory(date, cacheDir))).filter((file) =>
      file.endsWith(".json"),
    );
  } catch {
    // Legacy caches have only the latest top-level date file.
  }

  const archived = await Promise.all(
    files.map(async (file) => {
      try {
        const raw = await fs.readFile(
          path.join(versionDirectory(date, cacheDir), file),
          "utf8",
        );
        return sanitizeRoomRead(JSON.parse(raw) as DayContent);
      } catch {
        return null;
      }
    }),
  );
  const latest = await readCache(date, cacheDir);
  const byGeneratedAt = new Map<string, DayContent>();

  for (const day of [...archived, latest]) {
    if (
      !day ||
      day.kind !== "daily" ||
      day.source !== "live" ||
      !day.generatedAt
    ) {
      continue;
    }
    byGeneratedAt.set(day.generatedAt, normalizeHistoricalDay(date, day));
  }

  return [...byGeneratedAt.values()].sort(
    (left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt),
  );
}

/** Read one prior generated briefing without invoking the generation pipeline. */
export async function readGeneratedHistoryDay(
  date: string,
  now = new Date(),
  cacheDir = CACHE_DIR,
  generatedAt?: string,
): Promise<DayContent | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (date >= currentCalendarDate(now)) return null;

  const versions = await readVersionedDays(date, cacheDir);
  return generatedAt
    ? versions.find((day) => day.generatedAt === generatedAt) ?? null
    : versions[0] ?? null;
}

/** List prior live briefings that already exist on disk, newest first. */
export async function listGeneratedHistory(
  now = new Date(),
  cacheDir = CACHE_DIR,
): Promise<HistoryDaySummary[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(cacheDir);
  } catch {
    // The versions directory may still exist without a latest pointer.
  }

  let versionDates: string[] = [];
  try {
    versionDates = (await fs.readdir(path.join(cacheDir, "versions"), {
      withFileTypes: true,
    }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // No versioned briefings yet.
  }

  const dates = [
    ...new Set([
      ...files
        .map((file) => file.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
        .filter((date): date is string => Boolean(date)),
      ...versionDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
    ]),
  ].sort((a, b) => b.localeCompare(a));
  const days = await Promise.all(
    dates.map(async (date) => ({
      date,
      briefings:
        date < currentCalendarDate(now)
          ? await readVersionedDays(date, cacheDir)
          : [],
    })),
  );

  return days.flatMap(({ date, briefings }) =>
    briefings.length > 0
      ? [
          {
            date,
            briefings: briefings.map((day) => ({
              generatedAt: day.generatedAt,
              keyPointCount: day.keyPoints.length,
              personaCount: day.povs.length,
              leadSummary:
                day.keyPoints[0]?.summary ?? "Generated market briefing",
            })),
          },
        ]
      : [],
  );
}

// The requested date owns both a latest pointer and immutable generation slots,
// even when the market provider reports a different trading-session date.
async function writeJsonAtomically(
  target: string,
  day: DayContent,
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const pending = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(pending, JSON.stringify(day, null, 2), "utf8");
    await fs.rename(pending, target);
  } finally {
    await fs.rm(pending, { force: true });
  }
}

export async function storeGeneratedDay(
  key: string,
  day: DayContent,
  cacheDir = CACHE_DIR,
): Promise<void> {
  const previous = await readCache(key, cacheDir);
  if (
    previous?.kind === "daily" &&
    previous.source === "live" &&
    previous.generatedAt !== day.generatedAt
  ) {
    await writeJsonAtomically(
      versionFile(key, previous.generatedAt, cacheDir),
      normalizeHistoricalDay(key, previous),
    );
  }
  if (day.kind === "daily" && day.source === "live") {
    await writeJsonAtomically(
      versionFile(key, day.generatedAt, cacheDir),
      normalizeHistoricalDay(key, day),
    );
  }
  await writeJsonAtomically(cacheFile(key, cacheDir), day);
}

async function queueCacheUpdate(
  cacheKey: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = cacheUpdates.get(cacheKey) ?? Promise.resolve();
  const update = previous.catch(() => undefined).then(operation);
  cacheUpdates.set(cacheKey, update);
  try {
    await update;
  } finally {
    if (cacheUpdates.get(cacheKey) === update) cacheUpdates.delete(cacheKey);
  }
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
  let updated: DayContent | null = null;
  await queueCacheUpdate(cacheKey, async () => {
    const current = await readCache(cacheKey);
    if (!current) throw new Error(`No cached day found for ${cacheKey}`);
    updated = mergePersonaPov(current, pov);
    await storeGeneratedDay(cacheKey, updated);
  });
  if (!updated) throw new Error(`Failed to update cached day ${cacheKey}`);
  return updated;
}

/** Current calendar date in the server's local timezone. */
export function currentCalendarDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function generateAndCacheLiveDay(
  date: string,
  now: Date,
  phase: "daily generation" | "daily refresh",
): Promise<DayContent> {
  setPipeline(phase, date);
  const llm = new OpenRouterClient(config.openRouterApiKey!);
  const market = new ArticleSummaryMarketDataProvider(
    new ResilientMarketDataProvider(
      new AlphaVantageProvider(config.alphaVantageApiKey!),
    ),
  );
  const day = await generateDay(llm, market, now.toISOString(), date);
  setPipeline("cache write", date);
  await queueCacheUpdate(date, () => storeGeneratedDay(date, day));
  return day;
}

/**
 * Get the day's content: serve cache if present; otherwise generate once,
 * cache, and serve. Persona failures are retained as unavailable lenses on a
 * live briefing; only failures that prevent building the briefing itself fall
 * back to the bundled sample day, badged source:"sample" (FR-9).
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

      const day = await generateAndCacheLiveDay(date, now, "daily generation");
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

/** Force a fresh briefing, promote it to latest, and retain prior generations. */
export async function regenerateDay(date: string, now: Date): Promise<DayContent> {
  if (!isLiveMode()) throw new Error("Briefing refresh requires live mode");

  const existing = inFlight.get(date);
  if (existing) {
    logEvent(`day refresh already in flight · ${date}; joining existing request`);
    return existing;
  }

  const promise = (async (): Promise<DayContent> => {
    try {
      logEvent(`day refresh started · ${date}`);
      const day = await generateAndCacheLiveDay(date, now, "daily refresh");
      recordDayOutcome("live", date, day.source);
      logEvent(`day refresh accepted · ${date} · ${day.keyPoints.length} key points`);
      return day;
    } catch (err) {
      console.error(`[prism] day refresh failed; existing cache preserved:`, err);
      throw err;
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

/** Reveal and persist one independent second pass for the latest briefing. */
export async function revealRoomRead(cacheKey: string): Promise<DayContent> {
  const cached = await readCache(cacheKey);
  if (!cached) throw new RoomReadUnavailableError(`No cached day found for ${cacheKey}`);
  if (cached.roomRead) return cached;
  if (cached.kind !== "daily" || cached.source !== "live") {
    throw new RoomReadUnavailableError("Room Read requires a live daily briefing");
  }
  if (cached.povs.length < 2) {
    throw new RoomReadUnavailableError(
      "Room Read needs at least two available first impressions",
    );
  }
  if (!isLiveMode()) {
    throw new RoomReadUnavailableError("Room Read requires live mode");
  }

  const requestKey = `${cacheKey}:${cached.generatedAt}`;
  const existing = roomReadRequests.get(requestKey);
  if (existing) {
    logEvent(`room read already in flight · ${cacheKey}; joining request`);
    return existing;
  }

  const request = (async () => {
    try {
      setPipeline("room read", `${cached.povs.length} parallel second-pass lenses`);
      logEvent(`room read started · ${cacheKey} · ${cached.generatedAt}`);
      const llm = new OpenRouterClient(config.openRouterApiKey!);
      let roomRead;
      try {
        roomRead = await generateRoomRead(
          llm,
          cached.keyPoints,
          cached.povs,
          new Date().toISOString(),
        );
      } catch (err) {
        if (err instanceof RoomReadQuorumError) {
          throw new RoomReadUnavailableError(
            `Room Read reached ${err.completed}/${cached.povs.length} strengthened lenses; ${err.required} are required. Try again.`,
          );
        }
        throw err;
      }
      let updated: DayContent | null = null;
      await queueCacheUpdate(cacheKey, async () => {
        const current = await readCache(cacheKey);
        if (!current || current.generatedAt !== cached.generatedAt) {
          throw new RoomReadUnavailableError(
            "The briefing changed while Room Read was being generated. Reveal the new briefing instead.",
          );
        }
        updated = current.roomRead ? current : { ...current, roomRead };
        await storeGeneratedDay(cacheKey, updated);
      });
      if (!updated) throw new Error(`Failed to update cached day ${cacheKey}`);
      return updated;
    } finally {
      clearPipeline();
    }
  })();

  roomReadRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    roomReadRequests.delete(requestKey);
  }
}

/** Retry one missing or duplicate Room Read lens without regenerating peers. */
export async function retryMissingRoomReadPersona(
  cacheKey: string,
  personaId: PersonaId,
): Promise<DayContent> {
  const cached = await readCache(cacheKey);
  if (!cached) throw new RoomReadUnavailableError(`No cached day found for ${cacheKey}`);
  if (!cached.roomRead) {
    throw new RoomReadUnavailableError("Reveal Room Read before retrying a lens");
  }
  if (!cached.povs.some((pov) => pov.personaId === personaId)) {
    throw new RoomReadUnavailableError(
      `No first impression is available for ${personaId}`,
    );
  }
  if (cached.roomRead.strengthenedPovs.some((pov) => pov.personaId === personaId)) {
    return cached;
  }
  if (!isLiveMode()) {
    throw new RoomReadUnavailableError("Room Read retries require live mode");
  }

  const retryKey = `${cacheKey}:${cached.generatedAt}:room-read:${personaId}`;
  const existing = roomReadPersonaRetries.get(retryKey);
  if (existing) {
    logEvent(`room read persona retry already in flight · ${personaId}; joining request`);
    return existing;
  }

  const request = (async () => {
    try {
      setPipeline(
        "room read retry",
        `${personaId} · ${PERSONA_RETRY_TIMEOUT_MS / 1000}s limit`,
      );
      logEvent(`room read persona retry started · ${personaId} · ${cacheKey}`);
      const llm = new OpenRouterClient(config.openRouterApiKey!);
      let pov: PersonaPOV;
      try {
        pov = await withPersonaRetryTimeout(
          personaId,
          generateRoomReadPersonaPov(
            llm,
            personaId,
            cached.keyPoints,
            cached.povs,
          ),
        );
      } catch (err) {
        if (err instanceof PersonaRetryTimeoutError) throw err;
        logEvent(`room read persona retry failed · ${personaId} · ${String(err)}`);
        throw new RoomReadUnavailableError(
          `${personaId} did not return a distinct strengthened read. Try again.`,
        );
      }

      let updated: DayContent | null = null;
      await queueCacheUpdate(cacheKey, async () => {
        const current = await readCache(cacheKey);
        if (!current || current.generatedAt !== cached.generatedAt) {
          throw new RoomReadUnavailableError(
            "The briefing changed during the retry. Open the latest briefing instead.",
          );
        }
        updated = mergeRoomReadPov(current, pov, new Date().toISOString());
        await storeGeneratedDay(cacheKey, updated);
      });
      if (!updated) throw new Error(`Failed to update cached day ${cacheKey}`);
      logEvent(`room read persona retry accepted · ${personaId}`);
      return updated;
    } finally {
      clearPipeline();
    }
  })();

  roomReadPersonaRetries.set(retryKey, request);
  try {
    return await request;
  } finally {
    roomReadPersonaRetries.delete(retryKey);
  }
}
