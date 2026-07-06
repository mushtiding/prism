import type { CSSProperties } from "react";
import type { PersonaId } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { PERSONA_STYLE } from "../personaStyle";
import { PixelPet } from "./PixelPet";

interface RoomSpot {
  x: string;
  y: number;
  facing: 1 | -1;
  activity: string;
  activityClass: string;
}

const ROOM_SPOTS: Record<PersonaId, RoomSpot> = {
  momentum: {
    x: "13%",
    y: 18,
    facing: 1,
    activity: "pacing by the ticker",
    activityClass: "pace",
  },
  growth: {
    x: "30%",
    y: 27,
    facing: -1,
    activity: "tending the plant",
    activityClass: "tend",
  },
  value: {
    x: "48%",
    y: 34,
    facing: 1,
    activity: "reading at the table",
    activityClass: "read",
  },
  macro: {
    x: "66%",
    y: 28,
    facing: -1,
    activity: "watching from the sofa",
    activityClass: "watch",
  },
  contrarian: {
    x: "82%",
    y: 14,
    facing: -1,
    activity: "settling onto the floor cushion",
    activityClass: "settle",
  },
};

type RoomPetStyle = CSSProperties & {
  "--pet-x": string;
  "--pet-y": string;
  "--pet-delay": string;
  "--pet-accent": string;
};

/**
 * A front-on pixel room for the cast. Available personas enter through the
 * right-hand doorway and settle into a spot that reflects their lens.
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
  const residents = PERSONA_IDS.filter((id) => available.has(id));

  return (
    <div
      className="habitat"
      role="group"
      aria-label="Market perspective room. Select a character to read its view."
    >
      <div className="habitat__wall" aria-hidden="true">
        <div className="habitat__window">
          <span className="habitat__window-moon" />
          <span className="habitat__window-star" />
          <span className="habitat__window-sill" />
        </div>
        <div className="habitat__lamp">
          <span />
        </div>
        <div className="habitat__shelf">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="habitat__picture">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="habitat__clock">
          <span />
        </div>
      </div>

      <div className="habitat__floor" aria-hidden="true" />
      <div className="habitat__rug" aria-hidden="true" />
      <div className="habitat__radio" aria-hidden="true">
        <span />
      </div>
      <div className="habitat__plant" aria-hidden="true">
        <span className="habitat__plant-leaves" />
        <span className="habitat__plant-pot" />
      </div>
      <div className="habitat__table" aria-hidden="true">
        <span />
      </div>
      <div className="habitat__sofa" aria-hidden="true">
        <span />
      </div>
      <div className="habitat__cushion" aria-hidden="true" />
      <div className="habitat__door" aria-hidden="true">
        <span className="habitat__door-light" />
        <span className="habitat__door-step" />
      </div>

      {residents.map((id) => {
        const persona = PERSONA_STYLE[id];
        const spot = ROOM_SPOTS[id];
        const castIndex = PERSONA_IDS.indexOf(id);
        const isSelected = selected === id;
        const petStyle: RoomPetStyle = {
          "--pet-x": spot.x,
          "--pet-y": `${spot.y}px`,
          "--pet-delay": `${castIndex * 150}ms`,
          "--pet-accent": persona.color,
        };

        return (
          <button
            key={id}
            className={`room-pet room-pet--${id}${isSelected ? " room-pet--selected" : ""}`}
            style={petStyle}
            onClick={() => onSelect(id)}
            onMouseEnter={() => onHover(id)}
            onMouseLeave={() => onHover(null)}
            title={`${persona.charName} · ${persona.short} · ${spot.activity}`}
            aria-label={`${persona.charName}, the ${persona.short} perspective, ${spot.activity}`}
          >
            <span className="room-pet__shadow" />
            <span
              className={`room-pet__activity room-pet__activity--${spot.activityClass}`}
            >
              <span
                className="room-pet__facing"
                style={{ transform: `scaleX(${spot.facing})` }}
              >
                <PixelPet id={id} px={3} />
              </span>
            </span>
            <span className="room-pet__name">{persona.charName}</span>
          </button>
        );
      })}
    </div>
  );
}
