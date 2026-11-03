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
    return "The service is temporarily rate-limited. Your article was read, but the perspectives could not finish. Try again later.";
  }
  if (/timed out/i.test(message)) {
    return "The perspectives did not finish in time. Your article is still saved; try creating the brief again.";
  }
  if (/personas succeeded/i.test(message)) {
    return "Too few perspectives were ready to create a brief. Please try again.";
  }
  return "Your brief could not be created. Please try again.";
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
    progress: { phase: "queued", message: "Starting your brief" },
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
        progress: { phase: "complete", message: "Your brief is ready" },
        result,
      });
    })
    .catch((err: unknown) => {
      const result = err instanceof MyLensAnalysisError
        ? { articles: err.articles, day: null }
        : undefined;
      const error = publicError(err);
      logEvent(`your moves job ${jobId} failed: ${error}`);
      updateJob(jobId, {
        status: "failed",
        progress: { phase: "failed", message: "Brief unavailable" },
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
