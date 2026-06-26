import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import { OpenRouterClient } from "./llm.js";

function clientWithCompletion(completion: unknown): OpenRouterClient {
  const client = new OpenRouterClient("test-key");
  (
    client as unknown as {
      client: {
        chat: {
          completions: {
            create: () => Promise<unknown>;
          };
        };
      };
    }
  ).client = {
    chat: {
      completions: {
        create: async () => completion,
      },
    },
  };
  return client;
}

describe("OpenRouterClient", () => {
  it("returns the first choice message content", async () => {
    const originalModels = config.openRouterModels;
    config.openRouterModels = ["test-model"];
    try {
      const client = clientWithCompletion({
        choices: [{ message: { content: "{\"ok\":true}" } }],
      });

      await expect(client.generate([], { label: "test" })).resolves.toBe(
        "{\"ok\":true}",
      );
    } finally {
      config.openRouterModels = originalModels;
    }
  });

  it("throws a diagnostic error when OpenRouter returns no choices", async () => {
    const originalModels = config.openRouterModels;
    config.openRouterModels = ["test-model"];
    try {
      const client = clientWithCompletion({ id: "empty-response" });

      await expect(client.generate([], { label: "test" })).rejects.toThrow(
        /missing choices\[0\]\.message\.content/,
      );
    } finally {
      config.openRouterModels = originalModels;
    }
  });
});
