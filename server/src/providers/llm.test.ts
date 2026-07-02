import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import { LlmRateLimitError, OpenRouterClient } from "./llm.js";

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

  it("explicitly disables model reasoning when reasoning is configured off", async () => {
    const originalModels = config.openRouterModels;
    const originalReasoning = config.openRouterReasoning;
    config.openRouterModels = ["test-model"];
    config.openRouterReasoning = "none";
    let request: Record<string, unknown> | undefined;
    try {
      const client = clientWithCompletion({
        choices: [{ message: { content: "{\"ok\":true}" } }],
      });
      (
        client as unknown as {
          client: {
            chat: {
              completions: {
                create: (params: Record<string, unknown>) => Promise<unknown>;
              };
            };
          };
        }
      ).client.chat.completions.create = async (params) => {
        request = params;
        return { choices: [{ message: { content: "{\"ok\":true}" } }] };
      };

      await client.generate([], { label: "test" });

      expect(request?.reasoning).toEqual({ enabled: false, exclude: true });
    } finally {
      config.openRouterModels = originalModels;
      config.openRouterReasoning = originalReasoning;
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

  it("classifies an all-model 429 as a non-retryable rate limit", async () => {
    const originalModels = config.openRouterModels;
    config.openRouterModels = ["test-model"];
    try {
      const client = clientWithCompletion(null);
      (
        client as unknown as {
          client: { chat: { completions: { create: () => Promise<unknown> } } };
        }
      ).client.chat.completions.create = async () => {
        throw new Error("429 Rate limit exceeded: free-models-per-day");
      };

      await expect(client.generate([], { label: "test" })).rejects.toBeInstanceOf(
        LlmRateLimitError,
      );
    } finally {
      config.openRouterModels = originalModels;
    }
  });
});
