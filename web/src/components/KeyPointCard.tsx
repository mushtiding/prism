import { useState } from "react";
import type { KeyPoint, PersonaPOV } from "@prism/shared";
import { PERSONA_IDS } from "@prism/shared";
import { PERSONA_STYLE, magnitudeDirection } from "../personaStyle";
import { Spectrum, type SpectrumPoint } from "./Spectrum";

const LEVEL_WORD = {
  consensus: "Consensus",
  mixed: "Mixed",
  contested: "Contested",
} as const;

/**
 * One neutral key point (FR-1). Collapsed: flat summary + magnitude + a mini
 * divergence spectrum. Expanded (FR-6): detail, sources, and each persona's
 * stance on this specific event.
 */
export function KeyPointCard({
  keyPoint,
  povs,
}: {
  keyPoint: KeyPoint;
  povs: PersonaPOV[];
}) {
  const [open, setOpen] = useState(false);

  const points: SpectrumPoint[] = [];
  for (const id of PERSONA_IDS) {
    const pov = povs.find((p) => p.personaId === id);
    const stance = pov?.stances.find((s) => s.keyPointId === keyPoint.id);
    if (stance) points.push({ personaId: id, score: stance.score });
  }

  return (
    <article className={`kp${open ? " kp--open" : ""}`}>
      <button
        className="kp__head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="kp__main">
          <div className="kp__summary">{keyPoint.summary}</div>
          <div className="kp__meta">
            {keyPoint.magnitude && (
              <span
                className={`kp__mag mono${
                  magnitudeDirection(keyPoint.magnitude) === "up"
                    ? " kp__mag--up"
                    : magnitudeDirection(keyPoint.magnitude) === "down"
                      ? " kp__mag--down"
                      : ""
                }`}
              >
                {keyPoint.magnitude}
              </span>
            )}
            <span className="kp__divlabel">
              {points.length >= 2
                ? `${LEVEL_WORD[keyPoint.divergence.level]} · ${keyPoint.divergence.score.toFixed(2)}`
                : "Awaiting lenses"}
            </span>
          </div>
        </div>
        <div className="kp__right">
          <div className="kp__spectrum">
            <Spectrum points={points} size="sm" />
          </div>
          <span className="kp__chev">▾</span>
        </div>
      </button>

      <div className="kp__detail">
        <div className="kp__detail-inner">
          <div className="kp__detail-pad">
            {keyPoint.highlights && keyPoint.highlights.length > 0 && (
              <ul className="kp__highlights">
                {keyPoint.highlights.map((highlight, index) => (
                  <li key={index}>{highlight}</li>
                ))}
              </ul>
            )}
            {keyPoint.detail && (
              <p className="kp__detail-text">{keyPoint.detail}</p>
            )}

            {keyPoint.sources.length > 0 && (
              <div className="sources">
                <span className="sources__label">Sources</span>
                {keyPoint.sources.map((s, i) => (
                  <a
                    className="source-link"
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    key={i}
                  >
                    {s.title}
                    <span className="source-link__pub">{s.publisher} ↗</span>
                  </a>
                ))}
              </div>
            )}

            {points.length > 0 && (
              <div className="stancegrid">
                <span className="stancegrid__label">How each lens reads it</span>
                {PERSONA_IDS.map((id) => {
                  const pov = povs.find((p) => p.personaId === id);
                  const stance = pov?.stances.find(
                    (s) => s.keyPointId === keyPoint.id,
                  );
                  if (!stance) return null;
                  const style = PERSONA_STYLE[id];
                  return (
                    <div className="stancerow" key={id}>
                      <span className="stancerow__name">
                        <span
                          className="dot"
                          style={{ background: style.color }}
                        >
                          {style.glyph}
                        </span>
                        {style.short}
                      </span>
                      <span className="stancerow__score mono">
                        {stance.score > 0 ? "+" : ""}
                        {stance.score} {stance.label}
                      </span>
                      <span className="stancerow__why">{stance.rationale}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
