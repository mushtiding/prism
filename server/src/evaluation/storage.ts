import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { KeyPoint, PersonaDef, PersonaId, PersonaPOV } from "@prism/shared";
import { logEvent } from "../logger.js";
import { evaluateDeterministically } from "./deterministic.js";
import type {
  EvaluationRunContext,
  EvaluationRunOutcome,
  EvaluationStage,
  EvaluationTrigger,
  EvaluationWorkflow,
  ProviderTelemetryContext,
  QualityScores,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../data/evaluation");
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, "prism-evaluation.sqlite");

export const PERSONA_PROMPT_VERSION = "persona-2026-07-07-v1";
export const GUARDRAIL_VERSION = "guardrails-2026-07-07-v1";
export const RUBRIC_VERSION = "persona-quality-2026-07-07-v1";

let database: DatabaseSync | null = null;
let databasePath = process.env.PRISM_EVALUATION_DB || DEFAULT_DB_PATH;
let storageWarningLogged = false;

function openDatabase(): DatabaseSync {
  if (database) return database;
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_runs (
      run_id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL,
      date TEXT NOT NULL,
      workflow TEXT NOT NULL,
      trigger TEXT NOT NULL,
      stage TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      published_at TEXT,
      completed_at TEXT,
      expected_personas INTEGER NOT NULL,
      initial_success_count INTEGER,
      missing_persona_ids TEXT,
      key_point_count INTEGER,
      outcome TEXT,
      failure_class TEXT,
      prompt_version TEXT NOT NULL,
      persona_version TEXT NOT NULL,
      app_version TEXT NOT NULL,
      interactive_retry_ordinal INTEGER,
      target_persona_id TEXT
    );

    CREATE TABLE IF NOT EXISTS persona_attempts (
      attempt_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      prompt_attempt INTEGER NOT NULL,
      interactive_retry_ordinal INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      failure_class TEXT,
      guardrail_codes TEXT,
      response_chars INTEGER,
      FOREIGN KEY(run_id) REFERENCES generation_runs(run_id)
    );

    CREATE TABLE IF NOT EXISTS provider_attempts (
      provider_attempt_id TEXT PRIMARY KEY,
      prompt_attempt_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      prompt_attempt INTEGER NOT NULL,
      provider_attempt INTEGER NOT NULL,
      interactive_retry_ordinal INTEGER,
      model TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      failure_class TEXT,
      response_chars INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      FOREIGN KEY(run_id) REFERENCES generation_runs(run_id)
    );

    CREATE TABLE IF NOT EXISTS persona_outputs (
      output_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      output_text TEXT,
      brief_json TEXT,
      accepted_at TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      persona_latency_ms INTEGER NOT NULL,
      qa_pass INTEGER NOT NULL,
      qa_codes TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      sentence_count INTEGER NOT NULL,
      average_sentence_words REAL NOT NULL,
      longest_sentence_words INTEGER NOT NULL,
      flesch_reading_ease REAL NOT NULL,
      flesch_kincaid_grade REAL NOT NULL,
      jargon_count INTEGER NOT NULL,
      stance_count INTEGER NOT NULL,
      stance_coverage REAL NOT NULL,
      label_score_conflicts INTEGER NOT NULL,
      duplicate_of_first INTEGER NOT NULL,
      guardrail_version TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES generation_runs(run_id)
    );

    CREATE TABLE IF NOT EXISTS automated_evaluations (
      evaluation_id TEXT PRIMARY KEY,
      output_id TEXT NOT NULL,
      evaluator_type TEXT NOT NULL,
      evaluator_model TEXT,
      evaluator_version TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      alignment REAL,
      thesis REAL,
      relevance REAL,
      plain_language REAL,
      internal_coherence REAL,
      unsupported_claim INTEGER,
      clear_thesis INTEGER,
      confidence REAL,
      rationale TEXT,
      status TEXT NOT NULL,
      error_class TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(output_id) REFERENCES persona_outputs(output_id)
    );

    CREATE TABLE IF NOT EXISTS human_evaluations (
      review_id TEXT PRIMARY KEY,
      output_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      alignment REAL,
      thesis REAL,
      relevance REAL,
      plain_language REAL,
      internal_coherence REAL,
      unsupported_claim INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(output_id) REFERENCES persona_outputs(output_id)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_date ON generation_runs(date);
    CREATE INDEX IF NOT EXISTS idx_attempts_run ON persona_attempts(run_id);
    CREATE INDEX IF NOT EXISTS idx_provider_run ON provider_attempts(run_id);
    CREATE INDEX IF NOT EXISTS idx_outputs_run ON persona_outputs(run_id);
    CREATE INDEX IF NOT EXISTS idx_evaluations_output ON automated_evaluations(output_id);
  `);
  const outputColumns = db
    .prepare("PRAGMA table_info(persona_outputs)")
    .all() as unknown as Array<{ name: string }>;
  if (!outputColumns.some((column) => column.name === "published")) {
    db.exec(
      "ALTER TABLE persona_outputs ADD COLUMN published INTEGER NOT NULL DEFAULT 0",
    );
  }
  const runColumns = db
    .prepare("PRAGMA table_info(generation_runs)")
    .all() as unknown as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === "interactive_retry_ordinal")) {
    db.exec("ALTER TABLE generation_runs ADD COLUMN interactive_retry_ordinal INTEGER");
  }
  if (!runColumns.some((column) => column.name === "target_persona_id")) {
    db.exec("ALTER TABLE generation_runs ADD COLUMN target_persona_id TEXT");
  }
  database = db;
  return db;
}

function safely<T>(operation: () => T, fallback: T): T {
  try {
    return operation();
  } catch (err) {
    if (!storageWarningLogged) {
      storageWarningLogged = true;
      logEvent(`evaluation storage unavailable: ${String(err)}`);
    }
    return fallback;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function personaDefinitionVersion(personas: PersonaDef[]): string {
  return hash(JSON.stringify(personas)).slice(0, 16);
}

export function briefIdentity(
  workflow: EvaluationWorkflow,
  date: string,
  generatedAt: string,
): string {
  return hash(`${workflow}:${date}:${generatedAt}`).slice(0, 24);
}

export function startEvaluationRun(input: {
  date: string;
  workflow: EvaluationWorkflow;
  trigger: EvaluationTrigger;
  stage: EvaluationStage;
  generatedAt: string;
  expectedPersonas: number;
  personaVersion: string;
  briefId?: string;
  interactiveRetryOrdinal?: number;
  targetPersonaId?: PersonaId;
}): EvaluationRunContext {
  const context: EvaluationRunContext = {
    runId: randomUUID(),
    briefId:
      input.briefId ?? briefIdentity(input.workflow, input.date, input.generatedAt),
    date: input.date,
    workflow: input.workflow,
    trigger: input.trigger,
    stage: input.stage,
    generatedAt: input.generatedAt,
    expectedPersonas: input.expectedPersonas,
    promptVersion: PERSONA_PROMPT_VERSION,
    personaVersion: input.personaVersion,
    appVersion: process.env.PRISM_GIT_COMMIT || "local",
    interactiveRetryOrdinal: input.interactiveRetryOrdinal,
    targetPersonaId: input.targetPersonaId,
  };
  safely(() => {
    openDatabase()
      .prepare(`
        INSERT INTO generation_runs (
          run_id, brief_id, date, workflow, trigger, stage, generated_at,
          started_at, expected_personas, prompt_version, persona_version, app_version,
          interactive_retry_ordinal, target_persona_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        context.runId,
        context.briefId,
        context.date,
        context.workflow,
        context.trigger,
        context.stage,
        context.generatedAt,
        new Date().toISOString(),
        context.expectedPersonas,
        context.promptVersion,
        context.personaVersion,
        context.appVersion,
        context.interactiveRetryOrdinal ?? null,
        context.targetPersonaId ?? null,
      );
  }, undefined);
  return context;
}

export function finishEvaluationRun(
  run: EvaluationRunContext,
  result: {
    outcome: EvaluationRunOutcome;
    successfulPersonas: PersonaId[];
    expectedPersonaIds?: PersonaId[];
    keyPointCount: number;
    failureClass?: string;
    published?: boolean;
  },
): void {
  const expected = result.expectedPersonaIds ?? [];
  const successful = new Set(result.successfulPersonas);
  const missing = expected.filter((personaId) => !successful.has(personaId));
  const now = new Date().toISOString();
  safely(() => {
    openDatabase()
      .prepare(`
        UPDATE generation_runs SET
          published_at = ?, completed_at = ?, initial_success_count = ?,
          missing_persona_ids = ?, key_point_count = ?, outcome = ?, failure_class = ?
        WHERE run_id = ?
      `)
      .run(
        result.published ? now : null,
        now,
        result.successfulPersonas.length,
        JSON.stringify(missing),
        result.keyPointCount,
        result.outcome,
        result.failureClass ?? null,
        run.runId,
      );
    openDatabase()
      .prepare("UPDATE persona_outputs SET published = ? WHERE run_id = ?")
      .run(result.published ? 1 : 0, run.runId);
  }, undefined);
  void import("./judge.js")
    .then(({ releaseQualityEvaluations }) => {
      releaseQualityEvaluations(run.runId, Boolean(result.published));
    })
    .catch((err) => logEvent(`quality evaluation queue unavailable: ${String(err)}`));
}

export function recordPersonaAttempt(input: {
  attemptId: string;
  run: EvaluationRunContext;
  personaId: PersonaId;
  promptAttempt: number;
  startedAt: string;
  latencyMs: number;
  outcome: "accepted" | "rejected" | "failed";
  failureClass?: string;
  guardrailCodes?: string[];
  responseChars?: number;
}): void {
  safely(() => {
    openDatabase()
      .prepare(`
        INSERT INTO persona_attempts (
          attempt_id, run_id, persona_id, stage, prompt_attempt,
          interactive_retry_ordinal, started_at, completed_at, latency_ms,
          outcome, failure_class, guardrail_codes, response_chars
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.attemptId,
        input.run.runId,
        input.personaId,
        input.run.stage,
        input.promptAttempt,
        input.run.interactiveRetryOrdinal ?? null,
        input.startedAt,
        new Date().toISOString(),
        Math.round(input.latencyMs),
        input.outcome,
        input.failureClass ?? null,
        JSON.stringify(input.guardrailCodes ?? []),
        input.responseChars ?? null,
      );
  }, undefined);
}

export function recordProviderAttempt(input: {
  telemetry: ProviderTelemetryContext;
  providerAttempt: number;
  model: string;
  startedAt: string;
  latencyMs: number;
  outcome: "succeeded" | "failed";
  failureClass?: string;
  responseChars?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): void {
  safely(() => {
    openDatabase()
      .prepare(`
        INSERT INTO provider_attempts (
          provider_attempt_id, prompt_attempt_id, run_id, persona_id, stage,
          prompt_attempt, provider_attempt, interactive_retry_ordinal, model,
          started_at, completed_at, latency_ms, outcome, failure_class,
          response_chars, input_tokens, output_tokens, total_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        input.telemetry.promptAttemptId,
        input.telemetry.runId,
        input.telemetry.personaId,
        input.telemetry.stage,
        input.telemetry.promptAttempt,
        input.providerAttempt,
        input.telemetry.interactiveRetryOrdinal ?? null,
        input.model,
        input.startedAt,
        new Date().toISOString(),
        Math.round(input.latencyMs),
        input.outcome,
        input.failureClass ?? null,
        input.responseChars ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.totalTokens ?? null,
      );
  }, undefined);
}

export function recordPersonaOutput(input: {
  run: EvaluationRunContext;
  persona: PersonaDef;
  pov: PersonaPOV;
  keyPoints: KeyPoint[];
  personaLatencyMs: number;
  firstPov?: PersonaPOV;
  retainText: boolean;
}): string {
  const outputId = randomUUID();
  const metrics = evaluateDeterministically(
    input.pov,
    input.keyPoints,
    input.persona,
    input.firstPov,
  );
  const revision = input.run.interactiveRetryOrdinal
    ? input.run.interactiveRetryOrdinal + 1
    : 1;
  safely(() => {
    openDatabase()
      .prepare(`
        INSERT INTO persona_outputs (
          output_id, run_id, persona_id, stage, revision, content_hash,
          output_text, brief_json, accepted_at, persona_latency_ms,
          qa_pass, qa_codes, word_count, sentence_count, average_sentence_words,
          longest_sentence_words, flesch_reading_ease, flesch_kincaid_grade,
          jargon_count, stance_count, stance_coverage, label_score_conflicts,
          duplicate_of_first, guardrail_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        outputId,
        input.run.runId,
        input.pov.personaId,
        input.run.stage,
        revision,
        hash(JSON.stringify(input.pov)),
        input.retainText ? input.pov.text : null,
        input.retainText ? JSON.stringify(input.keyPoints) : null,
        new Date().toISOString(),
        Math.round(input.personaLatencyMs),
        metrics.qaPass ? 1 : 0,
        JSON.stringify(metrics.qaCodes),
        metrics.wordCount,
        metrics.sentenceCount,
        metrics.averageSentenceWords,
        metrics.longestSentenceWords,
        metrics.fleschReadingEase,
        metrics.fleschKincaidGrade,
        metrics.jargonCount,
        input.pov.stances.length,
        metrics.stanceCoverage,
        metrics.labelScoreConflicts,
        metrics.duplicateOfFirst ? 1 : 0,
        GUARDRAIL_VERSION,
      );
  }, undefined);
  return outputId;
}

export function recordAutomatedEvaluation(input: {
  outputId: string;
  model: string;
  evaluatorVersion: string;
  status: "complete" | "failed" | "skipped";
  scores?: QualityScores;
  errorClass?: string;
}): void {
  const scores = input.scores;
  safely(() => {
    openDatabase()
      .prepare(`
        INSERT INTO automated_evaluations (
          evaluation_id, output_id, evaluator_type, evaluator_model,
          evaluator_version, rubric_version, alignment, thesis, relevance,
          plain_language, internal_coherence, unsupported_claim, clear_thesis,
          confidence, rationale, status, error_class, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        input.outputId,
        "llm_judge",
        input.model,
        input.evaluatorVersion,
        RUBRIC_VERSION,
        scores?.alignment ?? null,
        scores?.thesis ?? null,
        scores?.relevance ?? null,
        scores?.plainLanguage ?? null,
        scores?.internalCoherence ?? null,
        scores ? (scores.unsupportedClaim ? 1 : 0) : null,
        scores ? (scores.clearThesis ? 1 : 0) : null,
        scores?.confidence ?? null,
        scores?.rationale ?? null,
        input.status,
        input.errorClass ?? null,
        new Date().toISOString(),
      );
  }, undefined);
}

export function nextInteractiveRetryOrdinal(
  briefId: string,
  personaId: PersonaId,
  stage: EvaluationStage,
): number {
  return safely(() => {
    const row = openDatabase()
      .prepare(`
        SELECT MAX(interactive_retry_ordinal) AS ordinal
        FROM generation_runs
        WHERE brief_id = ? AND target_persona_id = ? AND stage = ?
          AND trigger = 'interactive_retry'
      `)
      .get(briefId, personaId, stage) as { ordinal: number | null } | undefined;
    return (row?.ordinal ?? 0) + 1;
  }, 1);
}

export function getEvaluationDatabase(): DatabaseSync {
  return openDatabase();
}

export function isPersonaOutputPublished(outputId: string): boolean {
  return safely(() => {
    const row = openDatabase()
      .prepare("SELECT published FROM persona_outputs WHERE output_id = ?")
      .get(outputId) as { published: number } | undefined;
    return row?.published === 1;
  }, false);
}

export function evaluationDatabasePath(): string {
  return databasePath;
}

export function setEvaluationDatabasePathForTests(nextPath: string): void {
  database?.close();
  database = null;
  databasePath = nextPath;
  storageWarningLogged = false;
}

export function closeEvaluationDatabaseForTests(): void {
  database?.close();
  database = null;
}
