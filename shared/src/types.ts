// The single data contract shared between the Prism server and web client.
// The frontend never talks to external providers; it only renders DayContent.

/** A persona's directional read on a single key point. */
export type StanceLabel = "bullish" | "neutral" | "bearish";

/** How much the cast disagrees, normalized and classified. */
export type DivergenceLevel = "consensus" | "mixed" | "contested";

/** Where a day's content came from — drives the "sample data" badge. */
export type ContentSource = "live" | "sample";

/** Which Prism workflow produced this analysis. */
export type DayKind = "daily" | "timeMachine" | "myLens";

export type PersonaId =
  | "momentum"
  | "growth"
  | "value"
  | "macro"
  | "contrarian";

export type Horizon = "short" | "long" | "origin";
export type Risk = "defensive" | "neutral" | "aggressive";

/** A citable source backing a key point (FR-1). */
export interface Source {
  title: string;
  publisher: string;
  url: string;
}

/** Normalized disagreement across the cast (FR-4). The headline output. */
export interface Divergence {
  /** 0..1 normalized disagreement (0 = full consensus, 1 = maximally split). */
  score: number;
  level: DivergenceLevel;
  /** Raw statistic the score derives from (population stddev of conviction). */
  spread: number;
  /** Persona ids holding the most-bullish / most-bearish stance (for "who splits"). */
  mostBullish: PersonaId | null;
  mostBearish: PersonaId | null;
}

/** One flat, non-evaluative market movement from the prior session (FR-1). */
export interface KeyPoint {
  /** Stable within a day; referenced by every persona's stances. */
  id: string;
  /** Flat, non-evaluative one-liner — no loaded verbs. */
  summary: string;
  /** Expandable underlying detail (FR-6). */
  detail: string;
  /** Publisher-provided summary bullets, when the article exposes them. */
  highlights?: string[];
  /** e.g. "+9% after hours". Optional. */
  magnitude?: string;
  sources: Source[];
  /** Per-key-point divergence across the cast (FR-4, §9.3). */
  divergence: Divergence;
}

/** A persona's structured read on one key point — drives divergence math. */
export interface Stance {
  keyPointId: string;
  label: StanceLabel;
  /** -2..+2 conviction: -2 strong bear, 0 neutral, +2 strong bull. */
  score: number;
  /** Short plain-English reason. Optional. */
  rationale?: string;
}

/** A persona's daily take on the shared base layer (FR-2). */
export interface PersonaPOV {
  personaId: PersonaId;
  /** The written POV — plain English, hard-capped at 200 words. */
  text: string;
  /** The bias lens applied today, e.g. "anchoring to the prior high" (FR-3). */
  activeBias: string;
  /** One stance per key point in the day's briefing. */
  stances: Stance[];
}

/** A persona's durable definition (FR-3, FR-9). Version-controlled, not per-day. */
export interface PersonaDef {
  id: PersonaId;
  name: string;
  horizon: Horizon;
  risk: Risk;
  biases: string[];
  /** One-line worldview. */
  worldview: string;
  overweights: string[];
  underweights: string[];
  /** Tone/voice guidance used at generation time. */
  voice: string;
}

/** Everything needed to render one trading day (or one historical replay). */
export interface DayContent {
  /** Trading session date, ISO YYYY-MM-DD. */
  date: string;
  kind: DayKind;
  source: ContentSource;
  /** Time-machine event label, e.g. "Black Monday — Oct 19, 1987". */
  title?: string;
  /** 3–6 key points (FR-1). */
  keyPoints: KeyPoint[];
  /** One POV per persona (FR-2). */
  povs: PersonaPOV[];
  /** Day-level divergence — the hero takeaway (FR-4). */
  dayDivergence: Divergence;
  /** ISO timestamp of when this content was generated. */
  generatedAt: string;
  /** Persistent "lenses, not advice" framing (FR-10). */
  disclaimer: string;
}

/** A daily briefing already generated and available for read-only history. */
export interface HistoryDaySummary {
  date: string;
  generatedAt: string;
  keyPointCount: number;
  personaCount: number;
  leadSummary: string;
}

export interface MyLensArticleInput {
  id: string;
  value: string;
}

export interface MyLensArticleResult {
  id: string;
  status: "valid" | "invalid";
  inputType: "text" | "url";
  title?: string;
  preview?: string;
  url?: string;
  reason?: string;
}

export interface MyLensResponse {
  articles: MyLensArticleResult[];
  day: DayContent | null;
}

export type MyLensJobPhase =
  | "queued"
  | "reading"
  | "validating"
  | "summarizing"
  | "personas"
  | "scoring"
  | "complete"
  | "failed";

export interface MyLensJobProgress {
  phase: MyLensJobPhase;
  message: string;
  completed?: number;
  total?: number;
}

export interface MyLensJobCreated {
  jobId: string;
}

export interface MyLensJobStatus {
  jobId: string;
  status: "running" | "complete" | "failed";
  progress: MyLensJobProgress;
  startedAt: string;
  updatedAt: string;
  result?: MyLensResponse;
  error?: string;
}

/** /api/health diagnostic payload. */
export interface HealthStatus {
  ok: boolean;
  mode: "live" | "sample";
  hasLlmKey: boolean;
  hasMarketKey: boolean;
  model: string;
}
