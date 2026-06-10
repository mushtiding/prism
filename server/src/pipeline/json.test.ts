import { describe, it, expect } from "vitest";
import { extractJson } from "./json.js";

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips think blocks before parsing", () => {
    expect(
      extractJson('<think>let me reason</think>\n{"a":1}'),
    ).toEqual({ a: 1 });
  });

  it("extracts an object embedded in prose", () => {
    expect(
      extractJson('Here is the result: {"a":1,"b":[2,3]} — done.'),
    ).toEqual({ a: 1, b: [2, 3] });
  });

  it("extracts an array", () => {
    expect(extractJson("prefix [1,2,3] suffix")).toEqual([1, 2, 3]);
  });

  it("throws when no JSON present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
