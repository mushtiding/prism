import { useEffect, useRef, useState } from "react";
import type { DayContent, PersonaDef, PersonaId } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { PERSONA_STYLE } from "../personaStyle";
import { PixelPet } from "./PixelPet";
import { Habitat } from "./Habitat";

/** Average a persona's conviction across the day's key points → overall lean. */
function dailyLean(day: DayContent, id: PersonaId): number | null {
  const pov = day.povs.find((p) => p.personaId === id);
  if (!pov) return null;
  if (pov.stances.length === 0) return 0;
  return pov.stances.reduce((a, s) => a + s.score, 0) / pov.stances.length;
}

function leanWord(lean: number | null): string {
  if (lean === null) return "unavailable";
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
  onRetry,
}: {
  day: DayContent;
  defs: PersonaDef[];
  onPick: (id: PersonaId) => void;
  onRetry?: (id: PersonaId, signal: AbortSignal) => Promise<void>;
}) {
  // Which persona is currently highlighted (by pet click or card hover).
  const [highlight, setHighlight] = useState<PersonaId | null>(null);
  const [waiting, setWaiting] = useState<Partial<Record<PersonaId, number>>>({});
  const retryControllers = useRef(new Map<PersonaId, AbortController>());
  const available = new Set(day.povs.map((pov) => pov.personaId));
  const hasEveryLens = available.size === PERSONA_IDS.length;
  const isMyLens = day.kind === "myLens";

  useEffect(() => {
    const controllers = retryControllers.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  async function retryPersona(id: PersonaId) {
    if (
      !onRetry ||
      retryControllers.current.has(id) ||
      waiting[id] !== undefined ||
      available.has(id)
    ) {
      return;
    }

    const controller = new AbortController();
    retryControllers.current.set(id, controller);
    const deadline = Date.now() + 60_000;
    setWaiting((current) => ({ ...current, [id]: 60 }));
    const ticker = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setWaiting((current) => ({ ...current, [id]: seconds }));
    }, 250);
    const timeout = window.setTimeout(() => controller.abort(), 61_000);

    try {
      await onRetry(id, controller.signal);
    } catch {
      // The card returns to its retryable unavailable state.
    } finally {
      window.clearInterval(ticker);
      window.clearTimeout(timeout);
      retryControllers.current.delete(id);
      setWaiting((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  return (
    <section className="cast">
      <div className="section-label">
        {hasEveryLens
          ? `The cast · five lenses${isMyLens ? "" : " on today"}`
          : `The cast · ${available.size} of five lenses available`}
      </div>

      <Habitat
        selected={highlight}
        available={available}
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
          const isAvailable = available.has(id);
          const secondsLeft = waiting[id];
          const isWaiting = secondsLeft !== undefined;
          const isHi = highlight === id;

          const contents = (
            <>
              <div className="persona-card__top">
                <span className="petscreen">
                  <PixelPet id={id} px={4} />
                </span>
                <span className="persona-card__stance mono">
                  {isWaiting ? `waiting · ${secondsLeft}s` : leanWord(lean)}
                </span>
              </div>
              <div className="persona-card__charname" style={{ color: style.color }}>
                {style.charName}
              </div>
              <div className="persona-card__name">{def.name}</div>
              <div className="persona-card__world">{def.worldview}</div>
              <span className="persona-card__cta">
                {isAvailable
                  ? `Read ${isMyLens ? "this" : "today's"} lens →`
                  : isWaiting
                    ? "Waiting for model"
                    : "Lens unavailable"}
              </span>
              {!isAvailable && !isWaiting && onRetry && (
                <button
                  className="persona-card__retry"
                  data-testid={`retry-${id}`}
                  onClick={() => void retryPersona(id)}
                  type="button"
                >
                  Retry
                </button>
              )}
            </>
          );

          const className = `persona-card${isHi ? " persona-card--hi" : ""}${isAvailable ? "" : " persona-card--unavailable"}${isWaiting ? " persona-card--waiting" : ""}`;
          const cardStyle = { "--accent": style.color } as React.CSSProperties;

          return isAvailable ? (
            <button
              className={className}
              key={id}
              style={cardStyle}
              onClick={() => onPick(id)}
              onMouseEnter={() => setHighlight(id)}
              onMouseLeave={() => setHighlight(null)}
            >
              {contents}
            </button>
          ) : (
            <div className={className} key={id} style={cardStyle}>
              {contents}
            </div>
          );
        })}
      </div>
    </section>
  );
}
