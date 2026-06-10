import { useEffect, useState } from "react";
import type { PersonaId } from "@prism/shared";
import { PETS, petPalette, type PetLegend, type PetPalette } from "../pixelPets";

const GRID = 12;

function colorFor(ch: string, pal: PetPalette): string | null {
  switch (ch as PetLegend) {
    case "B":
      return pal.B;
    case "b":
      return pal.b;
    case "A":
      return pal.A;
    case "a":
      return pal.a;
    case "F":
      return pal.F;
    case "W":
      return pal.W;
    case "D":
      return pal.D;
    case "K":
      return pal.K;
    case "L":
      return pal.L;
    default:
      return null; // "." transparent
  }
}

/** Render one 12x12 frame as a grid of pixel cells via box-shadow on a 1px dot. */
function frameBoxShadow(frame: string[], pal: PetPalette, px: number): string {
  const shadows: string[] = [];
  for (let y = 0; y < GRID; y++) {
    const row = frame[y] ?? "";
    for (let x = 0; x < GRID; x++) {
      const c = colorFor(row[x] ?? ".", pal);
      if (c) shadows.push(`${x * px}px ${y * px}px 0 ${c}`);
    }
  }
  return shadows.join(", ");
}

/**
 * A Tamagotchi-style pixel persona in its signature color. Alternates between
 * its normal and squeezed frames to produce a little idle bounce. `animate=false`
 * holds the normal frame (used outside the cast, e.g. the drawer header).
 */
export function PixelPet({
  id,
  px = 4,
  animate = true,
  intervalMs = 480,
}: {
  id: PersonaId;
  px?: number;
  animate?: boolean;
  intervalMs?: number;
}) {
  const pet = PETS[id];
  const pal = petPalette(id);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!animate) {
      setFrame(0);
      return;
    }
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return;
    const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), intervalMs);
    return () => clearInterval(t);
  }, [animate, intervalMs]);

  const size = GRID * px;
  return (
    <span
      className="pixelpet"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="pixelpet__sprite"
        style={{
          width: px,
          height: px,
          boxShadow: frameBoxShadow(pet.frames[frame], pal, px),
        }}
      />
    </span>
  );
}
