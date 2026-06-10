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
  /** [normalFrame, squeezedFrame], each 12 rows x 12 chars. */
  frames: [string[], string[]];
}

// Each frame is hand-authored (every row exactly 12 chars). Body centered on
// columns 2–9; accessories drawn over the face/head per character.

const BLITZ: [string[], string[]] = [
  // normal — black sunglasses across the eyes (K = true black, W = lens shine)
  [
    "............",
    "............",
    "...BBBBBB...",
    "..BBBBBBBB..",
    "..BBBBBBBB..",
    "..KKKKKKKK..",
    "..KWKKKKWK..",
    "..BBKKKKBB..",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "...b....b...",
    "............",
  ],
  // squeezed
  [
    "............",
    "............",
    "............",
    "...BBBBBB...",
    "..BBBBBBBB..",
    "..KKKKKKKK..",
    "..KWKKKKWK..",
    ".BBKKKKKKBB.",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "..b......b..",
    "............",
  ],
];

const SPROUT: [string[], string[]] = [
  // normal — single leaf on top, tidy bowtie at the neck
  [
    ".....F......",
    ".....FF.....",
    "...BBBBBB...",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    "..BBBBBBBB..",
    "..BBBWWBBB..",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "...AaaA.....",
    "...b..b.....",
    "............",
  ],
  // squeezed
  [
    "............",
    ".....F......",
    ".....FF.....",
    "...BBBBBB...",
    "..BDBBBBDB..",
    "..BBBBBBBB..",
    ".BBBBWWBBBB.",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "..AaaaA.....",
    "..b...b.....",
    "............",
  ],
];

const PENNY: [string[], string[]] = [
  // normal — big nerdy glasses: black round frames (K), clear see-through lens
  // (L) with the eyes (D) visible inside, black bridge. Coin hugged at belly.
  [
    "............",
    "...BBBBBB...",
    "..BKKBBKKB..",
    "..KLLKKLLK..",
    "..KLDKKLDK..",
    "..KLLKKLLK..",
    "..BKKBBKKB..",
    "..BBFFFFBB..",
    "..BBFFFFBB..",
    "...BBBBBB...",
    "...b....b...",
    "............",
  ],
  // squeezed
  [
    "............",
    "............",
    "..BKKBBKKB..",
    "..KLLKKLLK..",
    "..KLDKKLDK..",
    "..KLLKKLLK..",
    ".BBKKBBKKBB.",
    ".BBBFFFFBBB.",
    ".BBBFFFFBBB.",
    "...BBBBBB...",
    "..b......b..",
    "............",
  ],
];

const SAGE: [string[], string[]] = [
  // normal — monk-like hood draped over head and shoulders
  [
    "...AAAAAA...",
    "..AAAAAAAA..",
    "..AABBBBAA..",
    "..ABBBBBBA..",
    "..ABDBBDBA..",
    "..ABBBBBBA..",
    "..ABBWWBBA..",
    "..AABBBBAA..",
    "..AAAAAAAA..",
    "...AAAAAA...",
    "...b....b...",
    "............",
  ],
  // squeezed
  [
    "............",
    "...AAAAAA...",
    "..AAAAAAAA..",
    "..AABBBBAA..",
    "..ABDBBDBA..",
    "..ABBBBBBA..",
    ".AABBWWBBAA.",
    "..AABBBBAA..",
    "..AAAAAAAA..",
    "...AAAAAA...",
    "..b......b..",
    "............",
  ],
];

const NIX: [string[], string[]] = [
  // normal — slouchy beanie, gaze turned left (away from the crowd)
  [
    "...AAAAAA...",
    "..AAAAAAAA..",
    "..AAAAAAAA..",
    "...BBBBBB...",
    "..BBBBBBBB..",
    "..BDBBDBBB..",
    "..BBBBBBBB..",
    "..BBWWBBBB..",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "...b....b...",
    "............",
  ],
  // squeezed
  [
    "............",
    "...AAAAAA...",
    "..AAAAAAAA..",
    "..AAAAAAAA..",
    "...BBBBBB...",
    "..BDBBDBBB..",
    ".BBBBBBBBBB.",
    ".BBBWWBBBBB.",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "..b......b..",
    "............",
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
