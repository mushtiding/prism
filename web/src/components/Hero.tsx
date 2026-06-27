import { useState } from "react";
import type { DayContent, PersonaId } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { divergenceBlurb } from "../personaStyle";
import { Spectrum, type SpectrumPoint } from "./Spectrum";

const LEVEL_WORD = {
  consensus: "Consensus",
  mixed: "Mixed",
  contested: "Contested",
} as const;

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function divergenceMeaning(
  score: number,
  level: DayContent["dayDivergence"]["level"],
): string {
  switch (level) {
    case "consensus":
      return `At ${score.toFixed(2)}, today's lenses mostly agree.`;
    case "mixed":
      return `At ${score.toFixed(2)}, today's lenses split on some themes.`;
    case "contested":
      return `At ${score.toFixed(2)}, today's lenses read the same news very differently.`;
  }
}

/** The day-level divergence — Prism's headline takeaway (FR-4). */
export function Hero({ day }: { day: DayContent }) {
  const div = day.dayDivergence;
  const [showIndexHelp, setShowIndexHelp] = useState(false);
  const loadedLensNote =
    day.povs.length === PERSONA_IDS.length
      ? "All five lenses are included."
      : `Based on ${day.povs.length} of five loaded lenses.`;

  // Each persona's overall daily lean = mean conviction across key points.
  const points: SpectrumPoint[] = [];
  for (const id of PERSONA_IDS as PersonaId[]) {
    const pov = day.povs.find((p) => p.personaId === id);
    if (pov && pov.stances.length) {
      const avg =
        pov.stances.reduce((a, s) => a + s.score, 0) / pov.stances.length;
      points.push({ personaId: id, score: avg });
    }
  }

  return (
    <section className="hero rise">
      <div className="hero__date mono">
        {day.kind === "timeMachine" ? day.title : prettyDate(day.date)}
      </div>
      <div className="hero__head">
        <div className="hero__score">
          <span className={`hero__score-num lvl-${div.level}`}>
            {div.score.toFixed(2)}
          </span>
          <div className="hero__level">
            <span className={`hero__level-word lvl-${div.level}`}>
              {LEVEL_WORD[div.level]}
            </span>
            <span className="hero__index-help-wrap">
              <button
                type="button"
                className="hero__index-help"
                aria-describedby="divergence-index-help"
                aria-expanded={showIndexHelp}
                onBlur={() => setShowIndexHelp(false)}
                onClick={() => setShowIndexHelp((current) => !current)}
              >
                divergence index · 0–1
                <span className="hero__index-icon" aria-hidden="true">i</span>
              </button>
              <span
                id="divergence-index-help"
                className={`hero__index-tooltip${showIndexHelp ? " hero__index-tooltip--open" : ""}`}
                role="tooltip"
              >
                <strong>How to read it</strong>
                <span>
                  Shows how much the loaded lenses disagree. Zero means aligned;
                  one means maximally split. It is not a market forecast.
                </span>
                <span>
                  <b>Today:</b> {divergenceMeaning(div.score, div.level)}{" "}
                  {loadedLensNote}
                </span>
              </span>
            </span>
          </div>
        </div>
        <p className="hero__read">{divergenceBlurb(div.level)}</p>
      </div>
      <div className="spectrum--hero">
        <Spectrum points={points} size="lg" />
      </div>
    </section>
  );
}
