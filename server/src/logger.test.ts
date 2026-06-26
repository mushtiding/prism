import { describe, expect, it } from "vitest";
import { redactSecrets } from "./logger.js";

describe("redactSecrets", () => {
  it("redacts provider key material from diagnostic text", () => {
    const redacted = redactSecrets(
      "We have detected your API key as ABC123XYZ and apikey=ABC123XYZ",
    );

    expect(redacted).toContain("API key as [redacted]");
    expect(redacted).toContain("apikey=[redacted]");
    expect(redacted).not.toContain("ABC123XYZ");
  });
});
