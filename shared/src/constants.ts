import type { PersonaId } from "./types.js";

/** Canonical persona order used everywhere the cast is displayed. */
export const PERSONA_IDS: PersonaId[] = [
  "momentum",
  "growth",
  "value",
  "macro",
  "contrarian",
];

/** Hard limit on a persona POV, enforced by the readability guardrail (FR-2). */
export const MAX_POV_WORDS = 200;

/** Persistent compliance framing shown across the app (FR-10). */
export const DISCLAIMER =
  "Each view is a deliberately biased perspective, not investment advice. " +
  "Prism is not personalized and never tells you to buy, sell, or hold.";
