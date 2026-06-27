import { Router } from "express";
import type { HealthStatus } from "@prism/shared";
import { config, isLiveMode } from "./config.js";
import { PERSONAS, PERSONA_LIST } from "./domain/personas.js";
import {
  getDay,
  latestTradingDay,
  PersonaRetryTimeoutError,
  retryMissingPersona,
} from "./store/dailyStore.js";
import {
  loadTimeMachineCatalog,
  loadTimeMachineDay,
} from "./store/sampleData.js";

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
    const date = latestTradingDay(now);
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
    const cacheKey = latestTradingDay(new Date());
    res.json(await retryMissingPersona(cacheKey, personaId as keyof typeof PERSONAS));
  } catch (err) {
    if (err instanceof PersonaRetryTimeoutError) {
      res.status(504).json({ error: "persona retry timed out" });
      return;
    }
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
    res.json(await getDay(date, new Date()));
  } catch (err) {
    next(err);
  }
});

router.get("/timemachine", async (_req, res, next) => {
  try {
    res.json(await loadTimeMachineCatalog());
  } catch (err) {
    next(err);
  }
});

router.get("/timemachine/:id", async (req, res, next) => {
  try {
    const day = await loadTimeMachineDay(req.params.id);
    if (!day) {
      res.status(404).json({ error: "unknown event" });
      return;
    }
    res.json(day);
  } catch (err) {
    next(err);
  }
});
