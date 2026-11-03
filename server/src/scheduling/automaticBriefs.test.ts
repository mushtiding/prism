import { describe, expect, it } from "vitest";
import { dueAutomaticBriefSlots } from "./automaticBriefs.js";

const slots = ["09:30", "13:30"] as const;

describe("automatic brief schedule", () => {
  it("does not generate before the first local slot", () => {
    expect(
      dueAutomaticBriefSlots(new Date(2026, 6, 7, 9, 29), slots, []),
    ).toEqual([]);
  });

  it("catches up the first slot during the middle of the day", () => {
    expect(
      dueAutomaticBriefSlots(new Date(2026, 6, 7, 11, 0), slots, []),
    ).toEqual(["09:30"]);
  });

  it("catches up only incomplete slots after both times have passed", () => {
    expect(
      dueAutomaticBriefSlots(
        new Date(2026, 6, 7, 16, 0),
        slots,
        ["09:30"],
      ),
    ).toEqual(["13:30"]);
  });
});
