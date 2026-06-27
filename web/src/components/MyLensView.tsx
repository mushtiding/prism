import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type {
  DayContent,
  MyLensArticleResult,
  MyLensJobProgress,
  PersonaDef,
  PersonaId,
} from "@prism/shared";
import { api } from "../api";
import { CastStrip } from "./CastStrip";
import { Hero } from "./Hero";
import { KeyPointCard } from "./KeyPointCard";

const ARTICLE_CHAR_LIMIT = 1_500;
const MAX_ARTICLES = 3;
const STORAGE_KEY = "prism.my-lens.v1";

interface DraftArticle {
  id: string;
  value: string;
}

interface StoredMyLensState {
  drafts: DraftArticle[];
  results: Record<string, MyLensArticleResult>;
  day: DayContent | null;
}

function emptyState(): StoredMyLensState {
  return {
    drafts: [{ id: "my-lens-1", value: "" }],
    results: {},
    day: null,
  };
}

function loadStoredState(): StoredMyLensState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<StoredMyLensState>
      | null;
    const drafts = Array.isArray(parsed?.drafts)
      ? parsed.drafts
          .filter(
            (draft): draft is DraftArticle =>
              Boolean(
                draft &&
                  typeof draft.id === "string" &&
                  typeof draft.value === "string",
              ),
          )
          .slice(0, MAX_ARTICLES)
      : [];
    const results = Object.fromEntries(
      Object.entries(parsed?.results ?? {}).filter(([, result]) =>
        Boolean(
          result &&
            (result.status === "valid" || result.status === "invalid") &&
            (result.inputType === "text" || result.inputType === "url"),
        ),
      ),
    ) as Record<string, MyLensArticleResult>;
    const day = parsed?.day?.kind === "myLens" ? parsed.day : null;
    return {
      drafts: drafts.length > 0 ? drafts : emptyState().drafts,
      results,
      day,
    };
  } catch {
    return emptyState();
  }
}

function nextDraftNumber(drafts: DraftArticle[]): number {
  return (
    Math.max(
      0,
      ...drafts.map((draft) =>
        Number(draft.id.match(/^my-lens-(\d+)$/)?.[1] ?? 0),
      ),
    ) + 1
  );
}

function looksLikeUrl(value: string): boolean {
  return /^(?:https?:\/\/|www\.)/i.test(value.trim());
}

export function MyLensView({
  defs,
  onResult,
  onPick,
}: {
  defs: PersonaDef[];
  onResult: (day: DayContent | null) => void;
  onPick: (id: PersonaId) => void;
}) {
  const [stored] = useState(loadStoredState);
  const nextId = useRef(nextDraftNumber(stored.drafts));
  const [drafts, setDrafts] = useState<DraftArticle[]>(stored.drafts);
  const [results, setResults] = useState<Record<string, MyLensArticleResult>>(
    stored.results,
  );
  const [day, setDay] = useState<DayContent | null>(stored.day);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MyLensJobProgress | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    onResult(day);
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ drafts, results, day } satisfies StoredMyLensState),
      );
    } catch {
      // Storage can be unavailable in privacy modes; in-memory state still works.
    }
  }, [day, drafts, onResult, results]);

  function updateDraft(id: string, value: string) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, value } : draft)),
    );
    setResults((current) => {
      if (!current[id] || current[id].status === "valid") return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setError(null);
    setProgress(null);
  }

  function addDraft() {
    if (drafts.length >= MAX_ARTICLES) return;
    const id = `my-lens-${nextId.current++}`;
    setDrafts((current) => [...current, { id, value: "" }]);
    setError(null);
    setProgress(null);
  }

  function removeDraft(id: string) {
    const removedGeneratedArticle = results[id]?.status === "valid";
    setDrafts((current) => {
      const next = current.filter((draft) => draft.id !== id);
      return next.length > 0
        ? next
        : [{ id: `my-lens-${nextId.current++}`, value: "" }];
    });
    if (removedGeneratedArticle) {
      setResults({});
      setDay(null);
    } else {
      setResults((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    setError(null);
    setProgress(null);
  }

  async function analyze() {
    const articles = drafts
      .filter((draft) => draft.value.trim())
      .map(({ id, value }) => ({ id, value }));
    if (articles.length === 0 || loading) return;

    setLoading(true);
    setError(null);
    setProgress({ phase: "queued", message: "Starting analysis" });
    setElapsedSeconds(0);
    try {
      const { jobId } = await api.startMyLensAnalysis(articles);
      while (true) {
        const job = await api.myLensJob(jobId);
        setProgress(job.progress);
        setElapsedSeconds(
          Math.max(0, Math.floor((Date.now() - Date.parse(job.startedAt)) / 1000)),
        );

        if (job.status !== "running") {
          if (job.status === "complete" && job.result) {
            setResults(
              Object.fromEntries(
                job.result.articles.map((article) => [article.id, article]),
              ),
            );
            setDay(job.result.day);
          }
          if (job.status === "failed") {
            if (!day && job.result) {
              setResults(
                Object.fromEntries(
                  job.result.articles.map((article) => [article.id, article]),
                ),
              );
            }
            throw new Error(job.error ?? "The analysis could not finish.");
          }
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not analyze these articles.");
    } finally {
      setLoading(false);
    }
  }

  const readyCount = drafts.filter((draft) => draft.value.trim()).length;

  return (
    <>
      <section className="my-lens">
        <div className="section-label">My Lens</div>
        <div className="my-lens__inputs">
          {drafts.map((draft, index) => {
            const result = results[draft.id];
            const urlInput = looksLikeUrl(draft.value);
            const analyzedChars = Math.min(draft.value.length, ARTICLE_CHAR_LIMIT);
            const countLabel = urlInput
              ? "first 1,500 article chars analyzed"
              : `${analyzedChars.toLocaleString()} / 1,500 analyzed${draft.value.length > ARTICLE_CHAR_LIMIT ? " · truncated" : ""}`;
            return (
              <div
                className={`article-input${result?.status === "invalid" ? " article-input--invalid" : ""}`}
                key={draft.id}
              >
                <div className="article-input__head">
                  <label htmlFor={draft.id}>Article {index + 1}</label>
                  <div className="article-input__tools">
                    <span className="article-input__mode mono">
                      {urlInput ? "URL" : "TEXT"}
                    </span>
                    {(draft.value.trim() || drafts.length > 1) && (
                      <button
                        className="article-input__remove"
                        onClick={() => removeDraft(draft.id)}
                        title={`Remove article ${index + 1}`}
                        aria-label={`Remove article ${index + 1}`}
                        data-testid={`remove-${draft.id}`}
                        type="button"
                        disabled={loading}
                      >
                        <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  id={draft.id}
                  value={draft.value}
                  onChange={(event) => updateDraft(draft.id, event.target.value)}
                  placeholder="Paste a finance article or URL"
                  rows={5}
                  disabled={loading}
                  readOnly={result?.status === "valid"}
                />
                <div className="article-input__foot">
                  <span className="article-input__count mono">
                    {countLabel}
                  </span>
                  {result && (
                    <span className={`article-input__status article-input__status--${result.status}`}>
                      {result.status}
                    </span>
                  )}
                </div>
                {result?.status === "invalid" && result.reason && (
                  <p className="article-input__error">{result.reason}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="my-lens__actions">
          <button
            className="my-lens__add"
            type="button"
            onClick={addDraft}
            disabled={drafts.length >= MAX_ARTICLES || loading}
          >
            + Add article
          </button>
          <button
            className="my-lens__analyze"
            type="button"
            onClick={() => void analyze()}
            disabled={readyCount === 0 || loading}
          >
            {loading
              ? "Analyzing..."
              : readyCount === 0
                ? "Analyze articles"
                : `Analyze ${readyCount} article${readyCount === 1 ? "" : "s"}`}
          </button>
        </div>
        {loading && progress && (
          <div className="my-lens__progress" role="status" aria-live="polite">
            <div className="my-lens__progress-head">
              <span>{progress.message}</span>
              <span className="mono">{elapsedSeconds}s</span>
            </div>
            {progress.total !== undefined && progress.completed !== undefined && (
              <progress max={progress.total} value={progress.completed} />
            )}
          </div>
        )}
        {error && <p className="my-lens__error">{error}</p>}
      </section>

      {day && (
        <section className="my-lens__results rise">
          <Hero day={day} />
          <section className="keypoints">
            <div className="section-label">
              Your articles · {day.keyPoints.length} analyzed
            </div>
            {day.keyPoints.map((keyPoint) => (
              <KeyPointCard key={keyPoint.id} keyPoint={keyPoint} povs={day.povs} />
            ))}
          </section>
          <CastStrip day={day} defs={defs} onPick={onPick} />
        </section>
      )}
    </>
  );
}
