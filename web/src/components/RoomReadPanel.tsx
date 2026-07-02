import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, Eye, LoaderCircle, RefreshCw } from "lucide-react";
import type { DayContent, PersonaDef, PersonaId, PersonaPOV } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { PERSONA_STYLE } from "../personaStyle";

function lean(pov: PersonaPOV): string {
  if (pov.stances.length === 0) return "neutral";
  const average =
    pov.stances.reduce((total, stance) => total + stance.score, 0) /
    pov.stances.length;
  if (average > 0.5) return "bullish";
  if (average < -0.5) return "bearish";
  return "mixed";
}

export function RoomReadPanel({
  day,
  defs,
  onPick,
  onReveal,
  onRetry,
  revealing = false,
  elapsed = 0,
  error = null,
}: {
  day: DayContent;
  defs: PersonaDef[];
  onPick: (id: PersonaId) => void;
  onReveal?: () => void;
  onRetry?: (id: PersonaId, signal: AbortSignal) => Promise<void>;
  revealing?: boolean;
  elapsed?: number;
  error?: string | null;
}) {
  const [waiting, setWaiting] = useState<Partial<Record<PersonaId, number>>>({});
  const [retryErrors, setRetryErrors] = useState<
    Partial<Record<PersonaId, string>>
  >({});
  const retryControllers = useRef(new Map<PersonaId, AbortController>());

  useEffect(() => {
    const controllers = retryControllers.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  async function retryPersona(id: PersonaId) {
    if (!onRetry || retryControllers.current.has(id)) return;
    const controller = new AbortController();
    retryControllers.current.set(id, controller);
    const deadline = Date.now() + 60_000;
    setRetryErrors((current) => ({ ...current, [id]: undefined }));
    setWaiting((current) => ({ ...current, [id]: 60 }));
    const ticker = window.setInterval(() => {
      setWaiting((current) => ({
        ...current,
        [id]: Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)),
      }));
    }, 250);
    const timeout = window.setTimeout(() => controller.abort(), 61_000);

    try {
      await onRetry(id, controller.signal);
    } catch (err) {
      setRetryErrors((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : "Retry failed.",
      }));
    } finally {
      window.clearInterval(ticker);
      window.clearTimeout(timeout);
      retryControllers.current.delete(id);
      setWaiting((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  if (!day.roomRead) {
    if (!onReveal) return null;
    return (
      <div className="room-read-reveal">
        <button
          className="room-read-reveal__button"
          type="button"
          onClick={onReveal}
          disabled={revealing || day.povs.length < 2}
          title={
            day.povs.length < 2
              ? "Room Read needs at least two first impressions"
              : revealing
                ? `Reading the room · ${elapsed}s elapsed`
                : "Reveal room read"
          }
          aria-label={
            revealing
              ? `Personas are reading the room, ${elapsed} seconds elapsed`
              : "Reveal strengthened persona reads"
          }
        >
          {revealing ? (
            <LoaderCircle
              className="room-read-reveal__spinner"
              size={16}
              aria-hidden="true"
            />
          ) : (
            <Eye size={16} aria-hidden="true" />
          )}
          <span>{revealing ? `Reading the room · ${elapsed}s` : "Reveal room read"}</span>
        </button>
        {error && (
          <p className="room-read-reveal__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  const strengthenedByPersona = new Map(
    day.roomRead.strengthenedPovs.map((pov) => [pov.personaId, pov]),
  );
  const roomPersonaIds = PERSONA_IDS.filter((id) =>
    day.povs.some((pov) => pov.personaId === id),
  );
  const missingCount = roomPersonaIds.length - day.roomRead.strengthenedPovs.length;

  return (
    <section className="room-read" aria-labelledby="room-read-title">
      <div className="section-label" id="room-read-title">
        Room read · {day.roomRead.strengthenedPovs.length} of {roomPersonaIds.length}{" "}
        strengthened
      </div>
      <div className="room-read__briefing">
        <BookOpenCheck size={18} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <span className="room-read__eyebrow">After reading the room</span>
          <p>{day.roomRead.briefing}</p>
        </div>
      </div>
      <div className="room-read__grid">
        {roomPersonaIds.map((personaId) => {
          const pov = strengthenedByPersona.get(personaId);
          const def = defs.find((candidate) => candidate.id === personaId);
          if (!def) return null;
          const style = PERSONA_STYLE[personaId];
          if (pov) return (
            <button
              className="strengthened-card"
              key={personaId}
              type="button"
              style={{ "--accent": style.color } as React.CSSProperties}
              onClick={() => onPick(personaId)}
            >
              <span className="strengthened-card__top">
                <span className="strengthened-card__label">Strengthened</span>
                <span className="strengthened-card__lean mono">{lean(pov)}</span>
              </span>
              <span className="strengthened-card__name" style={{ color: style.color }}>
                {style.charName}
              </span>
              <span className="strengthened-card__bias">{pov.activeBias}</span>
              <span className="strengthened-card__excerpt">{pov.text}</span>
              <span className="strengthened-card__cta">Read strengthened lens →</span>
            </button>
          );
          const secondsLeft = waiting[personaId];
          const isWaiting = secondsLeft !== undefined;
          return (
            <article
              className="strengthened-card strengthened-card--unavailable"
              key={personaId}
              style={{ "--accent": style.color } as React.CSSProperties}
            >
              <span className="strengthened-card__top">
                <span className="strengthened-card__label">Unavailable</span>
                <span className="strengthened-card__lean mono">
                  {isWaiting ? `${secondsLeft}s` : "no second read"}
                </span>
              </span>
              <span className="strengthened-card__name" style={{ color: style.color }}>
                {style.charName}
              </span>
              <span className="strengthened-card__bias">{def.name}</span>
              <span className="strengthened-card__excerpt">
                No distinct strengthened opinion returned.
              </span>
              {retryErrors[personaId] && (
                <span className="strengthened-card__error" role="alert">
                  {retryErrors[personaId]}
                </span>
              )}
              {onRetry && (
                <button
                  className="strengthened-card__retry"
                  type="button"
                  disabled={isWaiting}
                  onClick={() => void retryPersona(personaId)}
                >
                  {isWaiting ? (
                    <LoaderCircle
                      className="room-read-reveal__spinner"
                      size={14}
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw size={14} aria-hidden="true" />
                  )}
                  <span>{isWaiting ? "Waiting" : "Retry"}</span>
                </button>
              )}
            </article>
          );
        })}
      </div>
      {missingCount > 0 && !onRetry && (
        <p className="room-read__partial-note">
          {missingCount} strengthened lens{missingCount === 1 ? " is" : "es are"}{" "}
          unavailable in this saved briefing.
        </p>
      )}
    </section>
  );
}
