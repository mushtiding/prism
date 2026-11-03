import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KeyPoint, PersonaPOV } from "@prism/shared";
import { PERSONAS, PERSONA_LIST } from "../domain/personas.js";
import {
  closeEvaluationDatabaseForTests,
  finishEvaluationRun,
  personaDefinitionVersion,
  recordAutomatedEvaluation,
  recordPersonaAttempt,
  recordPersonaOutput,
  recordProviderAttempt,
  setEvaluationDatabasePathForTests,
  startEvaluationRun,
} from "./storage.js";
import { exportDailyEvaluationReport } from "./reports.js";

const tempDirs: string[] = [];

afterEach(async () => {
  closeEvaluationDatabaseForTests();
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("daily evaluation reports", () => {
  it("exports aggregate, persona, and attempt CSV files", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prism-eval-"));
    tempDirs.push(directory);
    setEvaluationDatabasePathForTests(path.join(directory, "evaluation.sqlite"));

    const run = startEvaluationRun({
      date: "2026-07-07",
      workflow: "daily",
      trigger: "initial",
      stage: "first_impression",
      generatedAt: "2026-07-07T12:00:00.000Z",
      expectedPersonas: 5,
      personaVersion: personaDefinitionVersion(PERSONA_LIST),
    });
    const keyPoints: KeyPoint[] = [
      {
        id: "kp1",
        summary: "The S&P 500 rose 0.4%.",
        detail: "The broad index ended the session higher.",
        sources: [],
        divergence: {
          score: 0,
          level: "consensus",
          spread: 0,
          mostBullish: null,
          mostBearish: null,
        },
      },
    ];
    const pov: PersonaPOV = {
      personaId: "momentum",
      text: "The broad market finished higher, and the current price trend remains constructive while participation continues to improve.",
      activeBias: "following the current trend",
      stances: [
        {
          keyPointId: "kp1",
          label: "bullish",
          score: 1,
          rationale: "The index ended higher.",
        },
      ],
    };
    const attemptId = "attempt-1";
    recordPersonaAttempt({
      attemptId,
      run,
      personaId: "momentum",
      promptAttempt: 1,
      startedAt: "2026-07-07T12:00:01.000Z",
      latencyMs: 1200,
      outcome: "accepted",
      responseChars: 350,
    });
    recordProviderAttempt({
      telemetry: {
        runId: run.runId,
        promptAttemptId: attemptId,
        personaId: "momentum",
        stage: "first_impression",
        promptAttempt: 1,
      },
      providerAttempt: 1,
      model: "test/model",
      startedAt: "2026-07-07T12:00:01.000Z",
      latencyMs: 1000,
      outcome: "succeeded",
      responseChars: 350,
    });
    const outputId = recordPersonaOutput({
      run,
      persona: PERSONAS.momentum,
      pov,
      keyPoints,
      personaLatencyMs: 1200,
      retainText: true,
    });
    recordAutomatedEvaluation({
      outputId,
      model: "judge/model",
      evaluatorVersion: "test-v1",
      status: "complete",
      scores: {
        alignment: 4,
        thesis: 3,
        relevance: 4,
        plainLanguage: 4,
        internalCoherence: 4,
        unsupportedClaim: false,
        clearThesis: true,
        confidence: 0.9,
        rationale: "The response is focused and grounded.",
      },
    });
    finishEvaluationRun(run, {
      outcome: "partial",
      successfulPersonas: ["momentum"],
      expectedPersonaIds: PERSONA_LIST.map((persona) => persona.id),
      keyPointCount: 1,
      published: true,
    });

    const files = await exportDailyEvaluationReport("2026-07-07");
    const metrics = await fs.readFile(files.metricsPath, "utf8");
    const personas = await fs.readFile(files.personasPath, "utf8");
    const attempts = await fs.readFile(files.attemptsPath, "utf8");

    expect(metrics).toContain("persona_launch_failure_rate");
    expect(metrics).toContain("persona_quality_index");
    expect(personas).toContain("momentum");
    expect(personas).toContain("judge/model");
    expect(attempts).toContain("prompt");
    expect(attempts).toContain("provider");
  });
});
