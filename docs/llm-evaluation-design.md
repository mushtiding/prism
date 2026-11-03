# Prism Persona Evaluation and Telemetry Design

**Status:** Initial implementation complete; baseline and human calibration pending
**Date:** 2026-07-07
**Scope:** Backend-generated persona text, its source briefing, and generation reliability

## 1. Purpose

Prism needs to answer two different questions with durable evidence:

1. **Is the output good?** Each persona should be recognizable, relevant to the shared brief, persuasive without becoming advice, and readable by a non-expert.
2. **Is the system dependable?** We need to know how often personas fail, why they fail, how many attempts recovery takes, and how long each stage takes.

This design adds evaluation and telemetry without changing the product response path. A telemetry or evaluator failure must never prevent a brief from being served.

## 2. Goals

- Measure every persona workflow with stable, operationally defined metrics.
- Distinguish quality failures from provider and pipeline failures.
- Compare personas, models, prompts, and workflow versions over time.
- Preserve enough context to reproduce and investigate a poor score.
- Calibrate automated scoring against human review.
- Establish a baseline before locking long-term service-level objectives.

## 3. Non-goals

- Measuring whether a persona predicted future market returns correctly. That is a separate track-record feature.
- Ranking bullish versus bearish opinions or rewarding agreement with market consensus.
- Displaying internal quality scores to end users.
- Evaluating source selection, market-data completeness, or article-reader accuracy in the first implementation, except where they affect persona grounding.
- Replacing existing publication guardrails with an LLM judge.

## 4. Evaluation Scope

### 4.1 Included workflows

| Workflow | Output under evaluation | Additional checks |
| --- | --- | --- |
| Daily brief | Five initial persona POVs | Launch completeness, grounding to market drivers |
| Your Brief | Persona POVs over valid user articles | Grounding to the accepted articles; privacy controls |
| Second Views | Strengthened persona POVs | Distinct from first view, useful incorporation of peer observations, persona preservation |
| Interactive retry | Recovered initial or second-view POV | Retry ordinal, recovery rate, retry latency |

The deterministic daily market-driver layer is not LLM-generated today. It is recorded as evaluation context, not assigned a persona-quality score. The LLM-generated Your Brief title and summary are evaluated separately in phase 2.

### 4.2 Unit of evaluation

The primary unit is one **persona output**:

`brief version + workflow stage + persona + output revision`

A daily brief with five first impressions therefore produces five output records. A successful retry creates a new revision linked to the failed attempt; it does not rewrite the historical attempt record.

## 5. Metric Framework

Metrics are divided into quality, QA/QC, and reliability. Hard QA failures remain visible separately and must not be hidden by a high average quality score.

### 5.1 Persona alignment

**Question:** Does the response consistently express the persona definition rather than a generic market opinion?

Judge inputs: persona definition, neutral brief, and persona output. The judge must not reward a particular market direction.

| Score | Rubric |
| --- | --- |
| 0 | Contradicts the persona or contains no recognizable persona traits. |
| 1 | Mostly generic; one superficial trait or catchphrase. |
| 2 | Recognizable worldview, but focus, horizon, risk posture, or voice drifts. |
| 3 | Consistently reflects the worldview, weighting, horizon, risk posture, and voice. |
| 4 | Distinctive and faithful; the chosen bias materially shapes what is emphasized and dismissed. |

Tracked metrics:

- Mean and median alignment score by persona and workflow.
- Percentage scoring at least 3.
- Bottom-decile score, to expose occasional severe drift.
- Alignment delta between first impressions and Second Views.
- Active-bias validity: named bias is compatible with the persona definition.

Initial target after calibration: at least 90% of reviewed outputs score 3 or 4, with no persona below 85% over a rolling 30-day window.

### 5.2 Thesis quality and persuasiveness

**Question:** Does the response make a clear, well-supported case through the persona's lens?

Persuasiveness means argument quality, not whether the evaluator agrees with the stance.

| Score | Rubric |
| --- | --- |
| 0 | No thesis, incoherent, or self-contradictory. |
| 1 | A conclusion is asserted without a meaningful reason. |
| 2 | A thesis and evidence are present, but the reasoning is vague or incomplete. |
| 3 | Clear thesis, relevant evidence, and a coherent connection between them. |
| 4 | Specific, economical argument that explains why the evidence matters and acknowledges a material tension or risk. |

Tracked metrics:

- Mean thesis score and percentage scoring at least 3.
- Clear-thesis rate.
- Evidence-use rate: at least one concrete fact from the brief supports the thesis.
- Internal-consistency failure rate between POV text, stance labels, scores, and rationales.
- Second View improvement: thesis score delta from the same persona's first impression.

Initial target after calibration: mean at least 3.2 and at least 85% scoring 3 or 4.

### 5.3 Plain language

**Question:** Can a financially curious non-expert understand the response on the first read?

Every output receives deterministic readability measures and a rubric score. Deterministic measures diagnose the text; the rubric score captures context such as whether unavoidable terminology is explained.

Tracked metrics:

- Word count and hard-limit pass rate.
- Flesch Reading Ease and estimated grade level.
- Average sentence length and longest sentence length.
- Unexplained-finance-jargon count from a versioned glossary.
- Plain-language judge score from 0 to 4.
- Percentage at or below grade 10 with no unexplained high-severity jargon.

Plain-language rubric:

- 0: inaccessible or structurally broken.
- 1: jargon-heavy and difficult to follow.
- 2: generally understandable but unnecessarily dense.
- 3: clear to a non-expert, with uncommon terms explained.
- 4: concise, natural, and easy to scan without losing financial meaning.

Initial target: 100% within the word cap, at least 95% at grade 10 or below, and at least 90% scoring 3 or 4.

### 5.4 Relevance and brief fidelity

**Question:** Does the output respond to the supplied market drivers and only those drivers?

Tracked metrics:

- Stance coverage: required key points represented exactly once.
- Unsupported-claim flag: claim cannot be traced to the supplied brief or article text.
- Key-fact coverage: proportion of material brief facts used correctly.
- Off-topic sentence rate.
- Entity and number consistency for names, tickers, dates, and magnitudes.
- Relevance judge score from 0 to 4.

Relevance rubric:

- 0: primarily unrelated or fabricated.
- 1: references the topic but materially invents or misstates facts.
- 2: mostly relevant with omissions or weakly supported claims.
- 3: directly addresses the brief and keeps all material claims grounded.
- 4: grounded, selective, and focused on the most important facts for that persona.

Initial target: 100% stance coverage, unsupported material claim rate below 2%, and at least 90% scoring 3 or 4.

### 5.5 QA/QC and safety

These checks run deterministically on every attempt. They remain binary or categorical rather than being averaged into subjective quality.

| Check | Pass condition |
| --- | --- |
| Response shape | One parseable JSON object matching the expected schema |
| Required stances | Exactly one stance for each supplied key point |
| Score validity | Integer from -2 through 2 |
| Label consistency | Negative is bearish, zero is neutral, positive is bullish |
| Text completeness | Non-empty and useful; within the word cap |
| Advice safety | No buy, sell, hold, price-target, or personalized instruction pattern |
| Grounding | No unknown key-point IDs or unsupported material events |
| Persona metadata | Known persona ID and valid active bias |
| Duplicate prevention | Second View is materially distinct from first impression |
| Internal consistency | Text direction, stance label, score, and rationale do not materially conflict |

Report:

- First-attempt QA pass rate.
- Final QA pass rate after internal retries.
- Failure count by check and persona.
- Advice violation rate, which has a zero-tolerance release threshold.
- Malformed JSON and schema-failure rate by model.

### 5.6 Reliability and latency

#### Launch completeness

"At launch" means the first published version of a newly generated brief, before any user-initiated persona retries.

- `missing_personas_at_publish = expected_personas - initial_successful_personas`
- `persona_launch_failure_rate = sum(missing_personas_at_publish) / sum(expected_personas)`
- `full_cast_publish_rate = runs_published_with_5 / publishable_runs`
- `quorum_only_publish_rate = runs_published_with_3_or_4 / publishable_runs`
- Per-persona launch failure rate.

Initial targets: at least 90% full-cast publishes and below 3% missing persona slots across a rolling 30 days. Targets should be reconsidered after the first 14-day baseline because the free model tier may impose a lower practical ceiling.

#### Attempts and retries

Three attempt concepts must be recorded separately:

1. **Provider attempt:** one request to one OpenRouter model, including fallback routing.
2. **Prompt attempt:** one structured-output generation attempt. Prism currently allows up to three; each may contain multiple provider attempts.
3. **Interactive retry:** a user-requested recovery after the brief was already published.

Metrics:

- First-prompt-attempt success rate.
- Mean and p95 prompt attempts per successful output.
- Provider attempts per prompt attempt.
- Interactive retry requests by persona and workflow.
- Interactive retry recovery rate.
- Retry ordinal to recovery: p50, p90, and maximum.
- Exhausted retry rate.
- Recovery contribution: percentage of initially missing slots later recovered.

#### Latency

Use monotonic elapsed time for durations and wall-clock UTC timestamps for correlation.

| Metric | Start | End |
| --- | --- | --- |
| Provider latency | OpenRouter request sent | Response or provider failure received |
| Prompt-attempt latency | Prompt attempt starts | Accepted output or attempt rejection |
| Persona time to valid | First prompt attempt starts | First accepted output |
| Time to quorum | Five initial persona jobs start | Third accepted persona |
| Time to full cast | Five initial persona jobs start | Fifth accepted persona, when reached |
| Brief publish latency | Daily generation starts | Brief is cached and publishable |
| Interactive retry latency | Retry endpoint accepts request | Accepted POV or 60-second deadline |
| Second View latency | Second View request accepted | Publishable second-view quorum |

Report p50, p90, and p95 by persona, workflow, model, and outcome. Timeouts are included as capped observations in success-rate reporting but are not mixed silently into successful-latency percentiles.

Provisional targets:

- Interactive retry always resolves with success or a clear timeout within 60 seconds.
- Daily time to quorum p95 below 240 seconds.
- Successful persona time to valid p50 below 60 seconds and p95 below 180 seconds.

## 6. Composite Indicators

The individual dimensions remain the source of truth. A composite is useful for trend scanning, not release approval.

`Persona Quality Index = 30% alignment + 25% thesis + 25% relevance + 15% plain language + 5% internal coherence`

Each 0-4 input is normalized to 0-100. An output with a hard QA failure is marked **not publishable** regardless of its index. Report the index with its sample size and evaluator version.

Primary dashboard KPIs:

1. Persona Quality Index, overall and by persona.
2. Hard-QA final pass rate.
3. Full-cast publish rate.
4. Unsupported material claim rate.
5. Interactive retry recovery rate.
6. Persona time-to-valid p50 and p95.

## 7. Measurement Architecture

```text
Generation pipeline
  -> telemetry events (attempts, failures, timings)
  -> deterministic QA (synchronous publication gate)
  -> accepted persona output
       -> product cache and response
       -> asynchronous quality evaluation
            -> automated judge score
            -> sampled human review
  -> local evaluation database
  -> daily and weekly reports
```

### 7.1 Components

1. **Run context**
   - Creates `runId`, `briefId`, workflow, trigger, prompt version, persona-definition version, model route, and expected persona count.
   - Flows through daily generation, Your Brief, Second Views, and retries.

2. **Telemetry recorder**
   - Records typed lifecycle events at pipeline, persona, prompt-attempt, and provider-attempt boundaries.
   - Uses a serialized non-blocking write queue.
   - Redacts API keys and never records full user-provided article text.

3. **Deterministic evaluator**
   - Extends the existing guardrails with schema validation, label/score consistency, readability statistics, active-bias validation, and text/stance consistency checks.
   - Runs on every attempt. Current publication checks remain synchronous.

4. **Quality judge**
   - Runs after publication so evaluator latency cannot delay the product.
   - Receives the persona definition, source brief, and output, with no future market outcome.
   - Returns strict JSON containing dimension scores, flags, short rationale, and confidence.
   - Uses a fixed judge model distinct from the generation model where practical.

5. **Human review queue**
   - Produces a stratified sample by persona, workflow, model, prompt version, and pass/fail status.
   - Reviewers see the same rubric and score independently of market direction.

6. **Reporter**
   - Generates daily summaries, 7-day and 30-day rolling trends, cohort comparisons, and CSV exports.
   - Does not aggregate across prompt, persona, rubric, or judge versions without preserving those dimensions.

### 7.2 Storage

Use a local SQLite database at `server/data/evaluation/prism-evaluation.sqlite`, excluded from Git. SQLite fits the current single-server deployment, supports transactions for parallel persona calls, and is directly queryable for analysis.

Product cache files remain the source of truth for displayed briefs. Evaluation records reference a brief version and content hash; they do not alter cached `DayContent`.

Core tables:

#### `generation_runs`

- `run_id`, `brief_id`, `date`, `workflow`, `trigger`
- `started_at`, `published_at`, `completed_at`
- `source`, `key_point_count`, `expected_personas`, `initial_success_count`
- `missing_persona_ids`, `quorum_reached`, `outcome`, `failure_class`
- `generation_model_route`, `prompt_version`, `persona_version`

#### `persona_attempts`

- `attempt_id`, `run_id`, `persona_id`, `stage`, `revision`
- `interactive_retry_ordinal`, `prompt_attempt`, `provider_attempt`
- `model`, `started_at`, `completed_at`, `latency_ms`
- `outcome`, `failure_class`, `guardrail_codes`, `response_chars`
- `input_tokens`, `output_tokens`, and `cost_usd` when the provider supplies them

#### `persona_outputs`

- `output_id`, `run_id`, `persona_id`, `stage`, `revision`
- `content_hash`, `word_count`, `stance_count`, `accepted_at`
- deterministic readability and QA fields
- reference to the product brief version

#### `automated_evaluations`

- `evaluation_id`, `output_id`, `evaluator_type`, `evaluator_version`
- `rubric_version`, dimension scores, flags, confidence, rationale
- `created_at`, `status`, `error_class`

#### `human_evaluations`

- `review_id`, `output_id`, pseudonymous `reviewer_id`
- `rubric_version`, dimension scores, flags, notes, `created_at`

### 7.3 Failure taxonomy

Use stable codes rather than parsing error strings:

- `provider_timeout`, `provider_rate_limit`, `provider_unavailable`, `network_error`
- `empty_response`, `malformed_json`, `schema_invalid`
- `word_limit`, `advice_violation`, `grounding_failure`
- `stance_missing`, `stance_duplicate`, `label_score_conflict`
- `persona_drift`, `duplicate_second_view`, `unsupported_claim`
- `quorum_deadline`, `interactive_retry_deadline`, `unknown`

One attempt may have multiple guardrail codes but only one terminal outcome.

## 8. Tracking Over Time

### 8.1 Version dimensions

Every output and evaluation must carry:

- Generation model and model route.
- Prompt version, stored as a stable manual version plus prompt-content hash.
- Persona-definition version and content hash.
- Guardrail version.
- Rubric version.
- Judge model and judge-prompt version.
- Application Git commit when available.

This prevents a prompt improvement, model outage, or rubric change from appearing as unexplained quality drift.

### 8.2 Aggregation windows

- **Per run:** debugging and immediate completeness.
- **Daily:** operations and failure monitoring.
- **Rolling 7 days:** early drift signal.
- **Rolling 30 days:** KPI and persona/model comparison.
- **Release cohort:** before/after analysis for prompt or model changes.

Each report includes numerator, denominator, sample size, and evaluator version. Subjective scores show confidence intervals once sample size permits.

### 8.3 Baseline and alerts

Run instrumentation for 14 days before treating provisional quality and latency targets as contractual SLOs. Alert immediately for:

- Any advice-safety violation in an accepted output.
- Full-cast publish rate below 70% over the latest 10 runs.
- Unsupported material claim rate above 5% over 20 evaluated outputs.
- One persona's alignment pass rate more than 10 percentage points below the cast.
- p95 successful persona latency doubling versus the prior 30-day baseline.
- Evaluator failure rate above 10%, which indicates missing measurements rather than product quality.

## 9. Automated Judge Design

The judge returns strict JSON and scores each dimension independently. It receives explicit instructions to:

- Evaluate fidelity to the supplied persona, not agreement with the opinion.
- Treat the source brief as the complete factual universe.
- Identify unsupported claims precisely.
- Ignore future market outcomes and investment performance.
- Avoid rewarding verbosity, confidence, or financial jargon.
- Assign low confidence when the source brief is insufficient to judge a dimension.

To limit correlated bias:

- Prefer a judge model from a different model family than the generator.
- Keep temperature at zero or the provider's lowest deterministic setting.
- Pin the judge model and prompt for a reporting cohort.
- Re-score a fixed calibration set before changing the judge.
- Do not use judge scores as a synchronous publication gate in phase 1.

## 10. Human Calibration

Automated scores become decision-grade only after comparison with human ratings.

Initial review plan:

- Review 25 outputs per week: five per persona, stratified across workflows and automated score bands.
- Double-score at least 20% of the sample.
- Review all advice, unsupported-claim, and score-0/1 flags.
- Track exact agreement, agreement within one point, and weighted Cohen's kappa for double-scored items.
- Target weighted kappa of at least 0.65 before using the judge for release comparisons.
- Revisit rubric examples whenever systematic disagreement exceeds one point.

The review UI should hide generator model and provider outcome until scoring is complete to reduce brand and failure-context bias.

## 11. Privacy and Retention

- Daily and Second View text may be evaluated and retained because it is shared generated content already stored in Prism's cache.
- For Your Brief, do not store full user article text in telemetry or the evaluation database.
- Store content hashes, source domains, character counts, and references to the in-memory job only.
- Automated evaluation of Your Brief should occur while the job data is available, then retain scores and non-quoting rationales.
- Do not include raw prompts, API keys, or full provider responses in evaluation tables.
- Retain attempt metadata and scores indefinitely for trend analysis; retain evaluator rationales for 180 days by default.
- Add a documented local command to purge all evaluation data.

## 12. Rollout Plan

### Phase 0: metric lock and calibration set

- Approve definitions, rubrics, provisional targets, and privacy policy.
- Build a fixed regression set of at least 20 briefs spanning quiet, volatile, earnings-heavy, macro-heavy, and mixed sessions.
- Human-score the five persona outputs for each brief.

### Phase 1: reliability instrumentation

- Add run, attempt, retry, outcome, and latency records.
- Add stable failure codes.
- Produce daily completeness and latency reports.
- No LLM judge yet, so operational metrics can be validated independently.

### Phase 2: deterministic quality metrics

- Extend QA checks and readability statistics.
- Record all checks for accepted and rejected attempts.
- Add a CLI report grouped by persona, workflow, model, and prompt version.

### Phase 3: judged quality and human review

- Add asynchronous quality judging.
- Evaluate 100% of daily and Second View outputs during the first month.
- Evaluate Your Brief only under the privacy rules above.
- Add the weekly human calibration workflow.

### Phase 4: regression gates and experiments

- Run the calibration set before changing the generation model, prompt, or persona definitions.
- Block a rollout on any safety regression or statistically meaningful decline in alignment or relevance.
- Support explicit A/B cohorts; never compare unversioned aggregate averages.

## 13. Acceptance Criteria

The evaluation system is ready for routine use when:

- Every persona generation path emits a run ID and attempt records.
- Initial generation, internal prompt retries, provider fallbacks, and interactive retries are distinguishable.
- Missing-at-publish counts reconcile exactly with saved brief persona counts.
- Latency percentiles can be reproduced from stored events.
- Every accepted output has deterministic QA results.
- At least 95% of eligible outputs receive an automated evaluation within 15 minutes.
- Judge scores meet the human-calibration agreement threshold.
- Reports can segment by persona, workflow, model, prompt, persona definition, and rubric version.
- Evaluation failures do not change product responses or cache writes.

## 14. Review Decisions

The following decisions should be approved before implementation:

1. Is SQLite acceptable as the local evaluation ledger, or is an external analytics service expected soon?
2. Should Your Brief outputs be judge-evaluated by default under the proposed no-article-text-retention policy?
3. Are the 0-4 rubrics and Persona Quality Index weights appropriate?
4. Is a different-family paid judge model acceptable for more independent scoring?
5. Are the 14-day baseline period and provisional reliability targets useful for the current free-model operating constraints?
6. Who will perform the initial weekly human review and own rubric changes?

## 15. Implementation Status

Implemented on 2026-07-07:

- Local SQLite ledger with run, prompt-attempt, provider-attempt, output,
  automated-evaluation, and human-evaluation tables.
- Instrumentation for daily briefs, refreshes, Your Brief, Second Views, and
  both interactive retry paths. Scheduled daily generations are tagged
  separately from manual refreshes.
- Deterministic readability and QA metrics on every accepted persona output.
- Asynchronous, versioned 0-4 quality judging after a run is published.
- Daily CSV exports for aggregate metrics, persona details, and raw attempts.
- Automatic prior-day export at 12:05 AM local time plus a manual backfill
  command.

Still operational rather than code-complete: establishing the 14-day baseline,
assembling the human-scored calibration set, assigning reviewers, and setting
final alert thresholds from observed data.

## Appendix A: Recommended Code Boundaries

- `server/src/evaluation/context.ts`: run and output identities, version hashes.
- `server/src/evaluation/recorder.ts`: non-blocking SQLite writer.
- `server/src/evaluation/schema.ts`: tables, migrations, event and failure-code types.
- `server/src/evaluation/deterministic.ts`: QA and readability metrics.
- `server/src/evaluation/judge.ts`: asynchronous rubric evaluator.
- `server/src/evaluation/reports.ts`: daily, rolling, cohort, and CSV reports.
- `server/scripts/evaluationReport.ts`: local report command.

Primary instrumentation points already exist in:

- `server/src/providers/llm.ts` for provider attempts and latency.
- `server/src/pipeline/generate.ts` for prompt attempts, guardrails, quorum, first impressions, and Second Views.
- `server/src/store/dailyStore.ts` for run triggers, publication, saved versions, and interactive retries.
- `server/src/pipeline/userArticles.ts` and `server/src/store/myLensJobs.ts` for Your Brief stages and outcomes.
