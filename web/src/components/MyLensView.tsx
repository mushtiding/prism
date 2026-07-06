import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
const MAX_ARTICLES = 5;
const STORAGE_KEY = "prism.my-lens.v1";
const STORAGE_VERSION = 2;

interface DraftArticle {
  id: string;
  value: string;
}

interface StoredMyLensState {
  version: number;
  drafts: DraftArticle[];
  results: Record<string, MyLensArticleResult>;
  day: DayContent | null;
}

function emptyState(): StoredMyLensState {
  return {
    version: STORAGE_VERSION,
    drafts: [],
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
                  typeof draft.value === "string" &&
                  draft.value.trim(),
              ),
          )
          .slice(0, MAX_ARTICLES)
      : [];
    const currentVersion = parsed?.version === STORAGE_VERSION;
    const results = currentVersion
      ? (Object.fromEntries(
          Object.entries(parsed?.results ?? {}).filter(([, result]) =>
            Boolean(
              result &&
                (result.status === "valid" || result.status === "invalid") &&
                (result.inputType === "text" || result.inputType === "url"),
            ),
          ),
        ) as Record<string, MyLensArticleResult>)
      : {};
    const day =
      currentVersion && parsed?.day?.kind === "myLens"
        ? { ...parsed.day, title: "Your Brief" }
        : null;
    return {
      version: STORAGE_VERSION,
      drafts,
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

function articleStatusLabel(
  status: MyLensArticleResult["status"] | undefined,
): string {
  if (status === "valid") return "Included";
  if (status === "invalid") return "Not included";
  return "Added";
}

function sameArticleIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
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
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MyLensJobProgress | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    onResult(day);
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          drafts,
          results,
          day,
        } satisfies StoredMyLensState),
      );
    } catch {
      // Storage can be unavailable in privacy modes; in-memory state still works.
    }
  }, [day, drafts, onResult, results]);

  function queueArticle() {
    const value = inputValue.trim();
    if (!value || drafts.length >= MAX_ARTICLES || loading) return;
    const id = `my-lens-${nextId.current++}`;
    setDrafts((current) => [...current, { id, value }]);
    setInputValue("");
    setError(null);
    setProgress(null);
  }

  function removeDraft(id: string) {
    const removedGeneratedArticle = results[id]?.status === "valid";
    setDrafts((current) => current.filter((draft) => draft.id !== id));
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
    const previousDay = day;
    const previousValidIds = drafts.flatMap((draft) =>
      results[draft.id]?.status === "valid" ? [draft.id] : [],
    );

    setLoading(true);
    setError(null);
    setProgress({ phase: "queued", message: "Starting your brief" });
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
            const nextResults = Object.fromEntries(
              job.result.articles.map((article) => [article.id, article]),
            );
            const nextValidIds = job.result.articles.flatMap((article) =>
              article.status === "valid" ? [article.id] : [],
            );
            const unchangedValidAnalysis = Boolean(
              previousDay &&
                previousValidIds.length > 0 &&
                sameArticleIds(previousValidIds, nextValidIds),
            );
            setResults(nextResults);
            setDay(unchangedValidAnalysis ? previousDay : job.result.day);
          }
          if (job.status === "failed") {
            if (job.result) {
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

  const readyCount = drafts.length;
  const inputIsUrl = looksLikeUrl(inputValue);
  const inputChars = Math.min(inputValue.length, ARTICLE_CHAR_LIMIT);
  const atLimit = drafts.length >= MAX_ARTICLES;

  return (
    <>
      <section className="my-lens">
        <div className="section-label">
          Your brief · {drafts.length} of {MAX_ARTICLES} articles
        </div>

        <div className="article-composer">
          <div className="article-composer__head">
            <label htmlFor="your-moves-input">Add an article</label>
            <span className="mono">URL or article text</span>
          </div>
          <textarea
            id="your-moves-input"
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              setError(null);
            }}
            placeholder={
              atLimit
                ? "Remove an article to add another"
                : "Paste a finance article URL or its text"
            }
            rows={2}
            disabled={loading || atLimit}
          />
          <div className="article-composer__foot">
            <span className="article-composer__count mono">
              {inputIsUrl
                ? "First 1,500 article characters will be used"
                : `${inputChars.toLocaleString()} / 1,500 characters${inputValue.length > ARTICLE_CHAR_LIMIT ? " · extra text omitted" : ""}`}
            </span>
            <button
              className="article-composer__add"
              type="button"
              onClick={queueArticle}
              disabled={!inputValue.trim() || loading || atLimit}
            >
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              Add article
            </button>
          </div>
        </div>

        {drafts.length > 0 && (
          <div className="article-list">
            <div className="article-list__head">
              <span>Selected articles</span>
              <span className="mono">
                {MAX_ARTICLES - drafts.length} space{MAX_ARTICLES - drafts.length === 1 ? "" : "s"} left
              </span>
            </div>
          {drafts.map((draft, index) => {
            const result = results[draft.id];
            const title = result?.title?.trim() || draft.value.trim().slice(0, 180);
            return (
              <article
                className={`article-list__item${result?.status === "invalid" ? " article-list__item--invalid" : ""}`}
                key={draft.id}
              >
                <div className="article-list__content">
                  <div className="article-list__title">{title}</div>
                  {result?.status === "invalid" && result.reason && (
                    <p className="article-list__error">{result.reason}</p>
                  )}
                </div>
                <span
                  className={`article-list__status article-list__status--${result?.status ?? "queued"}`}
                >
                  {articleStatusLabel(result?.status)}
                </span>
                <button
                  className="article-list__remove"
                  onClick={() => removeDraft(draft.id)}
                  title={`Remove article ${index + 1}`}
                  aria-label={`Remove article ${index + 1}`}
                  data-testid={`remove-${draft.id}`}
                  type="button"
                  disabled={loading}
                >
                  <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </article>
            );
          })}
          </div>
        )}

        <div className="my-lens__actions">
          <span className="my-lens__queue-note">
            {readyCount === 0
              ? "Add up to five finance articles."
              : `${readyCount} article${readyCount === 1 ? "" : "s"} selected.`}
          </span>
          <button
            className="my-lens__analyze"
            type="button"
            onClick={() => void analyze()}
            disabled={readyCount === 0 || loading}
          >
            {loading ? "Creating brief..." : "Create brief"}
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
              Your brief · {day.keyPoints.length} article
              {day.keyPoints.length === 1 ? "" : "s"} included
            </div>
            {day.keyPoints.map((keyPoint, index) => (
              <KeyPointCard
                key={keyPoint.id}
                index={index}
                keyPoint={keyPoint}
                povs={day.povs}
              />
            ))}
          </section>
          <CastStrip day={day} defs={defs} onPick={onPick} />
        </section>
      )}
    </>
  );
}
