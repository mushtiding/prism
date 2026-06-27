import { describe, expect, it } from "vitest";
import { isPrivateIp } from "./articleReader.js";

describe("article URL safety", () => {
  it("blocks local and private addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.4")).toBe(true);
    expect(isPrivateIp("172.16.8.2")).toBe(true);
    expect(isPrivateIp("192.168.1.5")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});
