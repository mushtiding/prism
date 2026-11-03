import type { PersonaId } from "@prism/shared";

export type EvaluationWorkflow = "daily" | "my_lens" | "room_read";
export type EvaluationStage = "first_impression" | "second_view";
export type EvaluationTrigger =
  | "initial"
  | "refresh"
  | "scheduled"
  | "user_brief"
  | "room_read"
  | "interactive_retry";

export type EvaluationRunOutcome =
  | "published"
  | "partial"
  | "failed"
  | "cached"
  | "invalid_input";

export interface EvaluationRunContext {
  runId: string;
  briefId: string;
  date: string;
  workflow: EvaluationWorkflow;
  trigger: EvaluationTrigger;
  stage: EvaluationStage;
  generatedAt: string;
  expectedPersonas: number;
  promptVersion: string;
  personaVersion: string;
  appVersion: string;
  interactiveRetryOrdinal?: number;
  targetPersonaId?: PersonaId;
}

export interface ProviderTelemetryContext {
  runId: string;
  promptAttemptId: string;
  personaId: PersonaId;
  stage: EvaluationStage;
  promptAttempt: number;
  interactiveRetryOrdinal?: number;
}

export interface QualityScores {
  alignment: number;
  thesis: number;
  relevance: number;
  plainLanguage: number;
  internalCoherence: number;
  unsupportedClaim: boolean;
  clearThesis: boolean;
  confidence: number;
  rationale: string;
}
