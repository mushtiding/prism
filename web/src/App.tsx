import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);

  // Initial load: personas, today's content, health, and generated history.
  useEffect(() => {
    Promise.all([
      api.personas(),
      api.latestDay(),
      api.health(),
      api.history(),
    ])
      .then(([p, d, h, generatedHistory]) => {
        setDefs(p);
        setToday(d);
        setHealth(h);
        setHistory(generatedHistory);
      })
      .catch((e) => setError(String(e)));
  }, []);

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

  // Switch the day context (view or historical briefing) and always close any
  // open persona drawer — otherwise it would silently swap to the other day's
  // POV for the same persona, misattributing one day's read to another.
  function switchView(v: View) {
    setActive(null);
    setView(v);
  }
  function backToHistory() {
    setActive(null);
    setHistoryDay(null);
  }

  // Sequence history fetches so a slow earlier response can't overwrite a
  // later selection (out-of-order responses would otherwise show a stale day).
  const historyReq = useRef(0);
  function openHistoryDay(date: string) {
    const token = ++historyReq.current;
    setActive(null);
    setHistoryDay(null);
    setHistoryLoading(true);
    api
      .historyDay(date)
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
          <span className="pulse">Refracting today’s briefing…</span>
        </div>
      </Shell>
    );
  }

  return (
    <Shell health={health} day={today} view={view} setView={switchView}>
      {view === "today" && (
        <>
          <Hero day={today} />
          <DayBody
            day={today}
            defs={defs}
            onPick={setActive}
            onRetry={async (id, signal) => {
              const updated = await api.retryLatestPersona(id, signal);
              setToday(updated);
            }}
          />
        </>
      )}

      {view === "history" && (
        <HistoryView
          history={history}
          day={historyDay}
          loading={historyLoading}
          defs={defs}
          onOpen={openHistoryDay}
          onBack={backToHistory}
          onPick={setActive}
        />
      )}

      <div hidden={view !== "myLens"}>
        <MyLensView
          defs={defs}
          onResult={setMyLensDay}
          onPick={setActive}
        />
      </div>

      <p className="disclaimer">{DISCLAIMER}</p>

      {activeDef && activePov && (
        <PersonaDrawer
          def={activeDef}
          pov={activePov}
          context={
            current?.kind === "myLens"
              ? "your articles"
              : view === "history"
                ? "this briefing"
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
  onRetry,
}: {
  day: DayContent;
  defs: PersonaDef[];
  onPick: (id: PersonaId) => void;
  onRetry?: (id: PersonaId, signal: AbortSignal) => Promise<void>;
}) {
  return (
    <>
      <section className="keypoints">
        <div className="section-label">
          What moved · {day.keyPoints.length} key points
        </div>
        {day.keyPoints.map((kp) => (
          <KeyPointCard key={kp.id} keyPoint={kp} povs={day.povs} />
        ))}
      </section>
      <CastStrip day={day} defs={defs} onPick={onPick} onRetry={onRetry} />
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
  onOpen: (id: string) => void;
  onBack: () => void;
  onPick: (id: PersonaId) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState("");

  useEffect(() => {
    if (history.length === 0) return;
    if (!selectedDate || !history.some((entry) => entry.date === selectedDate)) {
      setSelectedDate(history[0].date);
      setVisibleMonth(history[0].date.slice(0, 7));
    }
  }, [history, selectedDate]);

  if (day) {
    return (
      <>
        <div className="tm-banner">
          <span className="tm-banner__txt">
            Viewing the generated briefing for <b>{formatHistoryDate(day.date)}</b>.
          </span>
          <button className="nav-btn" onClick={onBack}>
            ← History
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
        <span className="pulse">Opening briefing…</span>
      </div>
    );
  }

  const selectedEntry =
    history.find((entry) => entry.date === selectedDate) ?? history[0] ?? null;
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
    if (nextEntry) setSelectedDate(nextEntry.date);
  }

  return (
    <section className="tm">
      <div className="section-label">History</div>
      <p className="tm__intro">
        Prior daily briefings appear here only when they were generated on that
        date. Opening one reads the saved analysis and never starts a new run.
      </p>
      {history.length === 0 ? (
        <div className="history-empty">No prior generated briefings yet.</div>
      ) : (
        <div className="history-workspace">
          <div className="history-calendar">
            <div className="history-calendar__controls">
              <button
                className="history-calendar__month-btn"
                type="button"
                onClick={() => moveMonth(-1)}
                disabled={monthIndex <= 0}
                aria-label="Previous history month"
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
                aria-label="Next history month"
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
                const available = availableByDate.has(cell.date);
                const selected = selectedEntry?.date === cell.date;
                return (
                  <button
                    className={`history-calendar__day${available ? " history-calendar__day--available" : ""}${selected ? " history-calendar__day--selected" : ""}`}
                    key={cell.date}
                    type="button"
                    disabled={!available}
                    aria-pressed={selected}
                    aria-label={`${formatHistoryDate(cell.date)}${available ? ", generated briefing" : ", no briefing"}`}
                    onClick={() => setSelectedDate(cell.date)}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedEntry && (
            <section className="history-overview" aria-live="polite">
              <div className="history-overview__date mono">
                {formatHistoryDate(selectedEntry.date)}
              </div>
              <h2>{selectedEntry.leadSummary}</h2>
              <div className="history-overview__metrics">
                <span>
                  <b>{selectedEntry.keyPointCount}</b> market move
                  {selectedEntry.keyPointCount === 1 ? "" : "s"}
                </span>
                <span>
                  <b>{selectedEntry.personaCount}/5</b> lenses available
                </span>
              </div>
              <p className="history-overview__generated mono">
                Generated {formatHistoryTimestamp(selectedEntry.generatedAt)}
              </p>
              <button
                className="history-overview__open"
                type="button"
                onClick={() => onOpen(selectedEntry.date)}
              >
                Open full analysis
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
            <div className="wordmark__row">
              <h1>Prism</h1>
              <span className="wordmark__tag">the disagreement is the signal</span>
            </div>
            <div className="refraction" />
          </div>
          <div className="masthead__right">
            <button
              className={`nav-btn${view === "today" ? " nav-btn--active" : ""}`}
              onClick={() => setView("today")}
            >
              Today
            </button>
            <button
              className={`nav-btn${view === "myLens" ? " nav-btn--active" : ""}`}
              onClick={() => setView("myLens")}
            >
              Your Moves
            </button>
            <button
              className={`nav-btn${
                view === "history" ? " nav-btn--active" : ""
              }`}
              onClick={() => setView("history")}
            >
              History
            </button>
            {health && (
              <span
                className={`badge ${
                  badgeLive ? "badge--live" : "badge--sample"
                }`}
                title={
                  showingSample && health.mode === "live"
                    ? "Live generation failed — showing bundled sample day"
                    : badgeLive
                      ? `Live · ${health.model}`
                      : "Sample data — set API keys for live generation"
                }
              >
                {showingSample
                  ? "Sample data"
                  : badgeLive
                    ? "● Live"
                    : "Sample data"}
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}
