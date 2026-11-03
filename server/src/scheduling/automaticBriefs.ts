import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isLiveMode } from "../config.js";
import { logEvent } from "../logger.js";
import {
  currentCalendarDate,
  regenerateDay,
} from "../store/dailyStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.resolve(__dirname, "../../data/automatic-briefs");
const SWEEP_INTERVAL_MS = 60_000;
const FAILURE_RETRY_MS = 15 * 60_000;

interface CompletedSlot {
  slot: string;
  generatedAt: string;
  keyPointCount: number;
  personaCount: number;
}

interface DayScheduleState {
  date: string;
  completed: CompletedSlot[];
}

const retryAfter = new Map<string, number>();
let sweepInFlight = false;

function stateFile(date: string): string {
  return path.join(STATE_DIR, `${date}.json`);
}

function localTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function dueAutomaticBriefSlots(
  now: Date,
  slots: readonly string[],
  completedSlots: Iterable<string>,
): string[] {
  const completed = new Set(completedSlots);
  const current = localTime(now);
  return slots.filter((slot) => slot <= current && !completed.has(slot));
}

async function readState(date: string): Promise<DayScheduleState> {
  try {
    const raw = await fs.readFile(stateFile(date), "utf8");
    const parsed = JSON.parse(raw) as Partial<DayScheduleState>;
    return {
      date,
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter(
            (item): item is CompletedSlot =>
              Boolean(
                item &&
                  typeof item.slot === "string" &&
                  typeof item.generatedAt === "string",
              ),
          )
        : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logEvent(`automatic brief state reset · ${date} · ${String(err)}`);
    }
    return { date, completed: [] };
  }
}

async function writeState(state: DayScheduleState): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const target = stateFile(state.date);
  const pending = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(pending, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(pending, target);
  } finally {
    await fs.rm(pending, { force: true });
  }
}

async function completeSlot(
  state: DayScheduleState,
  slot: string,
): Promise<DayScheduleState> {
  logEvent(`automatic brief started · ${state.date} · ${slot}`);
  const day = await regenerateDay(state.date, new Date(), {
    trigger: "scheduled",
  });
  const next: DayScheduleState = {
    ...state,
    completed: [
      ...state.completed.filter((item) => item.slot !== slot),
      {
        slot,
        generatedAt: day.generatedAt,
        keyPointCount: day.keyPoints.length,
        personaCount: day.povs.length,
      },
    ].sort((left, right) => left.slot.localeCompare(right.slot)),
  };
  await writeState(next);
  retryAfter.delete(`${state.date}:${slot}`);
  logEvent(
    `automatic brief ready · ${state.date} · ${slot} · ${day.keyPoints.length} drivers · ${day.povs.length}/5 lenses`,
  );
  return next;
}

export async function runAutomaticBriefSweep(now = new Date()): Promise<void> {
  if (sweepInFlight || !isLiveMode()) return;
  sweepInFlight = true;
  try {
    const date = currentCalendarDate(now);
    let state = await readState(date);
    const due = dueAutomaticBriefSlots(
      now,
      config.automaticBriefTimes,
      state.completed.map((item) => item.slot),
    );

    for (const slot of due) {
      const retryKey = `${date}:${slot}`;
      if ((retryAfter.get(retryKey) ?? 0) > Date.now()) continue;
      try {
        state = await completeSlot(state, slot);
      } catch (err) {
        retryAfter.set(retryKey, Date.now() + FAILURE_RETRY_MS);
        logEvent(
          `automatic brief failed · ${date} · ${slot} · retrying in 15m · ${String(err)}`,
        );
      }
    }
  } finally {
    sweepInFlight = false;
  }
}

export function startAutomaticBriefScheduler(): void {
  if (!isLiveMode()) {
    logEvent("automatic briefs disabled · live API keys are required");
    return;
  }
  logEvent(
    `automatic briefs scheduled · ${config.automaticBriefTimes.join(" and ")} local time`,
  );
  void runAutomaticBriefSweep();
  const timer = setInterval(() => {
    void runAutomaticBriefSweep();
  }, SWEEP_INTERVAL_MS);
  timer.unref();
}
