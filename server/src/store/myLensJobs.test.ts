import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmRateLimitError, type LlmClient, type LlmMessage } from "../providers/llm.js";
import { clearArticleAnalysisCacheForTests } from "../pipeline/userArticles.js";
import {
  clearMyLensJobsForTests,
  getMyLensJob,
  startMyLensJob,
} from "./myLensJobs.js";

function validPov(messages: LlmMessage[]): string {
  const ids = [...(messages[1]?.content ?? "").matchAll(/^(article-[a-z0-9-]+):/gm)]
    .map((match) => match[1]);
  return JSON.stringify({
    text: "The article supports a measured reading of the market reaction.",
    activeBias: "weighing the selected signals",
    stances: ids.map((keyPointId) => ({
      keyPointId,
      label: "neutral",
      score: 0,
      rationale: "The available evidence remains mixed.",
    })),
  });
}

function validSummary(messages: LlmMessage[]): string {
  const ids = [
    ...(messages[1]?.content ?? "").matchAll(
      /^ID: (article-[a-z0-9-]+)$/gm,
    ),
  ].map((match) => match[1]);
  return JSON.stringify({
    articles: ids.map((id) => ({
      id,
      headline: "Company update shifts expectations across major financial markets",
      summary:
        "The article reports a company development with direct relevance to investors and the broader market. It identifies the financial event, the affected security, and the immediate market response.",
      keyFacts: [
        "The article describes a material company development.",
        "Investors assessed the news during the market session.",
      ],
    })),
  });
}

async function waitForJob(jobId: string) {
  await vi.waitFor(() => {
    expect(getMyLensJob(jobId)?.status).not.toBe("running");
  });
  return getMyLensJob(jobId)!;
}

describe("Your Moves jobs", () => {
  beforeEach(() => {
    clearMyLensJobsForTests();
    clearArticleAnalysisCacheForTests();
  });

  it("completes asynchronously with persona output", async () => {
    const llm: LlmClient = {
      async generate(messages): Promise<string> {
        if (messages[0]?.content.includes("neutral finance editor")) {
          return validSummary(messages);
        }
        return validPov(messages);
      },
    };
    const started = startMyLensJob(
      llm,
      [{ id: "one", value: "The Nasdaq stock market rose after earnings." }],
      new Date("2026-06-27T12:00:00.000Z"),
    );

    expect(started.status).toBe("running");
    const finished = await waitForJob(started.jobId);
    expect(finished.status).toBe("complete");
    expect(finished.progress.phase).toBe("complete");
    expect(finished.result?.day?.povs).toHaveLength(5);
  });

  it("preserves a valid article and explains a provider rate limit", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async generate(): Promise<string> {
        calls += 1;
        throw new LlmRateLimitError("429 Rate limit exceeded: free-models-per-day");
      },
    };
    const started = startMyLensJob(
      llm,
      [{ id: "one", value: "Eli Lilly shares rose after a major investment." }],
      new Date("2026-06-27T12:00:00.000Z"),
    );

    const finished = await waitForJob(started.jobId);
    expect(finished.status).toBe("failed");
    expect(finished.error).toMatch(/rate-limited/i);
    expect(finished.result?.articles[0].status).toBe("valid");
    expect(calls).toBe(6);
  });
});
