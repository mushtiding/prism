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

/** The day-level divergence — Prism's headline takeaway (FR-4). */
export function Hero({ day }: { day: DayContent }) {
  const div = day.dayDivergence;

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
            <span className="hero__level-sub">divergence index · 0–1</span>
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
