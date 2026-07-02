import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  currentCalendarDate,
  listGeneratedHistory,
  PersonaRetryTimeoutError,
  readGeneratedHistoryDay,
  storeGeneratedDay,
  withPersonaRetryTimeout,
} from "./dailyStore.js";
import { loadSampleDay } from "./sampleData.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function historyFixture(
  date: string,
  source: "live" | "sample" = "live",
) {
  const sample = await loadSampleDay(date);
  return { ...sample, date, kind: "daily" as const, source };
}

describe("currentCalendarDate", () => {
  it("returns the current midweek date", () => {
    expect(currentCalendarDate(new Date(2026, 5, 10, 12))).toBe("2026-06-10");
  });

  it("does not roll weekends back to Friday", () => {
    expect(currentCalendarDate(new Date(2026, 5, 27, 12))).toBe("2026-06-27");
  });

  it("lists only prior generated live briefings without creating missing days", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "prism-history-"));
    tempDirs.push(cacheDir);
    await fs.writeFile(
      path.join(cacheDir, "2026-06-26.json"),
      JSON.stringify(await historyFixture("2026-06-26")),
    );
    await fs.writeFile(
      path.join(cacheDir, "2026-06-25.json"),
      JSON.stringify(await historyFixture("2026-06-25", "sample")),
    );
    await fs.writeFile(
      path.join(cacheDir, "2026-06-27.json"),
      JSON.stringify(await historyFixture("2026-06-27")),
    );

    const now = new Date(2026, 5, 27, 12);
    const history = await listGeneratedHistory(now, cacheDir);

    expect(history.map((entry) => entry.date)).toEqual(["2026-06-26"]);
    expect(history[0].briefings).toHaveLength(1);
    expect(await readGeneratedHistoryDay("2026-06-24", now, cacheDir)).toBeNull();
    expect(await readGeneratedHistoryDay("2026-06-27", now, cacheDir)).toBeNull();
    expect(await fs.readdir(cacheDir)).toHaveLength(3);
  });

  it("ends an interactive persona retry at its deadline", async () => {
    vi.useFakeTimers();
    try {
      const timed = withPersonaRetryTimeout(
        "contrarian",
        new Promise<string>(() => undefined),
        1_000,
      );
      const rejected = expect(timed).rejects.toBeInstanceOf(
        PersonaRetryTimeoutError,
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the newest briefing for Today and archives every generation", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "prism-refresh-"));
    tempDirs.push(cacheDir);
    const date = "2026-06-29";
    const first = {
      ...(await historyFixture(date)),
      generatedAt: "2026-06-29T15:00:00.000Z",
    };
    const latest = {
      ...first,
      generatedAt: "2026-06-29T20:00:00.000Z",
      keyPoints: first.keyPoints.slice(0, 3),
    };

    await storeGeneratedDay(date, first, cacheDir);
    await storeGeneratedDay(date, latest, cacheDir);

    const stored = JSON.parse(
      await fs.readFile(path.join(cacheDir, `${date}.json`), "utf8"),
    );
    expect(stored.generatedAt).toBe(latest.generatedAt);
    expect(stored.keyPoints).toHaveLength(3);

    const versions = await fs.readdir(path.join(cacheDir, "versions", date));
    expect(versions).toHaveLength(2);

    const history = await listGeneratedHistory(
      new Date("2026-06-30T12:00:00.000Z"),
      cacheDir,
    );
    expect(history[0].briefings.map((briefing) => briefing.generatedAt)).toEqual([
      latest.generatedAt,
      first.generatedAt,
    ]);
    expect(
      await readGeneratedHistoryDay(
        date,
        new Date("2026-06-30T12:00:00.000Z"),
        cacheDir,
        first.generatedAt,
      ),
    ).toMatchObject({ generatedAt: first.generatedAt });
  });

  it("persists a room read on the same briefing version", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "prism-room-read-"));
    tempDirs.push(cacheDir);
    const date = "2026-06-29";
    const first = {
      ...(await historyFixture(date)),
      generatedAt: "2026-06-29T15:00:00.000Z",
    };
    const updated = {
      ...first,
      roomRead: {
        generatedAt: "2026-06-29T15:05:00.000Z",
        briefing: "The lenses sharpened their independent cases.",
        strengthenedPovs: first.povs.slice(0, 3).map((pov) => ({
          ...pov,
          text: `${pov.text} The room made this bias more explicit.`,
        })),
        divergence: first.dayDivergence,
      },
    };

    await storeGeneratedDay(date, first, cacheDir);
    await storeGeneratedDay(date, updated, cacheDir);

    const versions = await fs.readdir(path.join(cacheDir, "versions", date));
    expect(versions).toHaveLength(1);
    const stored = JSON.parse(
      await fs.readFile(path.join(cacheDir, `${date}.json`), "utf8"),
    );
    expect(stored.generatedAt).toBe(first.generatedAt);
    expect(stored.roomRead.briefing).toContain("independent cases");

    const historical = await readGeneratedHistoryDay(
      date,
      new Date("2026-06-30T12:00:00.000Z"),
      cacheDir,
      first.generatedAt,
    );
    expect(historical?.roomRead?.strengthenedPovs).toHaveLength(3);
  });
});
