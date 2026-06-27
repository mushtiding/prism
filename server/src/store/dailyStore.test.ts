import { describe, it, expect, vi } from "vitest";
import {
  currentCalendarDate,
  PersonaRetryTimeoutError,
  withPersonaRetryTimeout,
} from "./dailyStore.js";

describe("currentCalendarDate", () => {
  it("returns the current midweek date", () => {
    expect(currentCalendarDate(new Date(2026, 5, 10, 12))).toBe("2026-06-10");
  });

  it("does not roll weekends back to Friday", () => {
    expect(currentCalendarDate(new Date(2026, 5, 27, 12))).toBe("2026-06-27");
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
