import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isLiveMode } from "./config.js";
import { logEvent } from "./logger.js";
import { currentCalendarDate } from "./store/dailyStore.js";
import { loadSampleDay, loadTimeMachineCatalog } from "./store/sampleData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, "../cache");

async function listCachedDays(): Promise<string[]> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function runStartupChecks(): Promise<void> {
  const serverEnv = path.resolve(__dirname, "../.env");
  const rootEnv = path.resolve(__dirname, "../../.env");

  logEvent(`cwd ${process.cwd()}`);
  logEvent(
    `env ${serverEnv} → ${existsSync(serverEnv) ? "found" : "missing"}; ` +
      `legacy root ${rootEnv} → ${existsSync(rootEnv) ? "found" : "missing"}`,
  );
  logEvent(
    `keys OPENROUTER=${config.openRouterApiKey ? "set" : "missing"}, ALPHAVANTAGE=${config.alphaVantageApiKey ? "set" : "missing"}`,
  );

  try {
    const sample = await loadSampleDay("0000-00-00");
    logEvent(
      `bundled sample ready · ${sample.keyPoints.length} key points, ${sample.povs.length} POVs`,
    );
  } catch (err) {
    logEvent(`bundled sample failed: ${err}`);
  }

  try {
    const events = await loadTimeMachineCatalog();
    logEvent(`time machine · ${events.length} events`);
  } catch (err) {
    logEvent(`time machine catalog failed: ${err}`);
  }

  const cached = await listCachedDays();
  logEvent(
    cached.length === 0
      ? "daily cache empty"
      : `daily cache · ${cached.join(", ")}`,
  );
  logEvent(`current calendar day · ${currentCalendarDate(new Date())}`);

  if (!isLiveMode()) {
    logEvent("live generation disabled — serving bundled sample until both keys are set");
  }
}
