import type { DayContent, PersonaDef, PersonaId } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { PixelPet } from "./PixelPet";

/** Average a persona's conviction across the day's key points → overall lean. */
function dailyLean(day: DayContent, id: PersonaId): number {
  const pov = day.povs.find((p) => p.personaId === id);
  if (!pov || pov.stances.length === 0) return 0;
  return (
    pov.stances.reduce((a, s) => a + s.score, 0) / pov.stances.length
  );
}

function leanWord(lean: number): string {
  if (lean > 0.5) return "leans bullish";
  if (lean < -0.5) return "leans bearish";
  return "mixed / neutral";
}

/** The five lenses as tappable cards (FR-6: tap a persona → read its POV). */
export function CastStrip({
  day,
  defs,
  onPick,
}: {
  day: DayContent;
  defs: PersonaDef[];
  onPick: (id: PersonaId) => void;
}) {
  return (
    <section className="cast">
      <div className="section-label">The cast · five lenses on today</div>
      <div className="cast__grid">
        {PERSONA_IDS.map((id) => {
          const def = defs.find((d) => d.id === id);
          if (!def) return null;
          const lean = dailyLean(day, id);
          return (
            <button
              className="persona-card"
              key={id}
              onClick={() => onPick(id)}
            >
              <div className="persona-card__top">
                <span className="petscreen">
                  <PixelPet id={id} px={5} />
                </span>
                <span className="persona-card__stance mono">
                  {leanWord(lean)}
                </span>
              </div>
              <div className="persona-card__name">{def.name}</div>
              <div className="persona-card__world">{def.worldview}</div>
              <span className="persona-card__cta">Read today's lens →</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
