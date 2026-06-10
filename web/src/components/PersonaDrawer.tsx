import { useEffect, useState } from "react";
import type { PersonaDef, PersonaPOV } from "@prism/shared";
import { PERSONA_STYLE } from "../personaStyle";

const HORIZON_LABEL: Record<string, string> = {
  short: "Short term",
  long: "Long term",
  origin: "Relative to consensus",
};
const RISK_LABEL: Record<string, string> = {
  defensive: "Defensive",
  neutral: "Neutral",
  aggressive: "Aggressive",
};

/**
 * Slide-over showing a persona's daily POV (FR-2), its active bias lens, and —
 * on demand — its full durable definition (FR-3).
 */
export function PersonaDrawer({
  def,
  pov,
  onClose,
}: {
  def: PersonaDef;
  pov: PersonaPOV;
  onClose: () => void;
}) {
  const [showDef, setShowDef] = useState(false);
  const style = PERSONA_STYLE[def.id];
  const words = pov.text.trim().split(/\s+/).length;

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${def.name} — today's lens`}
      >
        <div className="drawer__bar">
          <div className="drawer__bar-left">
            <span
              className="persona-card__dot"
              style={{ background: style.color }}
            >
              {style.glyph}
            </span>
            <div>
              <div className="drawer__persona-name">{def.name}</div>
              <div className="drawer__persona-sub">
                {HORIZON_LABEL[def.horizon]} · {RISK_LABEL[def.risk]}
              </div>
            </div>
          </div>
          <button
            className="drawer__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="drawer__body">
          <div className="biaschip">
            <span className="biaschip__tag">BIAS TODAY</span>
            {pov.activeBias}
          </div>

          <p className="pov-text">{pov.text}</p>

          <div className="pov-meta">
            <span>{words} WORDS</span>
            <span>ONE LENS · NOT ADVICE</span>
          </div>

          <p className="lens-note">
            {def.name} is a fixed, deliberately biased archetype. Its take
            reflects that bias on purpose — it is one way of reading the day, to
            be compared against the others, never followed as a recommendation.
          </p>

          <button
            className="deftoggle"
            onClick={() => setShowDef((s) => !s)}
            aria-expanded={showDef}
          >
            <span>Full persona definition</span>
            <span className="mono">{showDef ? "−" : "+"}</span>
          </button>

          <div className={`def${showDef ? " def--open" : ""}`}>
            <div className="def__inner">
              <div className="def__grid">
                <Row k="Worldview" v={def.worldview} />
                <Row
                  k="Named biases"
                  tags={def.biases}
                />
                <Row k="Over-weights" tags={def.overweights} />
                <Row k="Under-weights" tags={def.underweights} />
                <Row k="Voice" v={def.voice} />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function Row({ k, v, tags }: { k: string; v?: string; tags?: string[] }) {
  return (
    <div className="deframe">
      <div className="deframe__k">{k}</div>
      <div className="deframe__v">
        {v}
        {tags && (
          <div className="taglist">
            {tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
