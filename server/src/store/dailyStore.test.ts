import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  currentCalendarDate,
  listGeneratedHistory,
  PersonaRetryTimeoutError,
  readGeneratedHistoryDay,
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
});
