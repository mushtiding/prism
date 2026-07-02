import type { PersonaId } from "@prism/shared";

// Every cast member uses the same 16x16 canvas, outline hierarchy, and
// upper-left light source. Their outer contours deliberately differ so each
// lens remains identifiable without relying on color alone.
export type PetLegend =
  | "." // transparent
  | "O" // global outline
  | "B" // body base
  | "b" // body shadow
  | "H" // body highlight
  | "A" // accessory base
  | "a" // accessory highlight
  | "F" // prop accent
  | "W" // eye white
  | "D" // pupil
  | "K" // deep black
  | "L"; // glass lens

export interface PixelPet {
  frames: [string[], string[]];
}

export interface PetPalette {
  O: string;
  B: string;
  b: string;
  H: string;
  A: string;
  a: string;
  F: string;
  W: string;
  D: string;
  K: string;
  L: string;
}

function makePet(
  base: string[],
  alternateRows: Partial<Record<number, string>>,
): PixelPet {
  const alternate = base.map((row, index) => alternateRows[index] ?? row);
  for (const [frameIndex, frame] of [base, alternate].entries()) {
    const invalidRow = frame.findIndex((row) => row.length !== 16);
    if (frame.length !== 16 || invalidRow !== -1) {
      throw new Error(
        `Pixel pet frame ${frameIndex}, row ${invalidRow} must use a 16x16 grid`,
      );
    }
  }
  return { frames: [base, alternate] };
}

// Blitz: angular speed tufts, wraparound shades, and a wide forward stance.
const BLITZ = makePet(
  [
    "................",
    ".....OO...OO....",
    "....OHHOOHHO....",
    "...OOBBBBBBOO...",
    "..OOBBBBBBBBOO..",
    ".OOBBBBBBBBBBOO.",
    ".OOKKKKKKKKKKOO.",
    ".OOBKKKKKKKKBOO.",
    ".OOBBKKBBKKBBOO.",
    ".OOBBBBBBBBBBOO.",
    "..OOBBBBBBBBOO..",
    "...OOBBBBBBOO...",
    "....OOBBBBOO....",
    "...OOOb..bOOO...",
    "...OO......OO...",
    "................",
  ],
  {
    1: "....OO....OO....",
    2: "...OHHOOOOHHO...",
    13: "..OOOb....bOOO..",
    14: "..OO........OO..",
  },
);

// Sprout: a narrow stem silhouette, animated leaf, and tidy dark-green bow.
const SPROUT = makePet(
  [
    "......OFFO......",
    ".....OFFHFO.....",
    "......OFO.......",
    "......OBO.......",
    "....OOBBBBOO....",
    "...OOBBBBBBOO...",
    "..OOBHBBBBBBOO..",
    "..OOBWWBBWWBOO..",
    "..OOBWDBBWDBOO..",
    "...OOBBBBBBOO...",
    "...OOBBBBBBOO...",
    "....OOBBBBOO....",
    "....OOAAAAOO....",
    "...OOAb..bAOO...",
    "...OO......OO...",
    "................",
  ],
  {
    0: ".......OFFO.....",
    1: "......OFHHFO....",
    2: ".......OFO......",
  },
);

// Penny: a stable square silhouette, oversized glasses, and a guarded coin.
const PENNY = makePet(
  [
    "................",
    "...OOOOOOOOOO...",
    "..OOBBBBBBBBOO..",
    ".OOBBBBBBBBBBOO.",
    ".OOKKKKBBKKKKOO.",
    ".OOKLLKBBKLLKOO.",
    ".OOKLDKKKKLDKOO.",
    ".OOKLLKBBKLLKOO.",
    ".OOKKKKBBKKKKOO.",
    ".OOBBBBBBBBBBOO.",
    ".OOBBBFFFFBBBOO.",
    ".OOBBFFFFFFBBOO.",
    "..OOBBFFFFBBOO..",
    "..OOBBBBBBBBOO..",
    ".OOObb....bbOOO.",
    "..OO........OO..",
  ],
  {
    5: ".OOKHLKBBKLLKOO.",
    10: ".OOBBBHFFFBBBOO.",
    14: ".OOOb......bOOO.",
  },
);

// Sage: a tapered hood and robe, with a slow blink instead of a body bounce.
const SAGE = makePet(
  [
    "......OOOO......",
    ".....OAAAAO.....",
    "....OAAHAAAO....",
    "...OAAABBAAAO...",
    "..OAAABBBBAAAO..",
    ".OAAABBBBBBAAAO.",
    ".OAABWWBBWWBAAO.",
    ".OAABWDBBWDBAAO.",
    ".OAABBBBBBBBAAO.",
    "..OAABBBBBBAAO..",
    "..OAAABBBBAAAO..",
    "...OAAAAAAAAO...",
    "...OOAAAAAAOO...",
    "....OOb..bOO....",
    "....OO....OO....",
    "................",
  ],
  {
    6: ".OAABBBBBBBBAAO.",
    7: ".OAABDDBBDDBAAO.",
  },
);

// Nix: an off-center beanie, side-eye, and an intentionally uneven stance.
const NIX = makePet(
  [
    "....OO..........",
    "...OAAO.........",
    "..OAAAAOO.......",
    ".OOAAAAAAAAOO...",
    "..OOaaaaaaOO....",
    "...OOBBBBBBBOO..",
    "..OOBBBBBBBBBOO.",
    ".OOBWWBBBBBBBBO.",
    ".OOBWDBBBBBBBBO.",
    ".OOBBBBBBBBBBBO.",
    "..OOBBBBBBBBOO..",
    "...OOBBBBBBOO...",
    "....OOBBBBOO....",
    "...OOOb..bOOO...",
    "..OO........OO..",
    "................",
  ],
  {
    0: "...OO...........",
    1: "..OAAO..........",
    2: ".OAAAAOO........",
    8: ".OOBDBBBBBBBBBO.",
    14: ".OO..........OO.",
  },
);

export const PETS: Record<PersonaId, PixelPet> = {
  momentum: BLITZ,
  growth: SPROUT,
  value: PENNY,
  macro: SAGE,
  contrarian: NIX,
};

// A fixed, compact palette keeps every sprite readable across the dark room,
// sesame room, and monochrome cast cards. Shadows hue-shift cooler or redder;
// highlights move warmer toward the shared upper-left light.
const PET_PALETTES: Record<PersonaId, PetPalette> = {
  momentum: {
    O: "#231c27",
    B: "#f5a524",
    b: "#b85a2d",
    H: "#ffd166",
    A: "#3c3544",
    a: "#686071",
    F: "#fff0b3",
    W: "#fff8df",
    D: "#17131b",
    K: "#100e13",
    L: "#ffe39a",
  },
  growth: {
    O: "#24231d",
    B: "#e8d44d",
    b: "#92883a",
    H: "#fff28a",
    A: "#386553",
    a: "#65a369",
    F: "#70bd62",
    W: "#fffbe6",
    D: "#1b1a16",
    K: "#12110e",
    L: "#f4efad",
  },
  value: {
    O: "#211f31",
    B: "#8a8fff",
    b: "#5658a9",
    H: "#c9c6ff",
    A: "#3b395f",
    a: "#6c6a91",
    F: "#f0bf4f",
    W: "#f5f2ff",
    D: "#171522",
    K: "#100f18",
    L: "#cfd1ff",
  },
  macro: {
    O: "#18252e",
    B: "#4cc2e0",
    b: "#287c9d",
    H: "#9ce8f1",
    A: "#294b68",
    a: "#4d7c91",
    F: "#d1f4f5",
    W: "#eefcfc",
    D: "#111b21",
    K: "#0d1419",
    L: "#b7edf2",
  },
  contrarian: {
    O: "#2a1d2a",
    B: "#e26fd0",
    b: "#994778",
    H: "#f5addf",
    A: "#4e344c",
    a: "#7d526f",
    F: "#f0c45f",
    W: "#fff1fa",
    D: "#1e141e",
    K: "#130d13",
    L: "#f0b9e3",
  },
};

export function petPalette(id: PersonaId): PetPalette {
  return PET_PALETTES[id];
}
