import { promises as fs } from "node:fs";
import path from "node:path";
import { PERSONA_IDS } from "@prism/shared";
import {
  evaluationDatabasePath,
  getEvaluationDatabase,
} from "./storage.js";

interface RunRow {
  run_id: string;
  workflow: string;
  trigger: string;
  stage: string;
  expected_personas: number;
  initial_success_count: number | null;
  missing_persona_ids: string | null;
  outcome: string | null;
  started_at: string;
  published_at: string | null;
  completed_at: string | null;
  interactive_retry_ordinal: number | null;
}

interface AttemptRow {
  run_id: string;
  persona_id: string;
  workflow: string;
  trigger: string;
  stage: string;
  prompt_attempt: number;
  interactive_retry_ordinal: number | null;
  latency_ms: number;
  outcome: string;
  failure_class: string | null;
  guardrail_codes: string;
  response_chars: number | null;
  completed_at: string;
}

interface ProviderRow {
  run_id: string;
  persona_id: string;
  workflow: string;
  trigger: string;
  stage: string;
  prompt_attempt: number;
  provider_attempt: number;
  model: string;
  latency_ms: number;
  outcome: string;
  failure_class: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

interface OutputRow {
  output_id: string;
  run_id: string;
  persona_id: string;
  workflow: string;
  trigger: string;
  stage: string;
  brief_id: string;
  prompt_version: string;
  persona_version: string;
  app_version: string;
  persona_latency_ms: number;
  published: number;
  qa_pass: number;
  qa_codes: string;
  word_count: number;
  flesch_kincaid_grade: number;
  jargon_count: number;
  stance_coverage: number;
  label_score_conflicts: number;
  duplicate_of_first: number;
}

interface EvaluationRow {
  output_id: string;
  persona_id: string;
  workflow: string;
  stage: string;
  brief_id: string;
  status: string;
  evaluator_model: string | null;
  evaluator_version: string;
  rubric_version: string;
  alignment: number | null;
  thesis: number | null;
  relevance: number | null;
  plain_language: number | null;
  internal_coherence: number | null;
  unsupported_claim: number | null;
  clear_thesis: number | null;
  confidence: number | null;
}

interface MetricRow {
  date: string;
  metric: string;
  scope_type: string;
  scope_value: string;
  value: number | "";
  numerator: number | "";
  denominator: number | "";
  sample_size: number;
  unit: string;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(quantile * ordered.length) - 1),
  );
  return ordered[index];
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function elapsedMs(start: string, end: string | null): number | null {
  if (!end) return null;
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function metric(
  date: string,
  name: string,
  value: number,
  options: {
    scopeType?: string;
    scopeValue?: string;
    numerator?: number;
    denominator?: number;
    sampleSize?: number;
    unit?: string;
  } = {},
): MetricRow {
  return {
    date,
    metric: name,
    scope_type: options.scopeType ?? "overall",
    scope_value: options.scopeValue ?? "all",
    value:
      (options.sampleSize ?? 0) === 0 && (options.unit ?? "count") !== "count"
        ? ""
        : rounded(value),
    numerator: options.numerator ?? "",
    denominator: options.denominator ?? "",
    sample_size: options.sampleSize ?? 0,
    unit: options.unit ?? "count",
  };
}

function rateMetric(
  date: string,
  name: string,
  numerator: number,
  denominator: number,
  options: { scopeType?: string; scopeValue?: string } = {},
): MetricRow {
  return metric(date, name, denominator > 0 ? numerator / denominator : 0, {
    ...options,
    numerator,
    denominator,
    sampleSize: denominator,
    unit: "ratio",
  });
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(
  rows: Array<Record<string, unknown>>,
  fallbackHeaders: string[] = [],
): string {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : fallbackHeaders;
  if (headers.length === 0) return "";
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ].join("\n") + "\n";
}

async function writeAtomically(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const pending = `${target}.${process.pid}.tmp`;
  await fs.writeFile(pending, content, "utf8");
  await fs.rename(pending, target);
}

function qualityIndex(row: EvaluationRow): number | null {
  const values = [
    row.alignment,
    row.thesis,
    row.relevance,
    row.plain_language,
    row.internal_coherence,
  ];
  if (values.some((value) => value === null)) return null;
  return (
    ((row.alignment! * 0.3 +
      row.thesis! * 0.25 +
      row.relevance! * 0.25 +
      row.plain_language! * 0.15 +
      row.internal_coherence! * 0.05) /
      4) *
    100
  );
}

function buildMetrics(
  date: string,
  runs: RunRow[],
  attempts: AttemptRow[],
  providers: ProviderRow[],
  outputs: OutputRow[],
  evaluations: EvaluationRow[],
): MetricRow[] {
  const rows: MetricRow[] = [];
  const publishedOutputs = outputs.filter((output) => output.published === 1);
  const launchRuns = runs.filter(
    (run) =>
      run.workflow === "daily" &&
      run.stage === "first_impression" &&
      ["initial", "refresh", "scheduled"].includes(run.trigger),
  );
  const expectedSlots = launchRuns.reduce(
    (sum, run) => sum + run.expected_personas,
    0,
  );
  const successfulSlots = launchRuns.reduce(
    (sum, run) => sum + (run.initial_success_count ?? 0),
    0,
  );
  const fullCast = launchRuns.filter(
    (run) => run.initial_success_count === run.expected_personas,
  ).length;
  const quorumOnly = launchRuns.filter((run) => {
    const count = run.initial_success_count ?? 0;
    return count >= 3 && count < run.expected_personas;
  }).length;

  rows.push(metric(date, "generation_runs", runs.length, { sampleSize: runs.length }));
  rows.push(
    metric(date, "missing_personas_at_publish", expectedSlots - successfulSlots, {
      sampleSize: launchRuns.length,
    }),
    rateMetric(
      date,
      "persona_launch_failure_rate",
      expectedSlots - successfulSlots,
      expectedSlots,
    ),
    rateMetric(date, "full_cast_publish_rate", fullCast, launchRuns.length),
    rateMetric(date, "quorum_only_publish_rate", quorumOnly, launchRuns.length),
  );
  for (const personaId of PERSONA_IDS) {
    const failures = launchRuns.filter((run) => {
      try {
        return (JSON.parse(run.missing_persona_ids ?? "[]") as string[]).includes(
          personaId,
        );
      } catch {
        return false;
      }
    }).length;
    rows.push(
      rateMetric(
        date,
        "persona_launch_failure_rate",
        failures,
        launchRuns.length,
        { scopeType: "persona", scopeValue: personaId },
      ),
    );
  }

  const briefPublishLatencies = launchRuns
    .map((run) => elapsedMs(run.started_at, run.published_at))
    .filter((value): value is number => value !== null);
  const quorumLatencies: number[] = [];
  const fullCastLatencies: number[] = [];
  for (const run of launchRuns) {
    const accepted = attempts
      .filter(
        (attempt) =>
          attempt.run_id === run.run_id && attempt.outcome === "accepted",
      )
      .sort(
        (left, right) =>
          Date.parse(left.completed_at) - Date.parse(right.completed_at),
      );
    if (accepted.length >= 3) {
      const value = Date.parse(accepted[2].completed_at) - Date.parse(run.started_at);
      if (value >= 0) quorumLatencies.push(value);
    }
    if (accepted.length >= run.expected_personas) {
      const value =
        Date.parse(accepted[run.expected_personas - 1].completed_at) -
        Date.parse(run.started_at);
      if (value >= 0) fullCastLatencies.push(value);
    }
  }
  rows.push(
    metric(
      date,
      "brief_publish_latency_p95_ms",
      percentile(briefPublishLatencies, 0.95),
      {
        sampleSize: briefPublishLatencies.length,
        unit: "milliseconds",
      },
    ),
    metric(date, "time_to_quorum_p95_ms", percentile(quorumLatencies, 0.95), {
      sampleSize: quorumLatencies.length,
      unit: "milliseconds",
    }),
    metric(date, "time_to_full_cast_p95_ms", percentile(fullCastLatencies, 0.95), {
      sampleSize: fullCastLatencies.length,
      unit: "milliseconds",
    }),
  );

  const publishedOutputKeys = new Set(
    publishedOutputs.map((output) => `${output.run_id}:${output.persona_id}`),
  );
  const publishedAttempts = attempts.filter((attempt) =>
    publishedOutputKeys.has(`${attempt.run_id}:${attempt.persona_id}`),
  );
  const firstAttemptAccepted = publishedAttempts.filter(
    (attempt) =>
      attempt.prompt_attempt === 1 &&
      attempt.outcome === "accepted" &&
      publishedOutputKeys.has(`${attempt.run_id}:${attempt.persona_id}`),
  ).length;
  rows.push(
    rateMetric(
      date,
      "first_prompt_attempt_success_rate",
      firstAttemptAccepted,
      publishedOutputs.length,
    ),
    metric(
      date,
      "mean_prompt_attempts_per_output",
      publishedOutputs.length > 0
        ? publishedAttempts.length / publishedOutputs.length
        : 0,
      { sampleSize: publishedOutputs.length, unit: "attempts" },
    ),
  );

  const qaPasses = publishedOutputs.filter((output) => output.qa_pass === 1).length;
  const adviceViolations = publishedOutputs.filter((output) =>
    output.qa_codes.includes("advice_violation"),
  ).length;
  rows.push(
    rateMetric(date, "final_qa_pass_rate", qaPasses, publishedOutputs.length),
    rateMetric(date, "advice_violation_rate", adviceViolations, publishedOutputs.length),
    metric(date, "mean_grade_level", average(publishedOutputs.map((row) => row.flesch_kincaid_grade)), {
      sampleSize: publishedOutputs.length,
      unit: "grade",
    }),
    rateMetric(
      date,
      "grade_10_or_below_rate",
      publishedOutputs.filter((output) => output.flesch_kincaid_grade <= 10).length,
      publishedOutputs.length,
    ),
  );

  const personaLatencies = publishedOutputs.map((output) => output.persona_latency_ms);
  const providerLatencies = providers
    .filter((provider) => provider.outcome === "succeeded")
    .map((provider) => provider.latency_ms);
  for (const [name, quantile] of [
    ["p50", 0.5],
    ["p90", 0.9],
    ["p95", 0.95],
  ] as const) {
    rows.push(
      metric(date, `persona_time_to_valid_${name}_ms`, percentile(personaLatencies, quantile), {
        sampleSize: personaLatencies.length,
        unit: "milliseconds",
      }),
      metric(date, `provider_latency_${name}_ms`, percentile(providerLatencies, quantile), {
        sampleSize: providerLatencies.length,
        unit: "milliseconds",
      }),
    );
  }

  const retryRuns = runs.filter((run) => run.trigger === "interactive_retry");
  const recoveredRetries = retryRuns.filter((run) => run.outcome === "published").length;
  const retryOrdinals = retryRuns
    .filter((run) => run.outcome === "published")
    .map((run) => run.interactive_retry_ordinal)
    .filter((value): value is number => value !== null);
  rows.push(
    metric(date, "interactive_retry_requests", retryRuns.length, {
      sampleSize: retryRuns.length,
    }),
    rateMetric(
      date,
      "interactive_retry_recovery_rate",
      recoveredRetries,
      retryRuns.length,
    ),
    metric(date, "retry_ordinal_to_recovery_p50", percentile(retryOrdinals, 0.5), {
      sampleSize: retryOrdinals.length,
      unit: "retries",
    }),
    metric(date, "retry_ordinal_to_recovery_p90", percentile(retryOrdinals, 0.9), {
      sampleSize: retryOrdinals.length,
      unit: "retries",
    }),
  );
  const retryLatencies = retryRuns
    .map((run) => elapsedMs(run.started_at, run.completed_at))
    .filter((value): value is number => value !== null);
  const secondViewRuns = runs.filter(
    (run) => run.workflow === "room_read" && run.trigger === "room_read",
  );
  const secondViewLatencies = secondViewRuns
    .map((run) => elapsedMs(run.started_at, run.completed_at))
    .filter((value): value is number => value !== null);
  rows.push(
    metric(
      date,
      "interactive_retry_latency_p95_ms",
      percentile(retryLatencies, 0.95),
      { sampleSize: retryLatencies.length, unit: "milliseconds" },
    ),
    metric(
      date,
      "second_view_latency_p95_ms",
      percentile(secondViewLatencies, 0.95),
      { sampleSize: secondViewLatencies.length, unit: "milliseconds" },
    ),
  );

  const completedEvaluations = evaluations.filter(
    (evaluation) => evaluation.status === "complete",
  );
  const unsupportedClaims = completedEvaluations.filter(
    (evaluation) => evaluation.unsupported_claim === 1,
  ).length;
  const indexes = completedEvaluations
    .map(qualityIndex)
    .filter((value): value is number => value !== null);
  rows.push(
    rateMetric(
      date,
      "automated_evaluation_completion_rate",
      completedEvaluations.length,
      publishedOutputs.length,
    ),
    metric(date, "persona_quality_index", average(indexes), {
      sampleSize: indexes.length,
      unit: "score_0_100",
    }),
    rateMetric(
      date,
      "unsupported_material_claim_rate",
      unsupportedClaims,
      completedEvaluations.length,
    ),
  );

  for (const field of [
    "alignment",
    "thesis",
    "relevance",
    "plain_language",
    "internal_coherence",
  ] as const) {
    const values = completedEvaluations
      .map((evaluation) => evaluation[field])
      .filter((value): value is number => value !== null);
    rows.push(
      metric(date, `mean_${field}_score`, average(values), {
        sampleSize: values.length,
        unit: "score_0_4",
      }),
      rateMetric(
        date,
        `${field}_score_3_or_4_rate`,
        values.filter((value) => value >= 3).length,
        values.length,
      ),
    );
  }

  const firstByBriefPersona = new Map<string, EvaluationRow>();
  for (const evaluation of completedEvaluations) {
    if (evaluation.stage === "first_impression") {
      firstByBriefPersona.set(
        `${evaluation.brief_id}:${evaluation.persona_id}`,
        evaluation,
      );
    }
  }
  const secondPairs = completedEvaluations.flatMap((evaluation) => {
    if (evaluation.stage !== "second_view") return [];
    const first = firstByBriefPersona.get(
      `${evaluation.brief_id}:${evaluation.persona_id}`,
    );
    return first ? [{ first, second: evaluation }] : [];
  });
  rows.push(
    metric(
      date,
      "second_view_thesis_improvement",
      average(
        secondPairs.map(
          ({ first, second }) => (second.thesis ?? 0) - (first.thesis ?? 0),
        ),
      ),
      { sampleSize: secondPairs.length, unit: "score_delta" },
    ),
    metric(
      date,
      "second_view_alignment_delta",
      average(
        secondPairs.map(
          ({ first, second }) =>
            (second.alignment ?? 0) - (first.alignment ?? 0),
        ),
      ),
      { sampleSize: secondPairs.length, unit: "score_delta" },
    ),
  );

  for (const workflow of [...new Set(publishedOutputs.map((output) => output.workflow))]) {
    const workflowOutputs = publishedOutputs.filter((output) => output.workflow === workflow);
    const workflowEvaluations = completedEvaluations.filter(
      (evaluation) => evaluation.workflow === workflow,
    );
    const workflowIndexes = workflowEvaluations
      .map(qualityIndex)
      .filter((value): value is number => value !== null);
    rows.push(
      rateMetric(
        date,
        "qa_pass_rate",
        workflowOutputs.filter((output) => output.qa_pass === 1).length,
        workflowOutputs.length,
        { scopeType: "workflow", scopeValue: workflow },
      ),
      metric(date, "quality_index", average(workflowIndexes), {
        scopeType: "workflow",
        scopeValue: workflow,
        sampleSize: workflowIndexes.length,
        unit: "score_0_100",
      }),
    );
  }

  for (const model of [...new Set(providers.map((provider) => provider.model))]) {
    const modelAttempts = providers.filter((provider) => provider.model === model);
    const successes = modelAttempts.filter(
      (provider) => provider.outcome === "succeeded",
    );
    rows.push(
      rateMetric(
        date,
        "provider_success_rate",
        successes.length,
        modelAttempts.length,
        { scopeType: "model", scopeValue: model },
      ),
      metric(
        date,
        "provider_latency_p95_ms",
        percentile(
          successes.map((provider) => provider.latency_ms),
          0.95,
        ),
        {
          scopeType: "model",
          scopeValue: model,
          sampleSize: successes.length,
          unit: "milliseconds",
        },
      ),
    );
  }

  const failureClasses = [
    ...attempts.map((attempt) => attempt.failure_class),
    ...providers.map((provider) => provider.failure_class),
  ].filter((value): value is string => Boolean(value));
  for (const code of [...new Set(failureClasses)].sort()) {
    rows.push(
      metric(
        date,
        "failure_count",
        failureClasses.filter((value) => value === code).length,
        { scopeType: "failure_class", scopeValue: code },
      ),
    );
  }

  const guardrailCodes = attempts.flatMap((attempt) => {
    try {
      return JSON.parse(attempt.guardrail_codes) as string[];
    } catch {
      return [];
    }
  });
  for (const code of [...new Set(guardrailCodes)].sort()) {
    rows.push(
      metric(
        date,
        "guardrail_failure_count",
        guardrailCodes.filter((value) => value === code).length,
        { scopeType: "guardrail", scopeValue: code },
      ),
    );
  }

  const personas = [...new Set(publishedOutputs.map((output) => output.persona_id))].sort();
  for (const personaId of personas) {
    const personaOutputs = publishedOutputs.filter((output) => output.persona_id === personaId);
    const personaEvaluations = completedEvaluations.filter(
      (evaluation) => evaluation.persona_id === personaId,
    );
    const personaIndexes = personaEvaluations
      .map(qualityIndex)
      .filter((value): value is number => value !== null);
    rows.push(
      rateMetric(
        date,
        "qa_pass_rate",
        personaOutputs.filter((output) => output.qa_pass === 1).length,
        personaOutputs.length,
        { scopeType: "persona", scopeValue: personaId },
      ),
      metric(date, "quality_index", average(personaIndexes), {
        scopeType: "persona",
        scopeValue: personaId,
        sampleSize: personaIndexes.length,
        unit: "score_0_100",
      }),
      metric(
        date,
        "persona_time_to_valid_p95_ms",
        percentile(
          personaOutputs.map((output) => output.persona_latency_ms),
          0.95,
        ),
        {
          scopeType: "persona",
          scopeValue: personaId,
          sampleSize: personaOutputs.length,
          unit: "milliseconds",
        },
      ),
    );
  }

  return rows;
}

export async function exportDailyEvaluationReport(date: string): Promise<{
  metricsPath: string;
  personasPath: string;
  attemptsPath: string;
}> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("evaluation report date must be YYYY-MM-DD");
  }
  const db = getEvaluationDatabase();
  const runs = db
    .prepare("SELECT * FROM generation_runs WHERE date = ?")
    .all(date) as unknown as RunRow[];
  const attempts = db
    .prepare(`
      SELECT pa.*, gr.workflow, gr.trigger
      FROM persona_attempts pa
      JOIN generation_runs gr ON gr.run_id = pa.run_id
      WHERE gr.date = ?
    `)
    .all(date) as unknown as AttemptRow[];
  const providers = db
    .prepare(`
      SELECT pp.*, gr.workflow, gr.trigger
      FROM provider_attempts pp
      JOIN generation_runs gr ON gr.run_id = pp.run_id
      WHERE gr.date = ?
    `)
    .all(date) as unknown as ProviderRow[];
  const outputs = db
    .prepare(`
      SELECT po.*, gr.workflow, gr.trigger, gr.brief_id, gr.prompt_version,
             gr.persona_version, gr.app_version
      FROM persona_outputs po
      JOIN generation_runs gr ON gr.run_id = po.run_id
      WHERE gr.date = ?
    `)
    .all(date) as unknown as OutputRow[];
  const evaluations = db
    .prepare(`
      SELECT ae.*, po.persona_id, gr.workflow, gr.stage, gr.brief_id
      FROM automated_evaluations ae
      JOIN persona_outputs po ON po.output_id = ae.output_id
      JOIN generation_runs gr ON gr.run_id = po.run_id
      WHERE gr.date = ?
    `)
    .all(date) as unknown as EvaluationRow[];

  const metrics = buildMetrics(date, runs, attempts, providers, outputs, evaluations);
  const personaDetails = outputs.map((output) => {
    const evaluation = evaluations.find(
      (candidate) =>
        candidate.output_id === output.output_id && candidate.status === "complete",
    );
    return {
      date,
      ...output,
      evaluator_status: evaluation?.status ?? "pending",
      evaluator_model: evaluation?.evaluator_model ?? "",
      alignment: evaluation?.alignment ?? "",
      thesis: evaluation?.thesis ?? "",
      relevance: evaluation?.relevance ?? "",
      plain_language: evaluation?.plain_language ?? "",
      internal_coherence: evaluation?.internal_coherence ?? "",
      unsupported_claim: evaluation?.unsupported_claim ?? "",
      clear_thesis: evaluation?.clear_thesis ?? "",
      confidence: evaluation?.confidence ?? "",
      quality_index: evaluation ? (qualityIndex(evaluation) ?? "") : "",
    };
  });
  const attemptDetails = [
    ...attempts.map((attempt) => ({ date, layer: "prompt", ...attempt })),
    ...providers.map((provider) => ({ date, layer: "provider", ...provider })),
  ];

  const reportsDir = path.join(path.dirname(evaluationDatabasePath()), "reports");
  const metricsPath = path.join(reportsDir, `${date}-metrics.csv`);
  const personasPath = path.join(reportsDir, `${date}-personas.csv`);
  const attemptsPath = path.join(reportsDir, `${date}-attempts.csv`);
  await Promise.all([
    writeAtomically(metricsPath, toCsv(metrics as unknown as Array<Record<string, unknown>>)),
    writeAtomically(
      personasPath,
      toCsv(
        personaDetails as unknown as Array<Record<string, unknown>>,
        [
          "date",
          "output_id",
          "run_id",
          "persona_id",
          "workflow",
          "stage",
          "qa_pass",
          "word_count",
          "flesch_kincaid_grade",
          "persona_latency_ms",
          "evaluator_status",
          "alignment",
          "thesis",
          "relevance",
          "plain_language",
          "internal_coherence",
          "unsupported_claim",
          "quality_index",
        ],
      ),
    ),
    writeAtomically(
      attemptsPath,
      toCsv(
        attemptDetails as unknown as Array<Record<string, unknown>>,
        [
          "date",
          "layer",
          "run_id",
          "persona_id",
          "workflow",
          "trigger",
          "stage",
          "prompt_attempt",
          "provider_attempt",
          "model",
          "latency_ms",
          "outcome",
          "failure_class",
          "guardrail_codes",
        ],
      ),
    ),
  ]);
  return { metricsPath, personasPath, attemptsPath };
}

export function listEvaluationDates(): string[] {
  const rows = getEvaluationDatabase()
    .prepare("SELECT DISTINCT date FROM generation_runs ORDER BY date")
    .all() as unknown as Array<{ date: string }>;
  return rows.map((row) => row.date);
}
