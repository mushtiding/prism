import type { PersonaId, StanceLabel } from "@prism/shared";

/**
 * Per-persona identity: a signature color, a short glyph, a label, and a little
 * character name. Colors mark IDENTITY (which lens), never stance direction —
 * and deliberately avoid the green/red reserved for factual up/down moves, so
 * the two color systems never get confused.
 */
export const PERSONA_STYLE: Record<
  PersonaId,
  { color: string; glyph: string; short: string; charName: string }
> = {
  momentum: { color: "#f5a524", glyph: "MO", short: "Momentum", charName: "Blitz" },
  growth: { color: "#e8d44d", glyph: "GR", short: "Growth", charName: "Sprout" },
  value: { color: "#8a8fff", glyph: "VA", short: "Value", charName: "Penny" },
  macro: { color: "#4cc2e0", glyph: "MA", short: "Macro", charName: "Sage" },
  contrarian: { color: "#e26fd0", glyph: "CO", short: "Contrarian", charName: "Nix" },
};

/** Map a conviction score (-2..+2) to a 0..1 position on the bear→bull axis. */
export function scoreToPosition(score: number): number {
  return (score + 2) / 4;
}

export function stanceWord(label: StanceLabel): string {
  return label;
}

/**
 * Direction of a factual magnitude string ("+9% after hours", "-2.1%", "Dow
 * -22.6%"). Drives the only color in the app — and only on facts, never lenses.
 * Returns null when there's no clear sign (e.g. "mechanism, not a price").
 */
export function magnitudeDirection(
  magnitude: string | undefined,
): "up" | "down" | null {
  if (!magnitude) return null;
  // First explicit signed number wins (handles "S&P +0.4%, Nasdaq +0.7%" -> up,
  // and "10Y yield +6bps" -> up). A leading minus anywhere with a digit = down.
  const m = magnitude.match(/([+-])\s*\d/);
  if (!m) return null;
  return m[1] === "-" ? "down" : "up";
}

/** Plain-English reading of a divergence level, shown under the hero score. */
export function divergenceBlurb(
  level: "consensus" | "mixed" | "contested",
): string {
  switch (level) {
    case "consensus":
      return "The lenses broadly agree. A read this aligned is probably already priced in — and less interesting.";
    case "mixed":
      return "The lenses partly disagree. Some events are contested; scan the key points for where they split.";
    case "contested":
      return "The lenses sharply disagree. This is the signal — a contested, possibly-mispriced read worth a closer look.";
  }
}
