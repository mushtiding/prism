import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PersonaDef, PersonaPOV } from "@prism/shared";
import { PixelPet } from "./PixelPet";

const HORIZON_LABEL: Record<string, string> = {
  short: "Short-term",
  long: "Long-term",
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
  strengthenedPov,
  initialRead = "first",
  context = "today",
  onClose,
}: {
  def: PersonaDef;
  pov: PersonaPOV;
  strengthenedPov?: PersonaPOV | null;
  initialRead?: "first" | "strengthened";
  context?: "today" | "your brief" | "this brief";
  onClose: () => void;
}) {
  const [showDef, setShowDef] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const [read, setRead] = useState<"first" | "strengthened">(
    initialRead === "strengthened" && strengthenedPov ? "strengthened" : "first",
  );
  const displayedPov = read === "strengthened" && strengthenedPov ? strengthenedPov : pov;
  const words = displayedPov.text.trim().split(/\s+/).length;

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 150);
  }, [onClose]);

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, [requestClose]);

  return (
    <>
      <div
        className={`scrim${closing ? " scrim--closing" : ""}`}
        onClick={requestClose}
      />
      <aside
        className={`drawer${closing ? " drawer--closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${def.name} — perspective on ${context}`}
      >
        <div className="drawer__bar">
          <div className="drawer__bar-left">
            <span className="petscreen petscreen--sm">
              <PixelPet id={def.id} px={2} />
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
            onClick={requestClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <div className="drawer__body">
          {strengthenedPov && (
            <div className="read-switch" role="tablist" aria-label="Perspective version">
              <button
                type="button"
                role="tab"
                aria-selected={read === "first"}
                onClick={() => setRead("first")}
              >
                Initial view
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={read === "strengthened"}
                onClick={() => setRead("strengthened")}
              >
                Second view
              </button>
            </div>
          )}

          <div className="biaschip">
            <span className="biaschip__tag">
              {read === "strengthened"
                ? "BIAS IN SECOND VIEW"
                : "BIAS IN INITIAL VIEW"}
            </span>
            {displayedPov.activeBias}
          </div>

          <p className="pov-text">{displayedPov.text}</p>

          <div className="pov-meta">
            <span>{words} WORDS</span>
            <span>ONE PERSPECTIVE · NOT ADVICE</span>
          </div>

          <p className="lens-note">
            {def.name} is a fixed, deliberately biased market perspective. Its
            take reflects that bias on purpose — it is one way of reading {context},
            to be compared with the others, never followed as a recommendation.
            {read === "strengthened" &&
              " This second view was written independently after reviewing the other initial views; it is not a group consensus."}
          </p>

          <button
            className="deftoggle"
            onClick={() => setShowDef((s) => !s)}
            aria-expanded={showDef}
          >
            <span>About this perspective</span>
            <span className="mono">{showDef ? "−" : "+"}</span>
          </button>

          <div className={`def${showDef ? " def--open" : ""}`}>
            <div className="def__inner">
              <div className="def__grid">
                <Row k="Core belief" v={def.worldview} />
                <Row
                  k="Built-in biases"
                  tags={def.biases}
                />
                <Row k="Pays more attention to" tags={def.overweights} />
                <Row k="Pays less attention to" tags={def.underweights} />
                <Row k="Writing style" v={def.voice} />
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
