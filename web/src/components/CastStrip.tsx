import { useState } from "react";
import type { DayContent, PersonaDef, PersonaId } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { PERSONA_STYLE } from "../personaStyle";
import { PixelPet } from "./PixelPet";
import { Habitat } from "./Habitat";

/** Average a persona's conviction across the day's key points → overall lean. */
function dailyLean(day: DayContent, id: PersonaId): number {
  const pov = day.povs.find((p) => p.personaId === id);
  if (!pov || pov.stances.length === 0) return 0;
  return pov.stances.reduce((a, s) => a + s.score, 0) / pov.stances.length;
}

function leanWord(lean: number): string {
  if (lean > 0.5) return "leans bullish";
  if (lean < -0.5) return "leans bearish";
  return "mixed / neutral";
}

/**
 * The five lenses: a habitat strip where the persona pets roam (click one to
 * open its lens) sitting above the cast cards. Hovering a card lifts its pet and
 * vice-versa; selecting highlights the card and opens the POV (FR-6).
 */
export function CastStrip({
  day,
  defs,
  onPick,
}: {
  day: DayContent;
  defs: PersonaDef[];
  onPick: (id: PersonaId) => void;
}) {
  // Which persona is currently highlighted (by pet click or card hover).
  const [highlight, setHighlight] = useState<PersonaId | null>(null);

  return (
    <section className="cast">
      <div className="section-label">The cast · five lenses on today</div>

      <Habitat
        selected={highlight}
        onSelect={(id) => {
          setHighlight(id);
          onPick(id);
        }}
        onHover={setHighlight}
      />

      <div className="cast__grid">
        {PERSONA_IDS.map((id) => {
          const def = defs.find((d) => d.id === id);
          if (!def) return null;
          const style = PERSONA_STYLE[id];
          const lean = dailyLean(day, id);
          const isHi = highlight === id;
          return (
            <button
              className={`persona-card${isHi ? " persona-card--hi" : ""}`}
              key={id}
              style={
                { "--accent": style.color } as React.CSSProperties
              }
              onClick={() => onPick(id)}
              onMouseEnter={() => setHighlight(id)}
              onMouseLeave={() => setHighlight(null)}
            >
              <div className="persona-card__top">
                <span className="petscreen">
                  <PixelPet id={id} px={5} />
                </span>
                <span className="persona-card__stance mono">
                  {leanWord(lean)}
                </span>
              </div>
              <div className="persona-card__charname" style={{ color: style.color }}>
                {style.charName}
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
