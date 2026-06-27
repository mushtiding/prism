import { randomUUID } from "node:crypto";
import type {
  MyLensArticleInput,
  MyLensJobProgress,
  MyLensJobStatus,
} from "@prism/shared";
import { clearPipeline, logEvent } from "../logger.js";
import type { LlmClient } from "../providers/llm.js";
import {
  analyzeMyLensArticles,
  MyLensAnalysisError,
} from "../pipeline/userArticles.js";

const JOB_TTL_MS = 30 * 60_000;
const MAX_JOBS = 50;
const jobs = new Map<string, MyLensJobStatus>();

function publicError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/(?:\b429\b|rate limit|free-models-per-)/i.test(message)) {
    return "Nemotron is rate-limited right now. The article was read, but the persona lenses could not finish. Try again later.";
  }
  if (/timed out/i.test(message)) {
    return "Nemotron did not respond in time. The article was read; try the persona analysis again.";
  }
  if (/personas succeeded/i.test(message)) {
    return "Too few persona lenses returned valid responses. Please try again.";
  }
  return "The analysis could not finish. Please try again.";
}

function pruneJobs(now = Date.now()): void {
  for (const [id, job] of jobs) {
    if (now - Date.parse(job.updatedAt) > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size >= MAX_JOBS) {
    const oldest = jobs.keys().next().value as string | undefined;
    if (!oldest) break;
    jobs.delete(oldest);
  }
}

function updateJob(
  jobId: string,
  updates: Partial<Omit<MyLensJobStatus, "jobId" | "startedAt">>,
): void {
  const current = jobs.get(jobId);
  if (!current) return;
  jobs.set(jobId, {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}

export function startMyLensJob(
  llm: LlmClient,
  articles: MyLensArticleInput[],
  now = new Date(),
): MyLensJobStatus {
  pruneJobs(now.getTime());
  const jobId = randomUUID();
  const startedAt = now.toISOString();
  const job: MyLensJobStatus = {
    jobId,
    status: "running",
    progress: { phase: "queued", message: "Starting analysis" },
    startedAt,
    updatedAt: startedAt,
  };
  jobs.set(jobId, job);

  void analyzeMyLensArticles(
    llm,
    articles,
    startedAt,
    (progress: MyLensJobProgress) => updateJob(jobId, { progress }),
  )
    .then((result) => {
      updateJob(jobId, {
        status: "complete",
        progress: { phase: "complete", message: "Analysis complete" },
        result,
      });
    })
    .catch((err: unknown) => {
      const result = err instanceof MyLensAnalysisError
        ? { articles: err.articles, day: null }
        : undefined;
      const error = publicError(err);
      logEvent(`my lens job ${jobId} failed: ${error}`);
      updateJob(jobId, {
        status: "failed",
        progress: { phase: "failed", message: "Analysis unavailable" },
        result,
        error,
      });
    })
    .finally(() => clearPipeline());

  return job;
}

export function getMyLensJob(jobId: string): MyLensJobStatus | undefined {
  pruneJobs();
  return jobs.get(jobId);
}

export function clearMyLensJobsForTests(): void {
  jobs.clear();
}
