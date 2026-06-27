import { describe, it, expect, vi } from "vitest";
import {
  latestTradingDay,
  PersonaRetryTimeoutError,
  withPersonaRetryTimeout,
} from "./dailyStore.js";

describe("latestTradingDay", () => {
  it("returns the prior day for a midweek date", () => {
    // Wednesday 2026-06-10 -> previous session Tuesday 2026-06-09
    expect(latestTradingDay(new Date("2026-06-10T12:00:00Z"))).toBe("2026-06-09");
  });

  it("skips back over the weekend from a Monday", () => {
    // Monday 2026-06-08 -> previous session Friday 2026-06-05
    expect(latestTradingDay(new Date("2026-06-08T12:00:00Z"))).toBe("2026-06-05");
  });

  it("returns Friday when run on a Sunday", () => {
    // Sunday 2026-06-07 -> previous session Friday 2026-06-05
    expect(latestTradingDay(new Date("2026-06-07T12:00:00Z"))).toBe("2026-06-05");
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
