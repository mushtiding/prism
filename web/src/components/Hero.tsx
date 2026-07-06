import { useState } from "react";
import type { DayContent, PersonaId } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { divergenceBlurb } from "../personaStyle";
import { Spectrum, type SpectrumPoint } from "./Spectrum";

const LEVEL_WORD = {
  consensus: "Aligned",
  mixed: "Mixed",
  contested: "Divided",
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
  subject: string,
): string {
  switch (level) {
    case "consensus":
      return `At ${score.toFixed(2)}, ${subject} mostly agree.`;
    case "mixed":
      return `At ${score.toFixed(2)}, ${subject} split on some themes.`;
    case "contested":
      return `At ${score.toFixed(2)}, ${subject} read the same news very differently.`;
  }
}

/** The day-level divergence — Prism's headline takeaway (FR-4). */
export function Hero({ day }: { day: DayContent }) {
  const div = day.dayDivergence;
  const [showIndexHelp, setShowIndexHelp] = useState(false);
  const hasDivergenceSignal = day.povs.length >= 2;
  const lensSubject =
    day.kind === "myLens" ? "these perspectives" : "today's perspectives";
  const loadedLensNote =
    day.povs.length === PERSONA_IDS.length
      ? "All five perspectives are included."
      : day.povs.length === 0
        ? "No perspectives are ready yet."
        : `Based on ${day.povs.length} of five perspectives.`;

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
    <section className="hero">
      <div className="hero__meta hero__enter hero__enter--date">
        <span className="hero__kicker mono">
          {day.kind === "myLens" ? "Your brief" : "Daily brief"}
        </span>
        <div className="hero__date mono">
          {day.kind === "timeMachine" || day.kind === "myLens"
            ? day.title
            : prettyDate(day.date)}
        </div>
      </div>
      <div className="hero__head hero__enter hero__enter--head">
        <div className="hero__score">
          <span className={`hero__score-num lvl-${div.level}`}>
            {hasDivergenceSignal ? div.score.toFixed(2) : "--"}
          </span>
          <div className="hero__level">
            <span className={`hero__level-word lvl-${div.level}`}>
              {hasDivergenceSignal ? LEVEL_WORD[div.level] : "Views pending"}
            </span>
          </div>
          <span className="hero__index-help-wrap">
            <button
              type="button"
              className="hero__index-trigger"
              aria-label="Explain the disagreement score"
              aria-describedby="divergence-index-help"
              aria-expanded={showIndexHelp}
              onBlur={() => setShowIndexHelp(false)}
              onClick={() => setShowIndexHelp((current) => !current)}
            >
              <span className="hero__index-icon" aria-hidden="true">i</span>
            </button>
            <span
              id="divergence-index-help"
              className={`hero__index-tooltip${showIndexHelp ? " hero__index-tooltip--open" : ""}`}
              role="tooltip"
            >
              <strong>How this score works</strong>
              <span>
                Shows how much the available perspectives disagree. Zero means aligned;
                one means maximally split. It is not a market forecast.
              </span>
              <span>
                <b>{day.kind === "myLens" ? "This brief:" : "Today:"}</b>{" "}
                {hasDivergenceSignal
                  ? divergenceMeaning(div.score, div.level, lensSubject)
                  : "A score appears after at least two perspectives are ready."}{" "}
                {loadedLensNote}
              </span>
            </span>
          </span>
        </div>
        <p className="hero__read">
          {hasDivergenceSignal
            ? divergenceBlurb(div.level)
            : "Today's market brief is ready, but its perspectives are unavailable."}
        </p>
      </div>
      <div className="spectrum--hero hero__enter hero__enter--spectrum">
        <span className="hero__spectrum-label mono">Perspective range</span>
        <Spectrum points={points} size="lg" />
      </div>
    </section>
  );
}
