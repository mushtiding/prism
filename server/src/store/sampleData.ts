import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DayContent } from "@prism/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

async function readDay(file: string): Promise<DayContent> {
  const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
  return JSON.parse(raw) as DayContent;
}

/**
 * The bundled sample trading day (incl. the chipmaker example). Served whenever
 * live generation is unavailable. We stamp it with the requested date so the UI
 * shows a coherent session, and badge it source:"sample".
 */
export async function loadSampleDay(date: string): Promise<DayContent> {
  const day = await readDay("sample-day.json");
  return { ...day, date, source: "sample" };
}
