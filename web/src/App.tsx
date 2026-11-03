import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Archive as ArchiveIcon,
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  Moon,
  RefreshCw,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type {
  DayContent,
  HealthStatus,
  HistoryDaySummary,
  PersonaDef,
  PersonaId,
} from "@prism/shared";
import { DISCLAIMER } from "@prism/shared";
import { api } from "./api";
import { Hero } from "./components/Hero";
import { KeyPointCard } from "./components/KeyPointCard";
import { CastStrip } from "./components/CastStrip";
import { PersonaDrawer } from "./components/PersonaDrawer";
import { MyLensView } from "./components/MyLensView";

type View = "today" | "myLens" | "history";

export default function App() {
  const [view, setView] = useState<View>("today");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [defs, setDefs] = useState<PersonaDef[]>([]);
  const [today, setToday] = useState<DayContent | null>(null);
  const [history, setHistory] = useState<HistoryDaySummary[]>([]);
  const [historyDay, setHistoryDay] = useState<DayContent | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [myLensDay, setMyLensDay] = useState<DayContent | null>(null);
  const [active, setActive] = useState<PersonaId | null>(null);
  const [activeRead, setActiveRead] = useState<"first" | "strengthened">("first");
  const [error, setError] = useState<string | null>(null);
  const [refreshingToday, setRefreshingToday] = useState(false);
  const [refreshStartedAt, setRefreshStartedAt] = useState<number | null>(null);
  const [refreshElapsed, setRefreshElapsed] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [revealingRoomRead, setRevealingRoomRead] = useState(false);
  const [roomReadStartedAt, setRoomReadStartedAt] = useState<number | null>(null);
  const [roomReadElapsed, setRoomReadElapsed] = useState(0);
  const [roomReadError, setRoomReadError] = useState<string | null>(null);

  // Initial load: personas, today's content, health, and generated history.
  useEffect(() => {
    const controller = new AbortController();

    async function loadInitialData() {
      try {
        // Vite can be ready a fraction before the API process during `npm run
        // dev`. Probe one cheap endpoint first so that race cannot strand the
        // whole app on its error screen.
        let h: HealthStatus | null = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          try {
            h = await api.health(controller.signal);
            break;
          } catch (nextError) {
            if (controller.signal.aborted) return;
            lastError = nextError;
            await new Promise((resolve) =>
              window.setTimeout(resolve, Math.min(250 + attempt * 150, 1_000)),
            );
          }
        }
        if (!h) throw lastError ?? new Error("Prism API did not start");

        const [p, d, generatedHistory] = await Promise.all([
          api.personas(controller.signal),
          api.latestDay(controller.signal),
          api.history(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setDefs(p);
        setToday(d);
        setHealth(h);
        setHistory(generatedHistory);
        setError(null);
      } catch (nextError) {
        if (!controller.signal.aborted) setError(String(nextError));
      }
    }

    void loadInitialData();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (refreshStartedAt === null) {
      setRefreshElapsed(0);
      return;
    }
    const updateElapsed = () => {
      setRefreshElapsed(Math.floor((Date.now() - refreshStartedAt) / 1000));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [refreshStartedAt]);

  useEffect(() => {
    if (roomReadStartedAt === null) {
      setRoomReadElapsed(0);
      return;
    }
    const updateElapsed = () => {
      setRoomReadElapsed(Math.floor((Date.now() - roomReadStartedAt) / 1000));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [roomReadStartedAt]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const current =
    view === "history" && historyDay
      ? historyDay
      : view === "myLens" && myLensDay
        ? myLensDay
        : today;
  const activeDef = active ? defs.find((d) => d.id === active) ?? null : null;
  const activePov =
    active && current
      ? current.povs.find((p) => p.personaId === active) ?? null
      : null;
  const activeStrengthenedPov =
    active && current?.roomRead
      ? current.roomRead.strengthenedPovs.find((p) => p.personaId === active) ?? null
      : null;

  function pickPersona(
    id: PersonaId,
    read: "first" | "strengthened" = "first",
  ) {
    setActiveRead(read);
    setActive(id);
  }

  // Switch the day context (view or historical briefing) and always close any
  // open persona drawer — otherwise it would silently swap to the other day's
  // POV for the same persona, misattributing one day's read to another.
  function switchView(v: View) {
    setActive(null);
    setActiveRead("first");
    setView(v);
  }
  function backToHistory() {
    setActive(null);
    setActiveRead("first");
    setHistoryDay(null);
  }

  async function refreshToday() {
    if (refreshingToday) return;
    setActive(null);
    setRefreshError(null);
    setRefreshingToday(true);
    setRefreshStartedAt(Date.now());
    try {
      setToday(await api.refreshLatestDay());
    } catch (err) {
      setRefreshError(
        err instanceof Error ? err.message : "Could not update the brief.",
      );
    } finally {
      setRefreshingToday(false);
      setRefreshStartedAt(null);
    }
  }

  async function revealRoomRead() {
    if (revealingRoomRead || !today || today.roomRead) return;
    setActive(null);
    setRoomReadError(null);
    setRevealingRoomRead(true);
    setRoomReadStartedAt(Date.now());
    try {
      setToday(await api.revealLatestRoomRead());
    } catch (err) {
      setRoomReadError(
        err instanceof Error ? err.message : "Could not prepare second views.",
      );
    } finally {
      setRevealingRoomRead(false);
      setRoomReadStartedAt(null);
    }
  }

  // Sequence history fetches so a slow earlier response can't overwrite a
  // later selection (out-of-order responses would otherwise show a stale day).
  const historyReq = useRef(0);
  function openHistoryDay(date: string, generatedAt: string) {
    const token = ++historyReq.current;
    setActive(null);
    setHistoryDay(null);
    setHistoryLoading(true);
    api
      .historyDay(date, generatedAt)
      .then((d) => {
        if (historyReq.current === token) setHistoryDay(d);
      })
      .catch((e) => {
        if (historyReq.current === token) setError(String(e));
      })
      .finally(() => {
        if (historyReq.current === token) setHistoryLoading(false);
      });
  }

  if (error) {
    return (
      <Shell health={health} day={today} view={view} setView={switchView}>
        <div className="center-state">Couldn’t reach Prism — {error}</div>
      </Shell>
    );
  }

  if (!today || defs.length === 0) {
    return (
      <Shell health={health} day={today} view={view} setView={switchView}>
        <div className="center-state">
          <span className="pulse">Preparing today’s brief…</span>
        </div>
      </Shell>
    );
  }

  return (
    <Shell health={health} day={today} view={view} setView={switchView}>
      {view === "today" && (
        <div className="today-view">
          <Hero day={today} />
          <DayBody
            day={today}
            defs={defs}
            onPick={pickPersona}
            onRefresh={() => void refreshToday()}
            refreshing={refreshingToday}
            refreshElapsed={refreshElapsed}
            refreshError={refreshError}
            onRevealRoomRead={
              today.source === "live" ? () => void revealRoomRead() : undefined
            }
            onRetryRoomRead={async (id, signal) => {
              const updated = await api.retryLatestRoomReadPersona(id, signal);
              setToday(updated);
            }}
            revealingRoomRead={revealingRoomRead}
            roomReadElapsed={roomReadElapsed}
            roomReadError={roomReadError}
            onRetry={async (id, signal) => {
              const updated = await api.retryLatestPersona(id, signal);
              setToday(updated);
            }}
          />
        </div>
      )}

      {view === "history" && (
        <HistoryView
          history={history}
          day={historyDay}
          loading={historyLoading}
          defs={defs}
          onOpen={openHistoryDay}
          onBack={backToHistory}
          onPick={pickPersona}
        />
      )}

      <div hidden={view !== "myLens"}>
        <MyLensView
          defs={defs}
          onResult={setMyLensDay}
          onPick={pickPersona}
        />
      </div>

      <p className="disclaimer">{DISCLAIMER}</p>
      <footer className="project-credit">
        This project was vibe coded using Codex agents.
      </footer>

      {activeDef && activePov && (
        <PersonaDrawer
          key={`${active}-${activeRead}`}
          def={activeDef}
          pov={activePov}
          strengthenedPov={activeStrengthenedPov}
          initialRead={activeRead}
          context={
            current?.kind === "myLens"
              ? "your brief"
              : view === "history"
                ? "this brief"
                : "today"
          }
          onClose={() => setActive(null)}
        />
      )}
    </Shell>
  );
}

function DayBody({
  day,
  defs,
  onPick,
  onRefresh,
  refreshing = false,
  refreshElapsed = 0,
  refreshError = null,
  onRetry,
  onRevealRoomRead,
  onRetryRoomRead,
  revealingRoomRead = false,
  roomReadElapsed = 0,
  roomReadError = null,
}: {
  day: DayContent;
  defs: PersonaDef[];
  onPick: (id: PersonaId, read?: "first" | "strengthened") => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshElapsed?: number;
  refreshError?: string | null;
  onRetry?: (id: PersonaId, signal: AbortSignal) => Promise<void>;
  onRevealRoomRead?: () => void;
  onRetryRoomRead?: (id: PersonaId, signal: AbortSignal) => Promise<void>;
  revealingRoomRead?: boolean;
  roomReadElapsed?: number;
  roomReadError?: string | null;
}) {
  return (
    <>
      <section className="keypoints">
        <div className="section-heading">
          <div className="section-heading__copy">
            <span className="section-heading__eyebrow mono">Market drivers</span>
            <h2>What moved markets</h2>
            <span className="section-heading__count mono">
              {day.keyPoints.length} driver{day.keyPoints.length === 1 ? "" : "s"}
            </span>
          </div>
          <span className="section-label__tools">
            <time
              className="section-label__timestamp"
              dateTime={day.generatedAt}
              title={`Brief updated ${new Date(day.generatedAt).toLocaleString()}`}
            >
              Updated {formatBriefingTime(day.generatedAt)}
            </time>
            {onRefresh && (
              <button
                className="briefing-refresh"
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label={
                  refreshing
                    ? `Updating brief, ${refreshElapsed} seconds elapsed`
                    : "Update brief with the latest market news"
                }
                title={
                  refreshing
                    ? `Updating · ${refreshElapsed}s elapsed`
                    : "Update brief"
                }
              >
                <RefreshCw
                  className={refreshing ? "briefing-refresh__icon--spinning" : ""}
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>
            )}
          </span>
        </div>
        {refreshError && (
          <p className="keypoints__refresh-error" role="alert">
            Update failed. Your previous brief is still here. {refreshError}
          </p>
        )}
        <div className="keypoints__list">
          {day.keyPoints.map((kp, index) => (
            <KeyPointCard
              key={kp.id}
              index={index}
              keyPoint={kp}
              povs={day.povs}
            />
          ))}
        </div>
      </section>
      <CastStrip
        day={day}
        defs={defs}
        onPick={onPick}
        onRetry={onRetry}
        onRevealRoomRead={onRevealRoomRead}
        onRetryRoomRead={onRetryRoomRead}
        revealingRoomRead={revealingRoomRead}
        roomReadElapsed={roomReadElapsed}
        roomReadError={roomReadError}
      />
    </>
  );
}

function HistoryView({
  history,
  day,
  loading,
  defs,
  onOpen,
  onBack,
  onPick,
}: {
  history: HistoryDaySummary[];
  day: DayContent | null;
  loading: boolean;
  defs: PersonaDef[];
  onOpen: (date: string, generatedAt: string) => void;
  onBack: () => void;
  onPick: (id: PersonaId, read?: "first" | "strengthened") => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedGeneratedAt, setSelectedGeneratedAt] = useState<string | null>(
    null,
  );
  const [visibleMonth, setVisibleMonth] = useState("");

  useEffect(() => {
    if (history.length === 0) return;
    if (!selectedDate || !history.some((entry) => entry.date === selectedDate)) {
      setSelectedDate(history[0].date);
      setVisibleMonth(history[0].date.slice(0, 7));
    }
  }, [history, selectedDate]);

  useEffect(() => {
    const entry = history.find((candidate) => candidate.date === selectedDate);
    if (!entry) return;
    if (
      !selectedGeneratedAt ||
      !entry.briefings.some(
        (briefing) => briefing.generatedAt === selectedGeneratedAt,
      )
    ) {
      setSelectedGeneratedAt(entry.briefings[0]?.generatedAt ?? null);
    }
  }, [history, selectedDate, selectedGeneratedAt]);

  if (day) {
    return (
      <>
        <div className="tm-banner">
          <span className="tm-banner__txt">
            Viewing the <b>{formatBriefingTime(day.generatedAt)}</b> brief for{" "}
            <b>{formatHistoryDate(day.date)}</b>.
          </span>
          <button className="nav-btn" onClick={onBack}>
            ← Archive
          </button>
        </div>
        <Hero day={day} />
        <DayBody day={day} defs={defs} onPick={onPick} />
      </>
    );
  }

  if (loading) {
    return (
      <div className="center-state">
        <span className="pulse">Opening brief…</span>
      </div>
    );
  }

  const selectedEntry =
    history.find((entry) => entry.date === selectedDate) ?? history[0] ?? null;
  const selectedBriefing =
    selectedEntry?.briefings.find(
      (briefing) => briefing.generatedAt === selectedGeneratedAt,
    ) ?? selectedEntry?.briefings[0] ?? null;
  const month = visibleMonth || selectedEntry?.date.slice(0, 7) || "";
  const availableByDate = new Map(history.map((entry) => [entry.date, entry]));
  const historyMonths = [...new Set(history.map((entry) => entry.date.slice(0, 7)))]
    .sort((left, right) => left.localeCompare(right));
  const monthIndex = historyMonths.indexOf(month);

  function moveMonth(direction: -1 | 1) {
    const nextMonth = historyMonths[monthIndex + direction];
    if (!nextMonth) return;
    const nextEntry = history.find((entry) => entry.date.startsWith(nextMonth));
    setVisibleMonth(nextMonth);
    if (nextEntry) {
      setSelectedDate(nextEntry.date);
      setSelectedGeneratedAt(nextEntry.briefings[0]?.generatedAt ?? null);
    }
  }

  return (
    <section className="tm">
      <div className="section-label">Archive</div>
      <p className="tm__intro">
        Every brief you generate is saved by date. Choose a day, then select the
        version you want to revisit.
      </p>
      {history.length === 0 ? (
        <div className="history-empty">No saved briefs yet.</div>
      ) : (
        <div className="history-workspace">
          <div className="history-calendar">
            <div className="history-calendar__controls">
              <button
                className="history-calendar__month-btn"
                type="button"
                onClick={() => moveMonth(-1)}
                disabled={monthIndex <= 0}
                aria-label="Previous month"
                title="Previous month"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <span className="history-calendar__month">
                {formatHistoryMonth(month)}
              </span>
              <button
                className="history-calendar__month-btn"
                type="button"
                onClick={() => moveMonth(1)}
                disabled={monthIndex < 0 || monthIndex >= historyMonths.length - 1}
                aria-label="Next month"
                title="Next month"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="history-calendar__weekdays" aria-hidden="true">
              {WEEKDAYS.map((weekday, index) => (
                <span key={`${weekday}-${index}`}>{weekday}</span>
              ))}
            </div>
            <div className="history-calendar__days">
              {calendarDays(month).map((cell, index) => {
                if (!cell.date) {
                  return <span className="history-calendar__blank" key={`blank-${index}`} />;
                }
                const dayEntry = availableByDate.get(cell.date);
                const available = Boolean(dayEntry);
                const briefingCount = dayEntry?.briefings.length ?? 0;
                const selected = selectedEntry?.date === cell.date;
                return (
                  <button
                    className={`history-calendar__day${available ? " history-calendar__day--available" : ""}${selected ? " history-calendar__day--selected" : ""}`}
                    key={cell.date}
                    type="button"
                    disabled={!available}
                    aria-pressed={selected}
                    aria-label={`${formatHistoryDate(cell.date)}${available ? `, ${briefingCount} saved brief${briefingCount === 1 ? "" : "s"}` : ", no saved brief"}`}
                    onClick={() => {
                      setSelectedDate(cell.date);
                      setSelectedGeneratedAt(
                        dayEntry?.briefings[0]?.generatedAt ?? null,
                      );
                    }}
                  >
                    {cell.day}
                    {briefingCount > 1 && (
                      <span className="history-calendar__count" aria-hidden="true">
                        {briefingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedEntry && selectedBriefing && (
            <section className="history-overview" aria-live="polite">
              <div className="history-overview__date mono">
                {formatHistoryDate(selectedEntry.date)} ·{" "}
                {selectedEntry.briefings.length} brief
                {selectedEntry.briefings.length === 1 ? "" : "s"}
              </div>
              <div
                className="history-overview__versions"
                role="group"
                aria-label={`Saved briefs for ${formatHistoryDate(selectedEntry.date)}`}
              >
                {selectedEntry.briefings.map((briefing) => (
                  <button
                    className="history-overview__version"
                    type="button"
                    key={briefing.generatedAt}
                    aria-pressed={
                      briefing.generatedAt === selectedBriefing.generatedAt
                    }
                    title={`Saved ${formatHistoryTimestamp(briefing.generatedAt)}`}
                    onClick={() =>
                      setSelectedGeneratedAt(briefing.generatedAt)
                    }
                  >
                    {formatHistoryBriefTime(briefing.generatedAt)}
                  </button>
                ))}
              </div>
              <h2>{selectedBriefing.leadSummary}</h2>
              <div className="history-overview__metrics">
                <span>
                  <b>{selectedBriefing.keyPointCount}</b> market driver
                  {selectedBriefing.keyPointCount === 1 ? "" : "s"}
                </span>
                <span>
                  <b>{selectedBriefing.personaCount}/5</b> perspectives ready
                </span>
              </div>
              <p className="history-overview__generated mono">
                Saved {formatHistoryTimestamp(selectedBriefing.generatedAt)}
              </p>
              <button
                className="history-overview__open"
                type="button"
                onClick={() =>
                  onOpen(selectedEntry.date, selectedBriefing.generatedAt)
                }
              >
                Open brief
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

function calendarDays(month: string): Array<{ date: string | null; day: number }> {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return [];
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) return { date: null, day: 0 };
    return {
      date: `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      day,
    };
  });
}

function formatHistoryMonth(month: string): string {
  if (!month) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T12:00:00`));
}

function formatHistoryDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatHistoryTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatHistoryBriefTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatBriefingTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

function Shell({
  children,
  health,
  day,
  view,
  setView,
}: {
  children: React.ReactNode;
  health: HealthStatus | null;
  day: DayContent | null;
  view: View;
  setView: (v: View) => void;
}) {
  const showingSample =
    view === "today" && day?.source === "sample";
  const badgeLive = health?.mode === "live" && !showingSample;

  return (
    <>
      <header className="masthead">
        <div className="masthead__inner">
          <div className="wordmark">
            <img
              className="wordmark__icon"
              src={`${import.meta.env.BASE_URL}prism-icon.svg`}
              alt=""
              width="38"
              height="38"
            />
            <div className="wordmark__copy">
              <h1>Prism</h1>
              <span className="wordmark__tag">see where market views split</span>
            </div>
          </div>
          <div className="masthead__controls">
            <nav className="primary-nav" aria-label="Primary navigation">
              <button
                className={`nav-btn${view === "today" ? " nav-btn--active" : ""}`}
                onClick={() => setView("today")}
                aria-current={view === "today" ? "page" : undefined}
              >
                <Home className="nav-btn__icon" size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>Today</span>
              </button>
              <button
                className={`nav-btn${view === "myLens" ? " nav-btn--active" : ""}`}
                onClick={() => setView("myLens")}
                aria-current={view === "myLens" ? "page" : undefined}
              >
                <FileText className="nav-btn__icon" size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>Your Brief</span>
              </button>
              <button
                className={`nav-btn${
                  view === "history" ? " nav-btn--active" : ""
                }`}
                onClick={() => setView("history")}
                aria-current={view === "history" ? "page" : undefined}
              >
                <ArchiveIcon className="nav-btn__icon" size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>Archive</span>
              </button>
            </nav>
            {health && (
              <span
                className={`badge ${
                  badgeLive ? "badge--live" : "badge--sample"
                }`}
                title={
                  showingSample && health.mode === "live"
                    ? "Live update failed — showing sample data"
                    : badgeLive
                      ? `Using live market data · ${health.model}`
                      : "Using sample market data"
                }
              >
                {showingSample
                  ? "Sample data"
                  : badgeLive
                    ? "● Live"
                    : "Sample data"}
              </span>
            )}
            <SettingsMenu />
          </div>
        </div>
      </header>
      <main className={`shell shell--${view}`}>{children}</main>
    </>
  );
}

type Theme = "dark" | "light";

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("prism.theme", theme);
    } catch {
      // Theme still applies for this session when browser storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <div className="settings" ref={root}>
      <button
        className="settings__trigger"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Settings"
      >
        <SlidersHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
        <span className="settings__mobile-label">Settings</span>
      </button>
      <div
        className="settings__panel"
        data-open={open}
        role="dialog"
        aria-label="Settings"
        aria-hidden={!open}
      >
        <span className="settings__label">Appearance</span>
        <button
          className="settings__theme"
          type="button"
          onClick={() => setTheme(nextTheme)}
          aria-label={`Switch to ${nextTheme} mode`}
          title={`Switch to ${nextTheme} mode`}
        >
          <span
            className={`settings__theme-icon${theme === "dark" ? " settings__theme-icon--active" : ""}`}
            aria-hidden="true"
          >
            <Sun size={17} strokeWidth={1.8} />
          </span>
          <span
            className={`settings__theme-icon${theme === "light" ? " settings__theme-icon--active" : ""}`}
            aria-hidden="true"
          >
            <Moon size={17} strokeWidth={1.8} />
          </span>
        </button>
      </div>
    </div>
  );
}
