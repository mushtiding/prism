# Prism Takeover Summary

Updated 2026-06-30 after the Room Read addition.

## Product

Prism refracts the same finance source material through five fixed investor
personas, then measures how much their directional reads disagree. The app has
three workspaces:

- **Today**: deterministically curates up to four market-moving articles, then
  asks the personas to react.
- **Your Moves**: accepts up to five user-provided finance articles as pasted
  text or URLs, validates the first 1,500 characters, and runs valid articles
  through the same persona/divergence pipeline.
- **History**: lists prior live daily briefings only when a generated cache file
  already exists. It is strictly read-only and never generates a past date.

The npm workspace contains `shared/`, `server/`, and `web/` packages. Core
commands are `npm run dev`, `npm test`, `npm run typecheck`, and
`npm run build`.

## Runtime

- Local secrets belong only in ignored `server/.env`.
- The active model is `nvidia/nemotron-3-super-120b-a12b:free`. Explicit
  fallback is `openrouter/free`, which dynamically selects a currently
  available free model compatible with structured output. Owl Alpha was removed from
  OpenRouter's live model catalog on 2026-06-30 and now returns HTTP 404.
- The OpenRouter timeout is 480 seconds; raw responses are written to
  `server/logs/openrouter-raw-responses.log` with secrets redacted.
- Alpha Vantage is the primary market provider. Yahoo Finance provides the
  keyless quota fallback and RSS article pool.
- The dev API is `http://localhost:8788`; Vite chooses an available web port.

## Daily Pipeline

1. `server/src/pipeline/neutralBriefing.ts` deterministically scores and
   curates article-backed key points. The neutral layer does not use an LLM.
2. `server/src/pipeline/generate.ts` starts five Owl Alpha persona calls in
   parallel. Each has compact JSON retries and provider-error backoff.
3. At a three-persona quorum, the pipeline waits another 60 seconds for late
   lenses. Below quorum, it still caches and serves the live article briefing;
   missing personas appear unavailable and can be retried in the app.
4. Divergence is computed deterministically from persona stance scores.
5. Daily content is cached under `server/cache/<requested-date>.json`.
   That top-level file is the latest pointer used by Today. Every successful
   generation is also stored under `server/cache/versions/<date>/`; History
   exposes all versions for a prior date in newest-first order. A failed refresh
   leaves both the latest pointer and version history untouched.
6. Missing daily personas are disabled in the UI and can be retried in place.
   A retry has a 60-second UI/server deadline and merges a valid POV back into
   the cached day without regenerating articles.
7. A live daily briefing with at least two first impressions can reveal one
   **Room Read**. Each available persona privately receives the other first
   impressions and writes an independent strengthened second pass. The prompt
   explicitly forbids dialogue, collective consensus, and invented support.
   A deterministic room briefing compares the first and strengthened stance
   divergence. The original POVs remain unchanged, while the optional Room
   Read is saved onto that exact briefing version and remains visible in History.
   Completion requires at least three strengthened lenses; thinner partial
   results are rejected so Reveal remains retryable. OpenRouter reasoning is
   explicitly disabled when `OPENROUTER_REASONING=none`, which prevents
   Nemotron 3 Super from spending the JSON output budget on visible analysis.
   Strengthened text identical to the first impression is also rejected. Once
   the room reaches quorum, any missing strengthened persona remains visibly
   unavailable and can be retried individually without regenerating its peers.

## Your Moves

Relevant files:

- `web/src/components/MyLensView.tsx`: one compact URL/text composer feeding a
  persistent five-item queue, 1,500-character indicators, per-entry validation
  status, deletion, and result rendering.
- `server/src/providers/articleReader.ts`: guarded HTTP(S) reader. It blocks
  credentials, localhost, private/non-public IPs, and validates every redirect;
  downloads at most 512 KB, parses HTML with `node-html-parser`, and preserves
  publisher-provided summary/takeaway bullets when available.
- `server/src/providers/articleSummaryMarketData.ts`: hydrates the articles
  selected for Today with publisher takeaway bullets before personas run.
- `server/src/pipeline/userArticles.ts`: truncation, deterministic finance-topic
  validation, neutral Owl Alpha headline/summary synthesis, key-point
  construction, and persona analysis. Synthesis rewrites publisher headlines,
  produces a 2–3 sentence summary and key facts, and falls back to complete
  extracted sentences rather than displaying a raw 1,500-character slice.
- `server/src/store/myLensJobs.ts`: in-memory 30-minute jobs, progress state,
  preserved article validation results, and sanitized provider errors.
- `POST /api/my-lens/analyze`: accepts `{ articles: [{ id, value }] }` and
  returns HTTP 202 with a job id.
- `GET /api/my-lens/jobs/:jobId`: reports reading, validation, persona, and
  scoring progress, then returns per-entry statuses and any `DayContent` result.

Invalid entries do not block valid entries in the same request. Your Moves is
not written to daily History and currently waits up to 120 seconds after
persona quorum to improve the chance of returning all five lenses. User article text is explicitly
treated as untrusted source material in the persona system prompt.
OpenRouter 429 responses stop after one request per persona and surface a
specific rate-limit message instead of a generic internal error.

Completed Your Moves analyses are memoized in memory for 30 minutes by the
unchanged valid article set. Invalid additions are deliberately excluded from
that key, so adding a 403/unreadable article reuses the original POVs and cannot
change divergence. The client also preserves the existing analysis for the same
valid article IDs across a server restart. Storage schema v2 keeps the article
queue but invalidates legacy pre-synthesis results once.

## Frontend Notes

- `Hero`, `KeyPointCard`, `CastStrip`, and `PersonaDrawer` are shared by all
  three workspaces.
- The cast is presented in a responsive front-on pixel house. Available
  personas enter through the right-hand door and settle into fixed activities.
- The divergence label has an accessible hover/focus/tap tooltip that explains
  the 0-to-1 index and interprets the current value.
- Missing persona cards never masquerade as neutral. Daily cards expose Retry;
  Your Moves partial results currently show unavailable lenses without retry.
- Today places Reveal Room Read directly below the cast cards. While the second
  pass runs it shows elapsed time; afterward it renders a compact briefing and
  one strengthened card per completed persona. The persona drawer provides
  First impression / Strengthened tabs for direct comparison.
- Your Moves queued articles and generated results survive app-tab navigation
  and full page reloads until explicitly removed.
- The sliders button in the masthead opens Settings. Its sun/moon control
  switches between dark and light themes and persists the choice in local
  storage before the next page paint.

## API

- `GET /api/health`
- `GET /api/personas`
- `GET /api/day/latest`
- `POST /api/day/latest/refresh`
- `POST /api/day/latest/room-read`
- `POST /api/day/latest/room-read/personas/:personaId/retry`
- `POST /api/day/latest/personas/:personaId/retry`
- `GET /api/day/:date`
- `GET /api/history`
- `GET /api/history/:date`
  accepts an optional `generatedAt` query to retrieve one exact saved brief.
- `POST /api/my-lens/analyze`
- `GET /api/my-lens/jobs/:jobId`

`GET /api/day/:date` only accepts today's server-local date. Earlier and future
dates cannot enter the generation pipeline.

## Verification

At this handoff:

- `npm test`: 12 files, 65 tests passed.
- `npm run typecheck`: all workspaces passed.
- `npm run build`: all workspaces passed.
- `npm audit --omit=dev`: no production vulnerabilities.
- Browser checks covered the generated History catalog/detail flow, compact
  article queue, reload persistence, deletion affordance, and 390px layouts.
- Daily refresh version retention has a focused store test. The icon-only
  refresh control, History time selector, exact-version detail, and both themes
  were browser-checked at desktop and 390px widths.
- Room Read has focused generation and same-version persistence coverage. Its
  reveal state and mobile control were browser-checked at 390px; the current
  live June 30 cache had no completed first impressions, so the UI correctly
  kept Reveal disabled and the endpoint returned HTTP 409 without model calls.
- The reported Yahoo article was also verified live: Owl Alpha produced a
  rewritten neutral headline, a concise factual summary, and four key facts.
  Re-running it with an invalid second URL kept the displayed divergence and
  persona stances unchanged.
- The exact Yahoo URL from the June 27 bug report was extracted and validated.
  OpenRouter was over its free-model quota, so the job preserved `VALID` for
  the article and returned the explicit rate-limit outcome in about four seconds.

## Known Limits

- The finance validator is deterministic keyword/context matching, not a
  classifier. It is intentionally conservative and only sees the first 1,500
  source characters.
- Some publishers block server-side article extraction or put useful content
  behind scripts/paywalls; those URLs return invalid/read errors.
- Your Moves persistence uses browser local storage and is scoped to that browser
  profile; it does not sync between browsers or devices.
- The active model can still return malformed JSON or upstream capacity errors.
  Retry, quorum, and unavailable states keep those failures explicit. Daily
  persona failures do not replace successfully curated live news with sample content.
- Today is keyed and displayed by the server's current local calendar date;
  provider quote data may still describe the previous market session.
