import { useEffect, useRef, useState } from "react";
import type {
  DayContent,
  HealthStatus,
  PersonaDef,
  PersonaId,
  TimeMachineEvent,
} from "@prism/shared";
import { DISCLAIMER } from "@prism/shared";
import { api } from "./api";
import { Hero } from "./components/Hero";
import { KeyPointCard } from "./components/KeyPointCard";
import { CastStrip } from "./components/CastStrip";
import { PersonaDrawer } from "./components/PersonaDrawer";
import { MyLensView } from "./components/MyLensView";

type View = "today" | "myLens" | "timemachine";

export default function App() {
  const [view, setView] = useState<View>("today");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [defs, setDefs] = useState<PersonaDef[]>([]);
  const [today, setToday] = useState<DayContent | null>(null);
  const [catalog, setCatalog] = useState<TimeMachineEvent[]>([]);
  const [tmDay, setTmDay] = useState<DayContent | null>(null);
  const [myLensDay, setMyLensDay] = useState<DayContent | null>(null);
  const [active, setActive] = useState<PersonaId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial load: personas, today's content, health, time-machine catalog.
  useEffect(() => {
    Promise.all([
      api.personas(),
      api.latestDay(),
      api.health(),
      api.timeMachineCatalog(),
    ])
      .then(([p, d, h, c]) => {
        setDefs(p);
        setToday(d);
        setHealth(h);
        setCatalog(c);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const current =
    view === "timemachine" && tmDay
      ? tmDay
      : view === "myLens" && myLensDay
        ? myLensDay
        : today;
  const activeDef = active ? defs.find((d) => d.id === active) ?? null : null;
  const activePov =
    active && current
      ? current.povs.find((p) => p.personaId === active) ?? null
      : null;

  // Switch the day context (view or time-machine event) and always close any
  // open persona drawer — otherwise it would silently swap to the other day's
  // POV for the same persona, misattributing one day's read to another.
  function switchView(v: View) {
    setActive(null);
    setView(v);
  }
  function backToCatalog() {
    setActive(null);
    setTmDay(null);
  }

  // Sequence time-machine fetches so a slow earlier response can't overwrite a
  // later selection (out-of-order responses would otherwise show a stale day).
  const tmReq = useRef(0);
  function openTimeMachineEvent(id: string) {
    const token = ++tmReq.current;
    setActive(null);
    setTmDay(null);
    api
      .timeMachineDay(id)
      .then((d) => {
        if (tmReq.current === token) setTmDay(d);
      })
      .catch((e) => {
        if (tmReq.current === token) setError(String(e));
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

      {view === "timemachine" && (
        <TimeMachineView
          catalog={catalog}
          day={tmDay}
          defs={defs}
          onOpen={openTimeMachineEvent}
          onBack={backToCatalog}
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
          context={current?.kind === "myLens" ? "your articles" : "today"}
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

function TimeMachineView({
  catalog,
  day,
  defs,
  onOpen,
  onBack,
  onPick,
}: {
  catalog: TimeMachineEvent[];
  day: DayContent | null;
  defs: PersonaDef[];
  onOpen: (id: string) => void;
  onBack: () => void;
  onPick: (id: PersonaId) => void;
}) {
  if (day) {
    return (
      <>
        <div className="tm-banner">
          <span className="tm-banner__txt">
            Replaying <b>{day.title}</b> — watch the same five lenses react to a
            past event.
          </span>
          <button className="nav-btn" onClick={onBack}>
            ← All events
          </button>
        </div>
        <Hero day={day} />
        <DayBody day={day} defs={defs} onPick={onPick} />
      </>
    );
  }

  return (
    <section className="tm">
      <div className="section-label">Time machine</div>
      <p className="tm__intro">
        Replay a notable market day and watch the cast react in character. The
        same divergence signal applies — see where the lenses converged in fear,
        and where they broke apart.
      </p>
      <div className="tm__grid">
        {catalog.map((e) => (
          <button className="tm-card" key={e.id} onClick={() => onOpen(e.id)}>
            <span className="tm-card__date mono">{e.date}</span>
            <span className="tm-card__title">{e.title}</span>
            <span className="tm-card__blurb">{e.blurb}</span>
            <span className="tm-card__cta">Replay →</span>
          </button>
        ))}
      </div>
    </section>
  );
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
              My Lens
            </button>
            <button
              className={`nav-btn${
                view === "timemachine" ? " nav-btn--active" : ""
              }`}
              onClick={() => setView("timemachine")}
            >
              Time machine
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
