import type { PersonaId } from "@prism/shared";
import { PERSONA_STYLE, scoreToPosition } from "../personaStyle";

export interface SpectrumPoint {
  personaId: PersonaId;
  score: number;
}

/**
 * The signature visual: a bear→bull axis with one marker per persona, placed by
 * conviction. When the cast agrees the markers cluster; when they split they
 * spread. The spread IS the divergence — "the disagreement is the signal."
 *
 * Markers are stacked into lanes when they would overlap, so a tight cluster
 * stays legible.
 */
export function Spectrum({
  points,
  size = "md",
}: {
  points: SpectrumPoint[];
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "lg" ? 26 : size === "md" ? 20 : 16;
  // Assign vertical lanes so near-coincident markers don't fully overlap.
  const sorted = [...points].sort((a, b) => a.score - b.score);
  const lanes: number[] = [];
  const laneOf = new Map<PersonaId, number>();
  const placed: { pos: number; lane: number }[] = [];
  for (const p of sorted) {
    const pos = scoreToPosition(p.score);
    let lane = 0;
    // bump to next lane while something sits within ~7% on the same lane
    // eslint-disable-next-line no-loop-func
    while (placed.some((q) => q.lane === lane && Math.abs(q.pos - pos) < 0.07)) {
      lane++;
    }
    placed.push({ pos, lane });
    laneOf.set(p.personaId, lane);
    lanes.push(lane);
  }
  const maxLane = Math.max(0, ...lanes);
  const laneGap = dim + 4;
  const lanesHeight = dim + maxLane * laneGap;

  return (
    <div className="spectrum">
      <div className="spectrum__track">
        <span className="spectrum__tick" style={{ left: "0%" }} />
        <span
          className="spectrum__tick spectrum__tick--center"
          style={{ left: "50%" }}
        />
        <span className="spectrum__tick" style={{ left: "100%" }} />
      </div>
      <div className="spectrum__lanes" style={{ height: lanesHeight }}>
        {points.map((p) => {
          const pos = scoreToPosition(p.score);
          const lane = laneOf.get(p.personaId) ?? 0;
          const style = PERSONA_STYLE[p.personaId];
          return (
            <span
              key={p.personaId}
              className="spectrum__marker"
              title={`${style.short}: ${p.score > 0 ? "+" : ""}${
                Number.isInteger(p.score) ? p.score : p.score.toFixed(1)
              }`}
              style={{
                left: `${pos * 100}%`,
                top: dim / 2 + lane * laneGap,
                width: dim,
                height: dim,
                background: style.color,
              }}
            >
              {style.glyph}
            </span>
          );
        })}
      </div>
      <div className="spectrum__ends">
        <span>Bearish</span>
        <span>Bullish</span>
      </div>
    </div>
  );
}
