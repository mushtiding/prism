import { Router } from "express";
import type { HealthStatus, MyLensArticleInput } from "@prism/shared";
import { config, isLiveMode } from "./config.js";
import { PERSONAS, PERSONA_LIST } from "./domain/personas.js";
import {
  getDay,
  currentCalendarDate,
  listGeneratedHistory,
  PersonaRetryTimeoutError,
  readGeneratedHistoryDay,
  retryMissingPersona,
} from "./store/dailyStore.js";
import { OpenRouterClient } from "./providers/llm.js";
import {
  MAX_MY_LENS_ARTICLES,
} from "./pipeline/userArticles.js";
import { getMyLensJob, startMyLensJob } from "./store/myLensJobs.js";

export const router = Router();

router.get("/health", (_req, res) => {
  const status: HealthStatus = {
    ok: true,
    mode: isLiveMode() ? "live" : "sample",
    hasLlmKey: Boolean(config.openRouterApiKey),
    hasMarketKey: Boolean(config.alphaVantageApiKey),
    model: config.openRouterModel,
  };
  res.json(status);
});

router.get("/personas", (_req, res) => {
  res.json(PERSONA_LIST);
});

router.get("/day/latest", async (_req, res, next) => {
  try {
    const now = new Date();
    const date = currentCalendarDate(now);
    res.json(await getDay(date, now));
  } catch (err) {
    next(err);
  }
});

router.post("/day/latest/personas/:personaId/retry", async (req, res, next) => {
  const personaId = req.params.personaId;
  if (!Object.hasOwn(PERSONAS, personaId)) {
    res.status(400).json({ error: "unknown persona" });
    return;
  }

  try {
    const cacheKey = currentCalendarDate(new Date());
    res.json(await retryMissingPersona(cacheKey, personaId as keyof typeof PERSONAS));
  } catch (err) {
    if (err instanceof PersonaRetryTimeoutError) {
      res.status(504).json({ error: "persona retry timed out" });
      return;
    }
    next(err);
  }
});

router.post("/my-lens/analyze", (req, res) => {
  const articles = req.body?.articles as MyLensArticleInput[] | undefined;
  const validShape =
    Array.isArray(articles) &&
    articles.length >= 1 &&
    articles.length <= MAX_MY_LENS_ARTICLES &&
    articles.every(
      (article) =>
        article &&
        typeof article.id === "string" &&
        article.id.length >= 1 &&
        article.id.length <= 80 &&
        typeof article.value === "string" &&
        article.value.trim().length >= 1 &&
        article.value.length <= 50_000,
    ) &&
    new Set(articles.map((article) => article.id)).size === articles.length;

  if (!validShape) {
    res.status(400).json({ error: "Provide one to five non-empty articles." });
    return;
  }
  if (!config.openRouterApiKey) {
    res.status(503).json({ error: "Your Moves requires an OpenRouter API key." });
    return;
  }

  const llm = new OpenRouterClient(config.openRouterApiKey);
  const job = startMyLensJob(llm, articles);
  res.status(202).json({ jobId: job.jobId });
});

router.get("/my-lens/jobs/:jobId", (req, res) => {
  const job = getMyLensJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Analysis job not found or expired." });
    return;
  }
  res.json(job);
});

router.get("/history", async (_req, res, next) => {
  try {
    res.json(await listGeneratedHistory());
  } catch (err) {
    next(err);
  }
});

router.get("/history/:date", async (req, res, next) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    const day = await readGeneratedHistoryDay(date);
    if (!day) {
      res.status(404).json({ error: "No generated briefing exists for this prior date." });
      return;
    }
    res.json(day);
  } catch (err) {
    next(err);
  }
});

router.get("/day/:date", async (req, res, next) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    const now = new Date();
    if (date !== currentCalendarDate(now)) {
      res.status(404).json({
        error: "Only today's briefing can be generated. History contains existing prior briefings.",
      });
      return;
    }
    res.json(await getDay(date, now));
  } catch (err) {
    next(err);
  }
});
