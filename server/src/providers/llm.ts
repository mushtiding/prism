import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { config } from "../config.js";
import { logEvent, redactSecrets, trackExternal } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_RESPONSE_LOG = path.resolve(
  __dirname,
  "../../logs/openrouter-raw-responses.log",
);

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export type LlmResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict?: boolean;
        schema: Record<string, unknown>;
      };
    };

export interface LlmGenerateOptions {
  maxTokens?: number;
  label?: string;
  responseFormat?: LlmResponseFormat;
  temperature?: number;
}

/**
 * Thin, swappable LLM interface (FR-9: generation source is model-agnostic).
 * The OpenRouter implementation talks to an OpenAI-compatible endpoint.
 */
export interface LlmClient {
  generate(messages: LlmMessage[], opts?: LlmGenerateOptions): Promise<string>;
}

interface ChatCompletionLike {
  choices: Array<{ message?: { content?: string | null } }>;
}

function reasoningConfig(): Record<string, unknown> {
  const effort = config.openRouterReasoning.trim().toLowerCase();
  if (effort && effort !== "none" && effort !== "off") {
    return { effort: config.openRouterReasoning, exclude: true };
  }
  return { exclude: true };
}

async function appendRawResponseLog(entry: {
  label: string;
  model: string;
  text: string;
}): Promise<void> {
  const header = [
    "",
    "================================================================================",
    `timestamp=${new Date().toISOString()}`,
    `label=${entry.label}`,
    `model=${entry.model}`,
    `chars=${entry.text.length}`,
    "raw:",
  ].join("\n");
  await fs.mkdir(path.dirname(RAW_RESPONSE_LOG), { recursive: true });
  await fs.appendFile(
    RAW_RESPONSE_LOG,
    `${header}\n${redactSecrets(entry.text)}\n`,
    "utf8",
  );
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
    opts: LlmGenerateOptions = {},
  ): Promise<string> {
    const label = opts.label ?? "chat completion";
    const maxTokens = opts.maxTokens ?? 1200;
    const temperature = opts.temperature ?? (opts.responseFormat ? 0.2 : 0.7);
    const track = trackExternal("OpenRouter", label);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let activeModel = config.openRouterModels[0] ?? config.openRouterModel;

    try {
      heartbeat = setInterval(() => {
        logEvent(
          `api ⏳ OpenRouter: ${label} (${activeModel}) still waiting…`,
        );
      }, 30_000);

      const failures: string[] = [];
      for (const model of config.openRouterModels) {
        activeModel = model;
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }

        try {
          const params = {
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
            ...(opts.responseFormat
              ? {
                  response_format: opts.responseFormat,
                  plugins: [{ id: "response-healing" }],
                }
              : {}),
            reasoning: reasoningConfig(),
            include_reasoning: false,
          };

          const request = this.client.chat.completions.create(
            // OpenRouter accepts a reasoning extension not present in SDK types.
            params as Parameters<OpenAI["chat"]["completions"]["create"]>[0],
          );

          const timed = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(
                new Error(
                  `OpenRouter ${label} (${model}) timed out after ${config.openRouterTimeoutMs}ms`,
                ),
              );
            }, config.openRouterTimeoutMs);
          });

          const completion = (await Promise.race([
            request,
            timed,
          ])) as ChatCompletionLike;
          const text = completion.choices[0]?.message?.content;
          if (!text) throw new Error("LLM returned empty content");
          await appendRawResponseLog({ label, model, text });
          logEvent(`OpenRouter raw response saved: ${RAW_RESPONSE_LOG}`);
          track.done(`${model} · ${text.length} chars`);
          return text;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          failures.push(`${model}: ${reason}`);
          logEvent(`OpenRouter model failed for ${label}: ${model} — ${reason}`);
        }
      }

      throw new Error(
        `All OpenRouter models failed for ${label}: ${failures.join(" | ")}`,
      );
    } catch (err) {
      track.fail(String(err));
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
    }
  }
}
