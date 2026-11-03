import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { config } from "../config.js";
import { logEvent, redactSecrets, trackExternal } from "../logger.js";
import { recordProviderAttempt } from "../evaluation/storage.js";
import type { ProviderTelemetryContext } from "../evaluation/types.js";

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
  telemetry?: ProviderTelemetryContext;
}

/**
 * Thin, swappable LLM interface (FR-9: generation source is model-agnostic).
 * The OpenRouter implementation talks to an OpenAI-compatible endpoint.
 */
export interface LlmClient {
  generate(messages: LlmMessage[], opts?: LlmGenerateOptions): Promise<string>;
}

export class LlmRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRateLimitError";
  }
}

export class LlmModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmModelUnavailableError";
  }
}

function isRateLimitMessage(message: string): boolean {
  return /(?:\b429\b|rate limit|free-models-per-)/i.test(message);
}

function isModelUnavailableMessage(message: string): boolean {
  return /(?:\b404\b|no endpoints? found|model (?:not found|unavailable)|unknown model)/i.test(
    message,
  );
}

interface ChatCompletionLike {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function reasoningConfig(): Record<string, unknown> {
  const effort = config.openRouterReasoning.trim().toLowerCase();
  if (effort && effort !== "none" && effort !== "off") {
    return { effort: config.openRouterReasoning, exclude: true };
  }
  return { enabled: false, exclude: true };
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

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

async function extractCompletionText(
  completion: ChatCompletionLike | null | undefined,
  label: string,
  model: string,
): Promise<string> {
  const text = completion?.choices?.[0]?.message?.content;
  if (typeof text === "string" && text.trim()) return text;

  const errorMessage = completion?.error?.message;
  const payload = stringifyForLog(completion);
  await appendRawResponseLog({
    label,
    model,
    text: `NON_TEXT_OPENROUTER_RESPONSE\n${payload}`,
  });
  logEvent(`OpenRouter non-text response saved: ${RAW_RESPONSE_LOG}`);

  throw new Error(
    errorMessage
      ? `OpenRouter response error: ${errorMessage}`
      : "OpenRouter response missing choices[0].message.content",
  );
}

export class OpenRouterClient implements LlmClient {
  private client: OpenAI;
  private models: string[];

  constructor(apiKey: string, options: { models?: string[] } = {}) {
    this.models = options.models?.length ? options.models : config.openRouterModels;
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
    let activeModel = this.models[0] ?? config.openRouterModel;

    try {
      heartbeat = setInterval(() => {
        logEvent(
          `api ⏳ OpenRouter: ${label} (${activeModel}) still waiting…`,
        );
      }, 30_000);

      const failures: string[] = [];
      for (const [modelIndex, model] of this.models.entries()) {
        activeModel = model;
        const providerStartedAt = new Date().toISOString();
        const providerStarted = performance.now();
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
          const text = await extractCompletionText(completion, label, model);
          if (opts.telemetry) {
            recordProviderAttempt({
              telemetry: opts.telemetry,
              providerAttempt: modelIndex + 1,
              model,
              startedAt: providerStartedAt,
              latencyMs: performance.now() - providerStarted,
              outcome: "succeeded",
              responseChars: text.length,
              inputTokens: completion.usage?.prompt_tokens,
              outputTokens: completion.usage?.completion_tokens,
              totalTokens: completion.usage?.total_tokens,
            });
          }
          await appendRawResponseLog({ label, model, text });
          logEvent(`OpenRouter raw response saved: ${RAW_RESPONSE_LOG}`);
          track.done(`${model} · ${text.length} chars`);
          return text;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (opts.telemetry) {
            recordProviderAttempt({
              telemetry: opts.telemetry,
              providerAttempt: modelIndex + 1,
              model,
              startedAt: providerStartedAt,
              latencyMs: performance.now() - providerStarted,
              outcome: "failed",
              failureClass: classifyProviderFailure(reason),
            });
          }
          failures.push(`${model}: ${reason}`);
          logEvent(`OpenRouter model failed for ${label}: ${model} — ${reason}`);
        }
      }

      const message = `All OpenRouter models failed for ${label}: ${failures.join(" | ")}`;
      if (failures.length > 0 && failures.every(isRateLimitMessage)) {
        throw new LlmRateLimitError(message);
      }
      if (failures.length > 0 && failures.every(isModelUnavailableMessage)) {
        throw new LlmModelUnavailableError(message);
      }
      throw new Error(message);
    } catch (err) {
      track.fail(String(err));
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
    }
  }
}

function classifyProviderFailure(message: string): string {
  if (isRateLimitMessage(message)) return "provider_rate_limit";
  if (isModelUnavailableMessage(message)) return "provider_unavailable";
  if (/timed out/i.test(message)) return "provider_timeout";
  if (/network|socket|ECONN|fetch failed/i.test(message)) return "network_error";
  if (/missing choices|non-text|empty/i.test(message)) return "empty_response";
  return "unknown";
}
