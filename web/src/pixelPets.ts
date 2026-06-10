import type { PersonaId } from "@prism/shared";
import { PERSONA_STYLE } from "./personaStyle";

// Tamagotchi-style pixel creatures, one per persona. Each is a 12x12 grid with
// two frames — a normal pose and a "squeezed" (squashed) pose — that alternate
// for an idle bounce. They share a round body + two-pupil face so they read as
// a family, but each has a name, a signature color, and an accessory:
//   Blitz  (momentum)  — sunglasses (cool, chasing the move)
//   Sprout (growth)    — tidy bowtie + a leaf (neat, long-term optimist)
//   Penny  (value)     — big nerdy glasses, hugging a coin (margin of safety)
//   Sage   (macro)     — monk-like hood (calm, watching what breaks)
//   Nix    (contrarian)— a beanie, gaze turned away (faces the other way)
//
// Pixel legend (resolved to per-persona hex in PixelPet.tsx):
//   .  transparent   B  body (signature color)   b  body shade
//   A  accessory     a  accessory shade           F  accent (leaf/coin)
//   W  eye white      D  pupil
//   K  true black (sunglasses, glasses frames)    L  clear glass lens (see-through)
export type PetLegend =
  | "."
  | "B"
  | "b"
  | "A"
  | "a"
  | "F"
  | "W"
  | "D"
  | "K"
  | "L";

export interface PixelPet {
  /** [normalFrame, squeezedFrame], each 16 rows x 16 chars. */
  frames: [string[], string[]];
}

// Each frame is hand-authored on a 16x16 grid (every row exactly 16 chars). The
// higher resolution keeps eyes and accessories from collapsing into blobs. The
// two frames differ mainly in the lower body (belly bulge + feet splay) so the
// face stays steady — a gentle idle bounce rather than a jitter.
// Eyes use W (white) with a D (pupil) for a friendly, clearly-readable face.

const BLITZ: [string[], string[]] = [
  // normal — black wrap sunglasses, small white glint on each lens
  [
    "................",
    "................",
    ".....BBBBBB.....",
    "...BBBBBBBBBB...",
    "..BBBBBBBBBBBB..",
    "..BBBBBBBBBBBB..",
    "..KKKKKKKKKKKK..",
    "..KWKKKKKKKKWK..",
    "..KKKKKKKKKKKK..",
    "..BBBBBBBBBBBB..",
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "....BBBBBBBB....",
    "....bb....bb....",
    "................",
    "................",
  ],
  // squeezed
  [
    "................",
    "................",
    "................",
    ".....BBBBBB.....",
    "...BBBBBBBBBB...",
    "..BBBBBBBBBBBB..",
    "..KKKKKKKKKKKK..",
    "..KWKKKKKKKKWK..",
    "..KKKKKKKKKKKK..",
    ".BBBBBBBBBBBBBB.",
    ".BBBBBBBBBBBBBB.",
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "...bb......bb...",
    "................",
    "................",
  ],
];

const SPROUT: [string[], string[]] = [
  // normal — sprout leaf on top, friendly eyes, tidy bowtie at the neck
  [
    ".......FF.......",
    "......FFFF......",
    ".......FF.......",
    ".....BBBBBB.....",
    "...BBBBBBBBBB...",
    "..BBBBBBBBBBBB..",
    "..BBWWBBBBWWBB..",
    "..BBWDBBBBWDBB..",
    "..BBBBBBBBBBBB..",
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "....BBBBBBBB....",
    "....AAaaaaAA....",
    "....bb....bb....",
    "................",
    "................",
  ],
  // squeezed
  [
    "................",
    ".......FF.......",
    "......FFFF......",
    ".......FF.......",
    ".....BBBBBB.....",
    "..BBBBBBBBBBBB..",
    "..BBWWBBBBWWBB..",
    "..BBWDBBBBWDBB..",
    "..BBBBBBBBBBBB..",
    ".BBBBBBBBBBBBBB.",
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "...AAaaaaaaAA...",
    "...bb......bb...",
    "................",
    "................",
  ],
];

const PENNY: [string[], string[]] = [
  // normal — big round nerdy glasses: black frames (K) on cols 2-5 and 8-11,
  // clear lens (L) with the pupils (D) visible through them, black bridge.
  // Coin (F) hugged at the belly.
  [
    "................",
    ".....BBBBBB.....",
    "...BBBBBBBBBB...",
    "..BBBBBBBBBBBB..",
    "..KKKKBBKKKKBB..",
    "..KLLKBBKLLKBB..",
    "..KLDKKKKLDKBB..",
    "..KLLKBBKLLKBB..",
    "..KKKKBBKKKKBB..",
    "..BBBBBBBBBBBB..",
    "...BBFFFFFFBB...",
    "....BFFFFFFB....",
    "....BBBBBBBB....",
    "....bb....bb....",
    "................",
    "................",
  ],
  // squeezed
  [
    "................",
    "................",
    ".....BBBBBB.....",
    "..BBBBBBBBBBBB..",
    "..KKKKBBKKKKBB..",
    "..KLLKBBKLLKBB..",
    "..KLDKKKKLDKBB..",
    "..KLLKBBKLLKBB..",
    "..KKKKBBKKKKBB..",
    ".BBBBBBBBBBBBBB.",
    "...BBFFFFFFBB...",
    "....BFFFFFFB....",
    "....BBBBBBBB....",
    "...bb......bb...",
    "................",
    "................",
  ],
];

const SAGE: [string[], string[]] = [
  // normal — monk-like hood (A) draped over head and shoulders, calm face
  [
    "................",
    "....AAAAAAAA....",
    "...AAAAAAAAAA...",
    "..AAAAAAAAAAAA..",
    "..AAABBBBBBAAA..",
    "..AABBBBBBBBAA..",
    "..AABWWBBWWBAA..",
    "..AABWDBBWDBAA..",
    "..AABBBBBBBBAA..",
    "..AABBBBBBBBAA..",
    "..AAABBBBBBAAA..",
    "..AAAAAAAAAAAA..",
    "...AAAAAAAAAA...",
    "....bb....bb....",
    "................",
    "................",
  ],
  // squeezed
  [
    "................",
    "................",
    "....AAAAAAAA....",
    "...AAAAAAAAAA...",
    "..AAAAAAAAAAAA..",
    "..AAABBBBBBAAA..",
    "..AABWWBBWWBAA..",
    "..AABWDBBWDBAA..",
    "..AABBBBBBBBAA..",
    "..AAABBBBBBAAA..",
    "..AAAAAAAAAAAA..",
    "..AAAAAAAAAAAA..",
    "...AAAAAAAAAA...",
    "...bb......bb...",
    "................",
    "................",
  ],
];

const NIX: [string[], string[]] = [
  // normal — slouchy beanie (A) with a pom, gaze shifted left (away from crowd)
  [
    ".......AA.......",
    "....AAAAAAAA....",
    "...AAAAAAAAAA...",
    "...AAAAAAAAAA...",
    ".....BBBBBB.....",
    "..BBBBBBBBBBBB..",
    "..BWWBBWWBBBBB..",
    "..BWDBBWDBBBBB..",
    "..BBBBBBBBBBBB..",
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "....BBBBBBBB....",
    "....BBBBBBBB....",
    "....bb....bb....",
    "................",
    "................",
  ],
  // squeezed
  [
    "................",
    ".......AA.......",
    "....AAAAAAAA....",
    "...AAAAAAAAAA...",
    "...AAAAAAAAAA...",
    "..BBBBBBBBBBBB..",
    "..BWWBBWWBBBBB..",
    "..BWDBBWDBBBBB..",
    "..BBBBBBBBBBBB..",
    ".BBBBBBBBBBBBBB.",
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "....BBBBBBBB....",
    "...bb......bb...",
    "................",
    "................",
  ],
];

export const PETS: Record<PersonaId, PixelPet> = {
  momentum: { frames: BLITZ },
  growth: { frames: SPROUT },
  value: { frames: PENNY },
  macro: { frames: SAGE },
  contrarian: { frames: NIX },
};

/** Derive a pet's color set from its persona signature color. */
export interface PetPalette {
  B: string;
  b: string;
  A: string;
  a: string;
  F: string;
  W: string;
  D: string;
  K: string;
  L: string;
}

// Lighten/darken a #rrggbb toward white/black by a 0..1 amount.
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    const k = 1 + amt;
    r *= k;
    g *= k;
    b *= k;
  }
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function petPalette(id: PersonaId): PetPalette {
  const base = PERSONA_STYLE[id].color;
  return {
    B: base,
    b: shade(base, -0.28), // body shade
    A: shade(base, -0.55), // accessory (dark, reads as black-ish object)
    a: shade(base, -0.4), // accessory highlight
    F: shade(base, 0.45), // leaf/coin accent (light tint of the color)
    W: "#0e0e12", // eye/lens (dark on the colored body)
    D: "#0e0e12", // pupil
    K: "#0a0a0c", // true black — sunglasses, glasses frames
    L: shade(base, 0.62), // clear glass lens — light tint of the body (see-through)
  };
}
