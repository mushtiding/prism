import { config, isLiveMode } from "./config.js";

/** Refresh while work is in flight; idle heartbeat is less frequent. */
const ACTIVE_REFRESH_MS = 10_000;
const IDLE_REFRESH_MS = 60_000;
const TICK_MS = 5_000;

function formatTs(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

function formatAgo(at: number): string {
  return `${formatDuration(Date.now() - at)} ago`;
}

function logEvent(message: string): void {
  console.log(`${formatTs()} [prism] ${redactSecrets(message)}`);
}

export { logEvent };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(value: unknown): string {
  let text = String(value);
  for (const secret of [config.openRouterApiKey, config.alphaVantageApiKey]) {
    if (secret) {
      text = text.replace(new RegExp(escapeRegExp(secret), "g"), "[redacted]");
    }
  }
  return text
    .replace(/api key as [A-Za-z0-9._-]+/gi, "API key as [redacted]")
    .replace(/apikey=[^&\s]+/gi, "apikey=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

type CallState = "pending" | "done" | "failed";

interface HttpEntry {
  method: string;
  path: string;
  startedAt: number;
}

interface ExternalEntry {
  provider: string;
  label: string;
  startedAt: number;
  state: CallState;
  detail?: string;
}

interface HttpActivity {
  method: string;
  path: string;
  status: number;
  at: number;
  durationMs: number;
}

interface DayActivity {
  date: string;
  source: string;
  outcome: "cached" | "live" | "sample" | "running";
  at: number;
}

let seq = 0;
const bootedAt = Date.now();
let pipelinePhase: string | null = null;
let pipelineDetail: string | null = null;
const httpActive = new Map<string, HttpEntry>();
const externalActive = new Map<string, ExternalEntry>();
const externalRecent: ExternalEntry[] = [];
const MAX_RECENT = 8;

let refreshTimer: ReturnType<typeof setInterval> | undefined;
let lastBoardAt = 0;
let boardQueued = false;

let totalHttpRequests = 0;
let lastClientUrl: string | null = null;
let lastHttp: HttpActivity | null = null;
let lastDay: DayActivity | null = null;
let lastFallbackReason: string | null = null;

function nextId(): string {
  return String(++seq);
}

function isBusy(): boolean {
  return (
    httpActive.size > 0 ||
    [...externalActive.values()].some((e) => e.state === "pending") ||
    pipelinePhase !== null ||
    lastDay?.outcome === "running"
  );
}

function currentRefreshMs(): number {
  return isBusy() ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
}

function queueStatusBoard(): void {
  if (boardQueued) return;
  boardQueued = true;
  setImmediate(() => {
    boardQueued = false;
    const due = Date.now() - lastBoardAt >= currentRefreshMs();
    if (due || isBusy()) printStatusBoard();
  });
}

function markActivity(): void {
  queueStatusBoard();
}

export function startStatusReporter(): void {
  printStatusBoard();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (Date.now() - lastBoardAt >= currentRefreshMs()) {
      printStatusBoard();
    }
  }, TICK_MS);
}

/** Record the browser URL that proxied a request (any Vite port). */
export function recordClientUrl(url: string): void {
  lastClientUrl = url;
}

export function recordFallback(reason: string): void {
  lastFallbackReason = redactSecrets(reason);
  logEvent(`fallback to sample — ${reason}`);
  printStatusBoard();
}

export function recordDayStarted(date: string): void {
  lastDay = { date, source: "—", outcome: "running", at: Date.now() };
  logEvent(`day generation started · ${date}`);
  markActivity();
}

export function recordDayOutcome(
  outcome: "cached" | "live" | "sample",
  date: string,
  source: string,
): void {
  lastDay = { date, source, outcome, at: Date.now() };
  logEvent(`day served · ${date} · ${source} (${outcome})`);
  printStatusBoard();
}

export function setPipeline(phase: string, detail?: string): void {
  pipelinePhase = phase;
  pipelineDetail = detail ?? null;
  logEvent(`pipeline → ${phase}${detail ? ` (${detail})` : ""}`);
  markActivity();
}

export function clearPipeline(): void {
  pipelinePhase = null;
  pipelineDetail = null;
  markActivity();
}

export function trackHttp(method: string, path: string): {
  done: (detail?: string) => void;
  fail: (detail?: string) => void;
} {
  const id = nextId();
  httpActive.set(id, { method, path, startedAt: Date.now() });
  logEvent(`http → ${method} ${path}`);
  markActivity();

  const finish = (state: "done" | "failed", detail?: string) => {
    const entry = httpActive.get(id);
    if (!entry) return;
    httpActive.delete(id);
    const durationMs = Date.now() - entry.startedAt;
    totalHttpRequests += 1;

    const statusMatch = detail?.match(/HTTP (\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : state === "done" ? 200 : 500;
    lastHttp = {
      method: entry.method,
      path: entry.path,
      status,
      at: Date.now(),
      durationMs,
    };

    const safeDetail = detail ? redactSecrets(detail) : undefined;
    const tail = safeDetail ? ` — ${safeDetail}` : "";
    logEvent(
      `http ${state === "done" ? "✓" : "✗"} ${entry.method} ${entry.path} (${formatDuration(durationMs)})${tail}`,
    );
    printStatusBoard();
  };

  return {
    done: (detail) => finish("done", detail),
    fail: (detail) => finish("failed", detail),
  };
}

export function trackExternal(
  provider: string,
  label: string,
): { done: (detail?: string) => void; fail: (detail?: string) => void } {
  const id = nextId();
  const entry: ExternalEntry = {
    provider,
    label,
    startedAt: Date.now(),
    state: "pending",
  };
  externalActive.set(id, entry);
  logEvent(`api → ${provider}: ${label}`);
  markActivity();

  const finish = (state: "done" | "failed", detail?: string) => {
    const current = externalActive.get(id);
    if (!current) return;
    externalActive.delete(id);
    const ms = Date.now() - current.startedAt;
    const safeDetail = detail ? redactSecrets(detail) : undefined;
    const finished: ExternalEntry = {
      ...current,
      state,
      detail: safeDetail,
    };
    externalRecent.unshift(finished);
    if (externalRecent.length > MAX_RECENT) externalRecent.pop();
    const tail = safeDetail ? ` — ${safeDetail}` : "";
    logEvent(
      `api ${state === "done" ? "✓" : "✗"} ${provider}: ${label} (${formatDuration(ms)})${tail}`,
    );
    markActivity();
  };

  return {
    done: (detail) => finish("done", detail),
    fail: (detail) => finish("failed", detail),
  };
}

function line(label: string, value: string): string {
  return `  ${label.padEnd(10)} ${value}`;
}

function formatNote(): string {
  if (lastDay?.outcome === "running") {
    return `generating ${lastDay.date} — started ${formatAgo(lastDay.at)}`;
  }

  if (lastDay) {
    return `last day · ${lastDay.date} · ${lastDay.source} (${lastDay.outcome}) · ${formatAgo(lastDay.at)}`;
  }

  if (totalHttpRequests > 0 && lastHttp) {
    return `app connected · last ${lastHttp.method} ${lastHttp.path} · HTTP ${lastHttp.status} · ${formatAgo(lastHttp.at)}`;
  }

  if (!isLiveMode()) {
    return "sample mode — set API keys in server/.env for live generation";
  }

  return `waiting for app — open the Vite URL from your terminal (any port) or curl http://localhost:${config.port}/api/day/latest`;
}

export function printStatusBoard(): void {
  lastBoardAt = Date.now();
  const now = Date.now();
  const uptime = formatDuration(now - bootedAt);
  const mode = isLiveMode() ? "LIVE" : "SAMPLE";
  const lines: string[] = [
    `──── prism status · ${formatTs()} ────`,
    line("uptime", uptime),
    line("mode", `${mode} · model ${config.openRouterModel}`),
  ];

  if (lastClientUrl) {
    lines.push(line("client", lastClientUrl));
  }

  if (pipelinePhase) {
    lines.push(
      line(
        "pipeline",
        pipelineDetail ? `${pipelinePhase} — ${pipelineDetail}` : pipelinePhase,
      ),
    );
  } else if (lastDay?.outcome === "running") {
    lines.push(line("pipeline", `generating ${lastDay.date}`));
  } else {
    lines.push(line("pipeline", "idle"));
  }

  if (httpActive.size === 0) {
    lines.push(line("http", "none in flight"));
  } else {
    for (const req of httpActive.values()) {
      lines.push(
        line(
          "http",
          `${req.method} ${req.path} (${formatDuration(now - req.startedAt)})`,
        ),
      );
    }
  }

  if (lastHttp) {
    lines.push(
      line(
        "last http",
        `${lastHttp.method} ${lastHttp.path} → HTTP ${lastHttp.status} (${formatAgo(lastHttp.at)})`,
      ),
    );
  }

  const pendingExternal = [...externalActive.values()].filter(
    (e) => e.state === "pending",
  );
  if (pendingExternal.length === 0) {
    lines.push(line("api", "none in flight"));
  } else {
    for (const call of pendingExternal) {
      lines.push(
        line(
          "api",
          `${call.provider}: ${call.label} (${formatDuration(now - call.startedAt)})`,
        ),
      );
    }
  }

  if (externalRecent.length > 0) {
    const recent = externalRecent
      .slice(0, 4)
      .map((c) => {
        const mark = c.state === "done" ? "✓" : "✗";
        const tail = c.detail ? ` ${c.detail}` : "";
        return `${mark} ${c.provider} ${c.label}${tail}`;
      })
      .join(" · ");
    lines.push(line("recent", recent));
  }

  if (lastFallbackReason) {
    lines.push(line("fallback", lastFallbackReason));
  }

  lines.push(line("requests", String(totalHttpRequests)));
  lines.push(line("note", formatNote()));
  lines.push(line("updated", formatTs()));
  lines.push("────────────────────────────────────────");

  console.log(lines.join("\n"));
}

export function logBootSummary(port: number): void {
  logEvent(`server boot · port ${port} · ${isLiveMode() ? "LIVE" : "SAMPLE"}`);
  logEvent(
    "status board refreshes every 10s while work runs, 60s when idle — tracks any Vite dev port via Referer",
  );
}
