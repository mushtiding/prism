import { useEffect, useRef, useState } from "react";
import type { PersonaId } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { PERSONA_STYLE } from "../personaStyle";
import { PixelPet } from "./PixelPet";

interface Walker {
  id: PersonaId;
  x: number; // 0..1 position along the strip
  facing: 1 | -1; // sprite flip
  moving: boolean;
}

// Deterministic per-id jitter so walkers don't march in lockstep (Math.random
// is fine here — purely cosmetic, client-only).
const PHASE: Record<PersonaId, number> = {
  momentum: 0,
  growth: 0.45,
  value: 0.2,
  macro: 0.7,
  contrarian: 0.9,
};

/**
 * A little habitat strip where the five persona pets wander slowly (stop-and-go)
 * above the cast cards. Clicking a pet highlights its card and opens its lens.
 * `selected` lifts the matching pet; hovering a card (via `hovered`) nudges it.
 */
export function Habitat({
  selected,
  available,
  onSelect,
  onHover,
}: {
  selected: PersonaId | null;
  available: ReadonlySet<PersonaId>;
  onSelect: (id: PersonaId) => void;
  onHover: (id: PersonaId | null) => void;
}) {
  const [walkers, setWalkers] = useState<Walker[]>(() =>
    PERSONA_IDS.map((id, i) => ({
      id,
      x: 0.08 + (i / (PERSONA_IDS.length - 1)) * 0.84,
      facing: i % 2 === 0 ? 1 : -1,
      moving: true,
    })),
  );
  const tick = useRef(0);

  // Drive the wander with a single interval. Each step, a walker either drifts
  // in its facing direction or pauses; it turns around at the edges or randomly.
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return;

    const timer = setInterval(() => {
      tick.current += 1;
      const t = tick.current;
      setWalkers((prev) =>
        prev.map((w) => {
          // Stop-and-go: toggle moving on a per-walker phase-shifted cadence.
          const wave = Math.sin((t / 14 + PHASE[w.id]) * Math.PI * 2);
          const moving = wave > -0.35;
          if (!moving) return { ...w, moving: false };

          const speed = 0.012;
          let x = w.x + w.facing * speed;
          let facing = w.facing;
          if (x <= 0.03) {
            x = 0.03;
            facing = 1;
          } else if (x >= 0.97) {
            x = 0.97;
            facing = -1;
          }
          return { ...w, x, facing, moving: true };
        }),
      );
    }, 220);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="habitat"
      role="group"
      aria-label="Persona characters — click one to read its lens"
    >
      <div className="habitat__ground" />
      {walkers.map((w) => {
        const style = PERSONA_STYLE[w.id];
        const isAvailable = available.has(w.id);
        const isSel = selected === w.id;
        return (
          <button
            key={w.id}
            className={`walker${isSel ? " walker--selected" : ""}${isAvailable ? "" : " walker--unavailable"}`}
            style={{ left: `${w.x * 100}%` }}
            disabled={!isAvailable}
            onClick={() => onSelect(w.id)}
            onMouseEnter={() => isAvailable && onHover(w.id)}
            onMouseLeave={() => isAvailable && onHover(null)}
            title={`${style.charName} · ${style.short}${isAvailable ? "" : " · unavailable"}`}
            aria-label={`${style.charName}, the ${style.short} lens${isAvailable ? "" : ", unavailable"}`}
          >
            <span
              className={`walker__sprite${w.moving ? " walker__sprite--step" : ""}`}
              style={{ transform: `scaleX(${w.facing})` }}
            >
              <PixelPet id={w.id} px={3} />
            </span>
            <span className="walker__name" style={{ color: style.color }}>
              {style.charName}
            </span>
            <span
              className="walker__shadow"
              style={{ opacity: w.moving ? 0.28 : 0.4 }}
            />
          </button>
        );
      })}
    </div>
  );
}
