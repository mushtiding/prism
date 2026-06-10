import OpenAI from "openai";
import { config } from "../config.js";

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Thin, swappable LLM interface (FR-9: generation source is model-agnostic).
 * The OpenRouter implementation talks to an OpenAI-compatible endpoint.
 */
export interface LlmClient {
  generate(messages: LlmMessage[], opts?: { maxTokens?: number }): Promise<string>;
}

export class OpenRouterClient implements LlmClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://prism.local",
        "X-Title": "Prism",
      },
    });
  }

  async generate(
    messages: LlmMessage[],
    opts: { maxTokens?: number } = {},
  ): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: config.openRouterModel,
      messages,
      max_tokens: opts.maxTokens ?? 1200,
      temperature: 0.7,
      // Nemotron-3 supports a reasoning effort knob via OpenRouter.
      // @ts-expect-error reasoning is an OpenRouter extension not in the SDK types
      reasoning: { effort: config.openRouterReasoning },
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error("LLM returned empty content");
    return text;
  }
}
