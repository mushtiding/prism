import type { PersonaId } from "@prism/shared";

// Tamagotchi-style pixel creatures, one per persona. Each is a 12x12 grid with
// two frames — a normal pose and a "squeezed" (squashed) pose — that alternate
// for a little idle bounce. They share a round body + two-pupil face so they
// read as a family, but each has an unmistakable silhouette:
//   momentum  — a forward speed-horn (always leaning into the move)
//   growth    — a two-leaf sprout (the long compounding story)
//   value     — flat sturdy head, hugging a coin (margin of safety)
//   macro     — twin radar antennae (scanning for what breaks next)
//   contrarian— a back cowlick + gaze turned away (facing the other way)
//
// Pixel legend (resolved to per-persona hex in PAL below):
//   .  transparent   B  body   b  shade (feet/antennae)   F  accent (leaf/coin)
//   W  eye highlight  D  pupil
export type PetLegend = "." | "B" | "b" | "F" | "W" | "D";

export interface PetPalette {
  B: string;
  b: string;
  F: string;
  W: string;
  D: string;
}

export interface PixelPet {
  /** [normalFrame, squeezedFrame], each 12 rows x 12 chars. */
  frames: [string[], string[]];
  palette: PetPalette;
}

// Each frame is hand-authored so the characters stay distinct. Every row is
// exactly 12 characters wide; body is centered on columns 2–9.

const MOMENTUM: [string[], string[]] = [
  // normal — speed-horn sweeping forward (right)
  [
    "............",
    ".......BBB..",
    "......BBB...",
    "...BBBBB....",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    "..BBBBBBBB..",
    "..BBBWWBBB..",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "...b....b...",
    "............",
  ],
  // squeezed — horn drops, body squashes wide
  [
    "............",
    "............",
    "......BBB...",
    ".....BBB....",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    ".BBBBBBBBBB.",
    ".BBBBWWBBBB.",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "..b......b..",
    "............",
  ],
];

const GROWTH: [string[], string[]] = [
  // normal — two-leaf sprout on top
  [
    "....F..F....",
    "....FFFF....",
    ".....FF.....",
    "...BBBBBB...",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    "..BBBBBBBB..",
    "..BBBWWBBB..",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "...b....b...",
    "............",
  ],
  // squeezed
  [
    "............",
    "....F..F....",
    "....FFFF....",
    "...BBBBBB...",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    ".BBBBBBBBBB.",
    ".BBBBWWBBBB.",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "..b......b..",
    "............",
  ],
];

const VALUE: [string[], string[]] = [
  // normal — flat sturdy head, coin hugged at the belly
  [
    "............",
    "............",
    "..BBBBBBBB..",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    "..BBBBBBBB..",
    "..BBFFFFBB..",
    "..BBFFFFBB..",
    "..BBBBBBBB..",
    "..BBBBBBBB..",
    "..b......b..",
    "............",
  ],
  // squeezed
  [
    "............",
    "............",
    "............",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    "..BBBBBBBB..",
    ".BBBFFFFBBB.",
    ".BBBFFFFBBB.",
    "..BBBBBBBB..",
    "..BBBBBBBB..",
    ".b........b.",
    "............",
  ],
];

const MACRO: [string[], string[]] = [
  // normal — twin radar antennae with tips
  [
    "...b....b...",
    "...B....B...",
    "....B..B....",
    "...BBBBBB...",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    "..BBBBBBBB..",
    "..BBBWWBBB..",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "...b....b...",
    "............",
  ],
  // squeezed — antennae wobble inward
  [
    "............",
    "...b....b...",
    "...BB..BB...",
    "....BBBB....",
    "..BBBBBBBB..",
    "..BDBBBBDB..",
    ".BBBBBBBBBB.",
    ".BBBBWWBBBB.",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "..b......b..",
    "............",
  ],
];

const CONTRARIAN: [string[], string[]] = [
  // normal — back cowlick (left), gaze shifted left (away from the crowd)
  [
    "............",
    "..BB........",
    "..BBB.......",
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
    "............",
    "..BB........",
    "..BBBBBBB...",
    "..BBBBBBBB..",
    "..BDBBDBBB..",
    ".BBBBBBBBBB.",
    ".BBBWWBBBBB.",
    "..BBBBBBBB..",
    "...BBBBBB...",
    "..b......b..",
    "............",
  ],
];

// Per-persona grayscale palettes from the persona ramp. Monochrome on purpose —
// the only color in the app lives on factual market moves, never on a lens.
const PAL: Record<PersonaId, PetPalette> = {
  momentum: { B: "#f2f2f4", b: "#a9a9b0", F: "#ffffff", W: "#0f0f13", D: "#0f0f13" },
  growth: { B: "#c9c9cf", b: "#83838a", F: "#eef0ee", W: "#101014", D: "#101014" },
  value: { B: "#9a9aa1", b: "#5f5f66", F: "#dcdce0", W: "#0f0f13", D: "#0f0f13" },
  macro: { B: "#787880", b: "#4a4a51", F: "#9a9aa1", W: "#0c0c10", D: "#0c0c10" },
  contrarian: { B: "#d8d8dd", b: "#8f8f96", F: "#f2f2f5", W: "#101014", D: "#101014" },
};

export const PETS: Record<PersonaId, PixelPet> = {
  momentum: { frames: MOMENTUM, palette: PAL.momentum },
  growth: { frames: GROWTH, palette: PAL.growth },
  value: { frames: VALUE, palette: PAL.value },
  macro: { frames: MACRO, palette: PAL.macro },
  contrarian: { frames: CONTRARIAN, palette: PAL.contrarian },
};
